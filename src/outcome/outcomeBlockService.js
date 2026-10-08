const { query } = require('../db/pool');
const { groupIndicatorsForSummary } = require('../ranking/rankingRegistry');
const {
  outcomeConfig,
  parsePeriodInput,
  prevPeriod,
} = require('./outcomeConfig');
const { fetchBlockOutcomeFromApi } = require('./outcomeBlockClient');
const store = require('./outcomeBlockStore');
const { resolveMasterIndicator } = require('./outcomeRankingQueries');

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** Keep decimals when |value| < 10; whole number at 10+. */
function formatDisplayNumber(n) {
  if (Math.abs(n) < 10) return Number(n.toFixed(2)).toString();
  return String(Math.round(n));
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  const formatted = formatDisplayNumber(n);
  if (unit === 'percent') return `${formatted}%`;
  if (unit === 'index') return Math.abs(n) < 10 ? Number(n.toFixed(4)) : Math.round(n);
  if (unit === 'amount') return formatted;
  return formatted;
}

function bandSize(total) {
  const n = Number(total) || 0;
  if (n < 1) return 1;
  return Math.max(1, Math.ceil(n / 3));
}

function bandByTercile(rank, total) {
  const topN = bandSize(total);
  if (rank <= topN) return 'top';
  if (rank > total - topN) return 'bottom';
  return 'moderate';
}

function computeBarScale(unit, values) {
  const xs = (values || []).filter((v) => v != null && !Number.isNaN(Number(v))).map(Number);
  const max = xs.length ? Math.max(...xs) : 0;
  if (unit === 'percent') return { mode: 'fixed', max: Math.max(100, max) };
  if (unit === 'index') return { mode: 'fixed', max: Math.max(1, max) };
  return { mode: 'relative', max: max > 0 ? max : 1 };
}

function barPct(score, scale) {
  if (score === null || score === undefined || !scale || !scale.max) return null;
  const pct = (Number(score) / scale.max) * 100;
  if (Number.isNaN(pct)) return null;
  return Number(Math.min(100, Math.max(0, pct)).toFixed(2));
}

function isCompositeCode(code) {
  const c = String(code || '').toUpperCase();
  return !c || c === 'RANK_COMPOSITE' || c === 'COMPOSITE' || c === 'INDEX_OUTCOME';
}

async function syncBlockOutcome({ month, year, force = false } = {}) {
  const p = parsePeriodInput({ month, year });
  if (!p) {
    const err = new Error('month and year required');
    err.status = 400;
    throw err;
  }
  const cfg = outcomeConfig();
  if (!cfg.enabled && !force) {
    return { ok: false, reason: 'disabled', period: p };
  }
  if (!cfg.blockUrl) {
    return { ok: false, reason: 'url_missing', period: p };
  }

  try {
    const rows = await fetchBlockOutcomeFromApi({ month: p.month, year: p.year });
    const normalized = rows.map((r) => ({
      ...r,
      month: r.month || p.month,
      year: r.year || p.year,
    }));
    const result = await store.upsertBlockOutcomeRows(normalized, {
      month: p.month,
      year: p.year,
      period_label: p.period_label,
      source: 'api',
    });
    return { ok: true, period: p, ...result, source: 'api' };
  } catch (e) {
    await store
      .logBlockSyncFailure({
        year: p.year,
        month: p.month,
        period_label: p.period_label,
        source: 'api',
        error_message: e.message,
      })
      .catch(() => {});
    return { ok: false, reason: e.message, period: p, error: e };
  }
}

async function ingestBlockOutcomeJson(rows, { month, year, source = 'manual' } = {}) {
  const p = parsePeriodInput({ month, year });
  if (!p) {
    const err = new Error('month and year required');
    err.status = 400;
    throw err;
  }
  const { normalizeBlockRow } = require('./outcomeBlockClient');
  const normalized = (rows || [])
    .map(normalizeBlockRow)
    .filter(Boolean)
    .map((r) => ({
      ...r,
      month: r.month || p.month,
      year: r.year || p.year,
    }));
  const result = await store.upsertBlockOutcomeRows(normalized, {
    month: p.month,
    year: p.year,
    period_label: p.period_label,
    source,
  });
  return { ok: true, period: p, ...result, source };
}

/**
 * Resolve district filter → LGD (master id / LGD / name).
 */
async function resolveDistrictLgd(district) {
  if (!district) return { districtLgd: null, districtName: null };
  const raw = String(district).trim();
  const { rows } = await query(
    `
    SELECT d.name, d.lgd_code, d.id
    FROM district d
    WHERE d.id::text = $1
       OR d.lgd_code::text = $1
       OR lower(trim(d.name)) = lower(trim($1))
       OR lower(replace(trim(d.name), ' ', '-')) = lower(replace(trim($1), ' ', '-'))
    ORDER BY
      CASE
        WHEN d.lgd_code::text = $1 THEN 0
        WHEN d.id::text = $1 THEN 1
        ELSE 2
      END
    LIMIT 1
    `,
    [raw]
  );
  if (rows[0]) {
    return { districtLgd: Number(rows[0].lgd_code), districtName: rows[0].name };
  }
  if (/^\d+$/.test(raw)) return { districtLgd: Number(raw), districtName: null };
  return { districtLgd: null, districtName: raw };
}

/**
 * Resolve block by master id, LGD, or name.
 * FE map often sends block_id = Block LGD (Bakshi-Ka-Talab = 1329).
 */
async function resolveBlock(block) {
  if (!block) return null;
  const raw = String(block).trim();
  if (!raw || raw.includes('__')) {
    // slug district__block → take block part
    if (raw.includes('__')) {
      const part = raw.split('__').slice(1).join('-');
      return resolveBlock(part.replace(/-/g, ' '));
    }
    return null;
  }
  const { rows } = await query(
    `
    SELECT b.id, b.name, b.lgd_code, b.district_id,
           d.name AS district_name, d.lgd_code AS district_lgd
    FROM block b
    JOIN district d ON d.id = b.district_id
    WHERE b.lgd_code::text = $1
       OR b.id::text = $1
       OR lower(trim(b.name)) = lower(trim($1))
       OR lower(replace(trim(b.name), ' ', '-')) = lower(replace(trim($1), ' ', '-'))
       OR lower(replace(trim(b.name), ' ', '')) = lower(replace(trim($1), ' ', ''))
    ORDER BY
      CASE
        WHEN b.lgd_code::text = $1 THEN 0
        WHEN b.id::text = $1 THEN 1
        ELSE 2
      END
    LIMIT 1
    `,
    [raw]
  );
  if (!rows[0]) return null;
  return {
    blockId: Number(rows[0].id),
    blockName: rows[0].name,
    blockLgd: Number(rows[0].lgd_code),
    districtId: rows[0].district_id != null ? Number(rows[0].district_id) : null,
    districtName: rows[0].district_name,
    districtLgd: rows[0].district_lgd != null ? Number(rows[0].district_lgd) : null,
  };
}

/**
 * Block ranking dashboard from outcome cache.
 * Ranking table = all blocks in district (or state).
 * When block= is set, gauge + BY INDICATORS use that block's values only.
 */
async function getBlockOutcomeDashboard({
  period,
  month,
  year,
  district,
  block,
  indicatorCode,
  skipSync = false,
} = {}) {
  let p = parsePeriodInput({ period, month, year });
  if (!p && !period && month == null) {
    const periods = await store.listBlockOutcomePeriods();
    if (!periods.length) return null;
    p = parsePeriodInput({ month: periods[0].month, year: periods[0].year });
  }
  if (!p) return null;

  const cfg = outcomeConfig();
  let syncMeta = null;
  if (!skipSync && cfg.syncOnRead && cfg.enabled && cfg.blockUrl) {
    syncMeta = await syncBlockOutcome({ month: p.month, year: p.year });
  }

  const has = await store.hasBlockOutcomePeriod(p.year, p.month);
  if (!has) return null;

  const selectedBlock = await resolveBlock(block);
  let { districtLgd, districtName } = await resolveDistrictLgd(district);
  // If block selected, prefer its parent district for ranking scope
  if (selectedBlock) {
    if (districtLgd == null) districtLgd = selectedBlock.districtLgd;
    if (!districtName) districtName = selectedBlock.districtName;
  }

  const requested = String(indicatorCode || 'RANK_COMPOSITE').trim().toUpperCase();
  const selectedInd = await resolveMasterIndicator(requested);
  if (!selectedInd) {
    return {
      view: 'ranking_block',
      source: 'indicator_outcome',
      has_data: false,
      message: `Unknown indicator_code: ${requested}`,
      geo_level: 'block',
      period: p.period_label,
      ranking: [],
    };
  }

  const composite = isCompositeCode(requested) || selectedInd.is_composite;
  const prev = prevPeriod(p);
  const hasPrev = await store.hasBlockOutcomePeriod(prev.year, prev.month);

  // RANKING table: all blocks in district (do not shrink to 1 row on block click)
  const headers = await store.getBlockHeaders({
    year: p.year,
    month: p.month,
    districtLgd,
  });
  const prevHeaders = hasPrev
    ? await store.getBlockHeaders({
        year: prev.year,
        month: prev.month,
        districtLgd,
      })
    : [];
  const prevByLgd = new Map(prevHeaders.map((h) => [Number(h.block_lgd), h]));

  let valueByLgd = new Map();
  let prevValueByLgd = new Map();
  if (!composite) {
    const vals = await store.getBlockValues({
      year: p.year,
      month: p.month,
      indicatorCode: selectedInd.code,
      districtLgd,
    });
    valueByLgd = new Map(vals.map((v) => [Number(v.block_lgd), num(v.value)]));
    if (hasPrev) {
      const pvals = await store.getBlockValues({
        year: prev.year,
        month: prev.month,
        indicatorCode: selectedInd.code,
        districtLgd,
      });
      prevValueByLgd = new Map(pvals.map((v) => [Number(v.block_lgd), num(v.value)]));
    }
  }

  const total = headers.length;
  const filtered = Boolean(districtLgd);
  const nBand = bandSize(total);
  const bands = {
    top: { label: `Top ${nBand} Blocks`, color: 'green', count: 0, items: [], size: nBand },
    moderate: { label: 'Moderate', color: 'yellow', count: 0, items: [], size: nBand },
    bottom: { label: `Bottom ${nBand} Blocks`, color: 'red', count: 0, items: [], size: nBand },
  };

  let ranked = headers.map((h, idx) => {
    const lgd = Number(h.block_lgd);
    const score = composite
      ? num(h.index_outcome)
      : valueByLgd.has(lgd)
        ? valueByLgd.get(lgd)
        : null;
    const prevH = prevByLgd.get(lgd);
    const prevScore = composite
      ? prevH
        ? num(prevH.index_outcome)
        : null
      : prevValueByLgd.has(lgd)
        ? prevValueByLgd.get(lgd)
        : null;
    const rank = composite ? (h.rank_outcome != null ? Number(h.rank_outcome) : idx + 1) : null;
    return { h, lgd, score, prevScore, rank };
  });

  if (!composite) {
    ranked.sort((a, b) => {
      const av = a.score;
      const bv = b.score;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (selectedInd.is_negative) return av - bv;
      return bv - av;
    });
    ranked = ranked.map((r, i) => ({ ...r, rank: i + 1 }));
  } else {
    ranked.sort((a, b) => {
      const ar = a.rank != null ? a.rank : 9999;
      const br = b.rank != null ? b.rank : 9999;
      if (ar !== br) return ar - br;
      const as = a.score != null ? a.score : -Infinity;
      const bs = b.score != null ? b.score : -Infinity;
      if (bs !== as) return bs - as;
      return String(a.h.block_name || '').localeCompare(String(b.h.block_name || ''));
    });
  }

  const unit = selectedInd.unit || (composite ? 'index' : 'percent');
  const barScale = computeBarScale(
    unit,
    ranked.flatMap((r) => [r.score, r.prevScore])
  );

  const ranking = ranked.map((r, idx) => {
    const localRank = idx + 1;
    const stateRank = r.rank != null ? Number(r.rank) : localRank;
    // Always expose API / outcome rank as `rank` (not densified list position)
    const rank = stateRank;
    const prevH = prevByLgd.get(r.lgd);
    const prevRank =
      composite && prevH && prevH.rank_outcome != null ? Number(prevH.rank_outcome) : null;
    const rankChange = prevRank == null ? null : stateRank - prevRank;
    const rankTrend =
      rankChange === null ? null : rankChange === 0 ? 'same' : rankChange < 0 ? 'up' : 'down';
    const valueChange =
      r.score == null || r.prevScore == null ? null : Number((r.score - r.prevScore).toFixed(4));
    const valueTrend =
      valueChange === null
        ? null
        : valueChange === 0
          ? 'same'
          : selectedInd.is_negative
            ? valueChange < 0
              ? 'up'
              : 'down'
            : valueChange > 0
              ? 'up'
              : 'down';
    const bandRank = filtered ? localRank : stateRank;
    const item = {
      rank,
      state_rank: stateRank,
      local_rank: stateRank,
      list_index: localRank,
      id: r.h.block_id != null ? Number(r.h.block_id) : null,
      block_id: r.h.block_id != null ? Number(r.h.block_id) : null,
      area_id: r.lgd,
      lgd_code: r.lgd != null ? String(r.lgd) : null,
      name: r.h.block_name,
      block: r.h.block_name,
      block_lgd: r.lgd,
      district: r.h.district_name,
      district_name: r.h.district_name,
      district_lgd: r.h.district_lgd != null ? Number(r.h.district_lgd) : null,
      district_id: r.h.district_id != null ? Number(r.h.district_id) : null,
      division_id: r.h.division_id != null ? Number(r.h.division_id) : null,
      unit,
      score: r.score,
      display_value: composite ? r.score : formatValue(r.score, unit),
      prev_score: r.prevScore,
      prev_display_value: composite ? r.prevScore : formatValue(r.prevScore, unit),
      value_change: valueChange,
      value_trend: valueTrend,
      bar_pct: barPct(r.score, barScale),
      prev_bar_pct: barPct(r.prevScore, barScale),
      band: bandByTercile(bandRank, total),
      prev_rank: prevRank,
      rank_change: rankChange,
      rank_trend: rankTrend,
      selected: false,
    };
    if (bands[item.band]) {
      bands[item.band].items.push(item);
      bands[item.band].count += 1;
    }
    return item;
  });

  // SUMMARY: block → that block; else district avg; else state avg
  const summaryBlockLgd = selectedBlock ? selectedBlock.blockLgd : null;
  const overallRow = await store.getBlockCompositeAverage({
    year: p.year,
    month: p.month,
    districtLgd: summaryBlockLgd != null ? null : districtLgd,
    blockLgd: summaryBlockLgd,
  });
  const overall = num(overallRow.avg_value);

  const districtOverallRow =
    summaryBlockLgd != null && districtLgd != null
      ? await store.getBlockCompositeAverage({
          year: p.year,
          month: p.month,
          districtLgd,
        })
      : null;
  const districtOverall = districtOverallRow ? num(districtOverallRow.avg_value) : null;

  const avgs = await store.getBlockIndicatorAverages({
    year: p.year,
    month: p.month,
    districtLgd: summaryBlockLgd != null ? null : districtLgd,
    blockLgd: summaryBlockLgd,
  });
  const avgMap = new Map(avgs.map((a) => [a.indicator_code, num(a.avg_value)]));

  const { rows: masterInds } = await query(
    `
    SELECT code, name, short_name, unit, domain, domain_label, indicator_type,
           numerator_text, denominator_text,
           data_source_text, is_negative, sno
    FROM indicator
    WHERE is_active = TRUE AND code ~ '^IND\\d{3}$'
    ORDER BY sno NULLS LAST, code
    `
  );

  // Block scope: omit indicators with no value (do not send blank rows)
  const indicators = masterInds
    .map((i) => {
      const value = avgMap.has(i.code) ? avgMap.get(i.code) : null;
      if (value == null) return null;
      return {
        code: i.code,
        name: i.short_name || i.name,
        full_name: i.name,
        unit: i.unit,
        is_composite: false,
        is_negative: !!i.is_negative,
        domain: i.domain || null,
        domain_label: i.domain_label || null,
        indicator_type: i.indicator_type || null,
        type: i.indicator_type || null,
        numerator: i.numerator_text || null,
        denominator: i.denominator_text || null,
        data_source: i.data_source_text || null,
        sort_order: i.sno != null ? Number(i.sno) : null,
        value,
        display_value: formatValue(value, i.unit),
        selected: !composite && selectedInd.code === i.code,
        available: true,
      };
    })
    .filter(Boolean);

  if (overall != null) {
    indicators.unshift({
      code: 'RANK_COMPOSITE',
      name: 'Overall composite score',
      full_name: 'Overall composite score',
      unit: 'index',
      is_composite: true,
      is_negative: false,
      value: overall,
      display_value: formatValue(overall, 'index'),
      selected: composite,
      available: true,
    });
  }

  const { by_type, by_domain } = groupIndicatorsForSummary(
    indicators.filter((i) => !i.is_composite)
  );

  let selectedBlockRow = null;
  const rankingMarked = ranking.map((item) => {
    const isSelected =
      summaryBlockLgd != null && Number(item.block_lgd) === Number(summaryBlockLgd);
    if (isSelected) selectedBlockRow = { ...item, selected: true };
    return { ...item, selected: isSelected };
  });
  if (!selectedBlockRow && summaryBlockLgd != null) {
    const hit = rankingMarked.find((r) => Number(r.block_lgd) === Number(summaryBlockLgd));
    if (hit) selectedBlockRow = hit;
  }

  const scores = ranking.map((r) => r.score).filter((x) => x != null);
  const selectedAvg =
    scores.length > 0
      ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4))
      : null;

  const summaryScore =
    selectedBlockRow && selectedBlockRow.score != null ? selectedBlockRow.score : overall;

  return {
    view: 'ranking_block',
    source: syncMeta && syncMeta.ok ? 'indicator_outcome_api' : 'indicator_outcome_cache',
    has_data: total > 0,
    geo_level: 'block',
    period: p.period_label,
    period_display: p.period_display,
    district: districtName || district || null,
    district_lgd: districtLgd,
    block: selectedBlock ? selectedBlock.blockName : null,
    block_lgd: summaryBlockLgd,
    block_id: selectedBlock ? selectedBlock.blockId : null,
    summary_scope: summaryBlockLgd ? 'block' : districtLgd ? 'district' : 'state',
    indicator_code: composite ? 'RANK_COMPOSITE' : selectedInd.code,
    selected_indicator: {
      code: composite ? 'RANK_COMPOSITE' : selectedInd.code,
      name: selectedInd.short_name || selectedInd.name,
      full_name: selectedInd.name,
      unit,
      is_composite: !!composite,
      is_negative: !!selectedInd.is_negative,
      available: true,
      average: summaryBlockLgd && composite ? summaryScore : summaryBlockLgd ? overall : selectedAvg,
      average_display:
        summaryBlockLgd && composite
          ? summaryScore
          : summaryBlockLgd
            ? formatValue(overall, unit)
            : composite
              ? selectedAvg
              : formatValue(selectedAvg, unit),
      average_bar_pct: barPct(
        summaryBlockLgd && composite ? summaryScore : summaryBlockLgd ? overall : selectedAvg,
        barScale
      ),
      bar_scale: barScale,
    },
    trend_compare_period: hasPrev ? prev.period_label : null,
    trend_compare_period_display: hasPrev ? prev.period_display : null,
    overall_composite_score: overall,
    overall_composite_label: 'OVERALL COMPOSITE SCORE',
    district_overall_composite_score: districtOverall,
    selected_block: selectedBlockRow,
    bands,
    indicators,
    by_type,
    by_domain,
    ranking: rankingMarked,
    count: total,
    sync: syncMeta,
  };
}

module.exports = {
  syncBlockOutcome,
  ingestBlockOutcomeJson,
  getBlockOutcomeDashboard,
  parsePeriodInput,
};
