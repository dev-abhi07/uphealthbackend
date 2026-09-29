const { query } = require('../db/pool');
const { groupIndicatorsForSummary } = require('../ranking/rankingRegistry');
const {
  outcomeConfig,
  parsePeriodInput,
  prevPeriod,
} = require('./outcomeConfig');
const { fetchDistrictOutcomeFromApi } = require('./outcomeDistrictClient');
const store = require('./outcomeDistrictStore');
const {
  getDivisionCompositeRows,
  getDivisionIndicatorRows,
  resolveMasterIndicator,
} = require('./outcomeRankingQueries');

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  if (unit === 'percent') return `${Number(n.toFixed(2))}%`;
  if (unit === 'index') return Number(n.toFixed(4));
  if (unit === 'amount') return Number(n.toFixed(2));
  return Number(n.toFixed(2));
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

/**
 * Sync from external API into DB. On failure, logs and returns { ok:false }.
 * Does not throw for missing URL / network — caller uses cache.
 */
async function syncDistrictOutcome({ month, year, force = false } = {}) {
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
  if (!cfg.districtUrl) {
    return { ok: false, reason: 'url_missing', period: p };
  }

  try {
    const rows = await fetchDistrictOutcomeFromApi({ month: p.month, year: p.year });
    // ensure month/year on each row
    const normalized = rows.map((r) => ({
      ...r,
      month: r.month || p.month,
      year: r.year || p.year,
    }));
    const result = await store.upsertDistrictOutcomeRows(normalized, {
      month: p.month,
      year: p.year,
      period_label: p.period_label,
      source: 'api',
    });
    return { ok: true, period: p, ...result, source: 'api' };
  } catch (e) {
    await store.logSyncFailure({
      year: p.year,
      month: p.month,
      period_label: p.period_label,
      source: 'api',
      error_message: e.message,
    }).catch(() => {});
    return { ok: false, reason: e.message, period: p, error: e };
  }
}

/** Ingest already-fetched API JSON array (manual / test). */
async function ingestDistrictOutcomeJson(rows, { month, year, source = 'manual' } = {}) {
  const p = parsePeriodInput({ month, year });
  if (!p) {
    const err = new Error('month and year required');
    err.status = 400;
    throw err;
  }
  const { normalizeRow } = require('./outcomeDistrictClient');
  const normalized = (rows || []).map(normalizeRow).filter(Boolean).map((r) => ({
    ...r,
    month: r.month || p.month,
    year: r.year || p.year,
  }));
  const result = await store.upsertDistrictOutcomeRows(normalized, {
    month: p.month,
    year: p.year,
    period_label: p.period_label,
    source,
  });
  return { ok: true, period: p, ...result, source };
}

/**
 * Build ranking dashboard payload from outcome cache (district).
 * Returns null if no cached data for period.
 */
async function getDistrictOutcomeDashboard({
  period,
  month,
  year,
  district,
  divCode,
  division,
  parentAreaId,
  indicatorCode,
  skipSync = false,
} = {}) {
  let p = parsePeriodInput({ period, month, year });
  if (!p && !period && month == null) {
    // latest outcome period
    const periods = await store.listOutcomePeriods();
    if (!periods.length) return null;
    p = parsePeriodInput({
      month: periods[0].month,
      year: periods[0].year,
    });
  }
  if (!p) return null;

  const cfg = outcomeConfig();
  let syncMeta = null;
  // Only sync on read when OUTCOME_SYNC_ON_READ=true (default: cache-only).
  // Otherwise every FE period click invents a new month in the cache.
  if (!skipSync && cfg.syncOnRead && cfg.enabled && cfg.districtUrl) {
    syncMeta = await syncDistrictOutcome({ month: p.month, year: p.year });
  }

  const has = await store.hasDistrictOutcomePeriod(p.year, p.month);
  if (!has) return null;

  // Resolve division filter
  let divisionRow = null;
  if (divCode || division || parentAreaId) {
    const { rows } = await query(
      `
      SELECT id, code, name FROM division
      WHERE ($1::text IS NOT NULL AND code::text = $1)
         OR ($2::text IS NOT NULL AND lower(trim(name)) = lower(trim($2)))
         OR ($3::text IS NOT NULL AND id::text = $3)
      LIMIT 1
      `,
      [
        divCode ? String(divCode) : null,
        division ? String(division) : null,
        parentAreaId ? String(parentAreaId) : null,
      ]
    );
    divisionRow = rows[0] || null;
  }

  let districtLgd = null;
  let districtNameResolved = null;
  if (district) {
    const raw = String(district).trim();
    // Prefer master id, then LGD, then name/slug (numeric area_id=151 is Jalaun LGD, not Pilibhit)
    const { rows } = await query(
      `
      SELECT d.name, d.lgd_code, d.id
      FROM district d
      WHERE d.id::text = $1
         OR d.lgd_code::text = $1
         OR lower(trim(d.name)) = lower(trim($1))
         OR lower(replace(trim(d.name), ' ', '-')) = lower(replace(trim($1), ' ', '-'))
         OR lower(replace(trim(d.name), ' ', '')) = lower(replace(trim($1), ' ', ''))
      ORDER BY
        CASE
          WHEN d.id::text = $1 THEN 0
          WHEN d.lgd_code::text = $1 THEN 1
          ELSE 2
        END
      LIMIT 1
      `,
      [raw]
    );
    if (rows[0]) {
      districtLgd = Number(rows[0].lgd_code);
      districtNameResolved = rows[0].name;
    } else {
      // Fall back to outcome cache name / LGD
      const { rows: oRows } = await query(
        `
        SELECT district_name, district_lgd
        FROM indicator_outcome_district
        WHERE year = $1 AND month = $2
          AND (
            lower(trim(district_name)) = lower(trim($3))
            OR district_lgd::text = $3
            OR lower(replace(trim(district_name), ' ', '-')) = lower(replace(trim($3), ' ', '-'))
          )
        LIMIT 1
        `,
        [p.year, p.month, raw]
      );
      if (oRows[0]) {
        districtLgd = Number(oRows[0].district_lgd);
        districtNameResolved = oRows[0].district_name;
      } else if (/^\d+$/.test(raw)) {
        districtLgd = Number(raw);
      }
    }
  }

  const requested = String(indicatorCode || 'RANK_COMPOSITE').trim().toUpperCase();
  const selectedInd = await resolveMasterIndicator(requested);
  if (!selectedInd) {
    return {
      view: 'ranking_district',
      source: 'indicator_outcome',
      has_data: false,
      message: `Unknown indicator_code: ${requested}`,
      geo_level: 'district',
      period: p.period_label,
      period_display: p.period_display,
      ranking: [],
      indicators: [],
      sync: syncMeta,
    };
  }

  const composite = isCompositeCode(requested) || selectedInd.is_composite;
  const prev = prevPeriod(p);
  const hasPrev = await store.hasDistrictOutcomePeriod(prev.year, prev.month);

  // DISTRICT RANKING table: always full list for state/division (do not shrink to 1 row on click).
  // Selected district only drives SUMMARY (overall_composite_score + indicators).
  const rankingDivisionId = divisionRow ? divisionRow.id : null;
  const headers = await store.getDistrictHeaders({
    year: p.year,
    month: p.month,
    districtLgd: null,
    divisionId: rankingDivisionId,
  });

  const prevHeaders = hasPrev
    ? await store.getDistrictHeaders({
        year: prev.year,
        month: prev.month,
        districtLgd: null,
        divisionId: rankingDivisionId,
      })
    : [];
  const prevByLgd = new Map(prevHeaders.map((h) => [Number(h.district_lgd), h]));

  let valueByLgd = new Map();
  let prevValueByLgd = new Map();
  if (!composite) {
    const vals = await store.getDistrictValues({
      year: p.year,
      month: p.month,
      indicatorCode: selectedInd.code,
      districtLgd: null,
      divisionId: rankingDivisionId,
    });
    valueByLgd = new Map(vals.map((v) => [Number(v.district_lgd), num(v.value)]));
    if (hasPrev) {
      const pvals = await store.getDistrictValues({
        year: prev.year,
        month: prev.month,
        indicatorCode: selectedInd.code,
        districtLgd: null,
        divisionId: rankingDivisionId,
      });
      prevValueByLgd = new Map(pvals.map((v) => [Number(v.district_lgd), num(v.value)]));
    }
  }

  const total = headers.length;
  const filtered = Boolean(divisionRow);
  const nBand = bandSize(total);
  const bands = {
    top: { label: `Top ${nBand} Districts`, color: 'green', count: 0, items: [], size: nBand },
    moderate: { label: 'Moderate', color: 'yellow', count: 0, items: [], size: nBand },
    bottom: { label: `Bottom ${nBand} Districts`, color: 'red', count: 0, items: [], size: nBand },
  };

  // Rank by selected metric for display when not composite (sheet has no per-IND rank)
  let ranked = headers.map((h, idx) => {
    const lgd = Number(h.district_lgd);
    const score = composite ? num(h.index_outcome) : valueByLgd.has(lgd) ? valueByLgd.get(lgd) : null;
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
      // negative indicators: lower is better → ascending
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
      return String(a.h.district_name || '').localeCompare(String(b.h.district_name || ''));
    });
  }

  const unit = selectedInd.unit || (composite ? 'index' : 'percent');
  const barScale = computeBarScale(
    unit,
    ranked.flatMap((r) => [r.score, r.prevScore])
  );

  const ranking = ranked.map((r, idx) => {
    const localRank = idx + 1;
    // Always expose API / outcome rank as `rank` (not densified list position)
    const stateRank = r.rank != null ? Number(r.rank) : localRank;
    const rank = stateRank;
    const prevH = prevByLgd.get(r.lgd);
    const prevRank = composite && prevH && prevH.rank_outcome != null ? Number(prevH.rank_outcome) : null;
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
      // Canonical IDs for map/table click → send back as area_id or district=
      id: r.h.district_id != null ? Number(r.h.district_id) : null,
      district_id: r.h.district_id != null ? Number(r.h.district_id) : null,
      // LGD code (Excel DistrictLGDcode). Prefer this for outcome joins.
      area_id: r.lgd,
      lgd_code: r.lgd != null ? String(r.lgd) : null,
      // Master spelling — do not remap on FE; matches Excel District column
      name: r.h.district_name,
      district_lgd: r.lgd,
      district: r.h.district_name,
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
    };
    if (bands[item.band]) {
      bands[item.band].items.push(item);
      bands[item.band].count += 1;
    }
    return item;
  });

  const scores = ranking.map((r) => r.score).filter((x) => x != null);
  const selectedAvg =
    scores.length > 0
      ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4))
      : null;

  // Overall composite + indicators scoped to selection:
  // state (no district) | division | single selected district
  const summaryDivisionId = districtLgd ? null : divisionRow ? divisionRow.id : null;
  const overallRow = await store.getCompositeAverage({
    year: p.year,
    month: p.month,
    divisionId: summaryDivisionId,
    districtLgd,
  });
  const overall = num(overallRow.avg_value);

  // Always compute state overall for reference (gauge vs bar confusion)
  const stateOverallRow = await store.getCompositeAverage({
    year: p.year,
    month: p.month,
  });
  const stateOverall = num(stateOverallRow.avg_value);

  const avgs = await store.getIndicatorAverages({
    year: p.year,
    month: p.month,
    divisionId: summaryDivisionId,
    districtLgd,
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

  const indicators = masterInds.map((i) => {
    const value = avgMap.has(i.code) ? avgMap.get(i.code) : null;
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
      available: value != null,
    };
  });

  // Prepend composite pseudo-indicator for UI selector (matches OVERALL COMPOSITE SCORE bar)
  indicators.unshift({
    code: 'RANK_COMPOSITE',
    name: 'Overall composite score',
    full_name: 'Overall composite score',
    unit: 'index',
    is_composite: true,
    is_negative: false,
    value: overall,
    display_value: overall,
    selected: composite,
    available: overall != null,
  });

  const { by_type, by_domain } = groupIndicatorsForSummary(
    indicators.filter((i) => !i.is_composite)
  );

  // Mark selected district in ranking + expose for map/gauge
  let selectedDistrict = null;
  const rankingMarked = ranking.map((item) => {
    const isSelected =
      districtLgd != null && Number(item.district_lgd) === Number(districtLgd);
    if (isSelected) selectedDistrict = { ...item, selected: true };
    return { ...item, selected: isSelected };
  });
  if (!selectedDistrict && districtLgd != null) {
    const hit = rankingMarked.find((r) => Number(r.district_lgd) === Number(districtLgd));
    if (hit) selectedDistrict = hit;
  }

  // Gauge / selected_indicator average: district score when one is selected
  const summaryScore =
    selectedDistrict && selectedDistrict.score != null ? selectedDistrict.score : overall;
  const summaryAvgDisplay = composite
    ? summaryScore
    : districtLgd
      ? formatValue(overall, unit)
      : formatValue(selectedAvg, unit);

  return {
    view: 'ranking_district',
    source: syncMeta && syncMeta.ok ? 'indicator_outcome_api' : 'indicator_outcome_cache',
    has_data: total > 0,
    geo_level: 'district',
    period: p.period_label,
    period_display: p.period_display,
    district: districtNameResolved || district || null,
    district_lgd: districtLgd,
    summary_scope: districtLgd
      ? 'district'
      : divisionRow
        ? 'division'
        : 'state',
    div_code: divisionRow ? divisionRow.code : null,
    division: divisionRow ? divisionRow.name : null,
    parent_area_id: parentAreaId || null,
    indicator_code: composite ? 'RANK_COMPOSITE' : selectedInd.code,
    selected_indicator: {
      code: composite ? 'RANK_COMPOSITE' : selectedInd.code,
      name: selectedInd.short_name || selectedInd.name,
      full_name: selectedInd.name,
      unit,
      is_composite: !!composite,
      is_negative: !!selectedInd.is_negative,
      domain_label: selectedInd.domain_label || null,
      numerator: selectedInd.numerator_text || null,
      denominator: selectedInd.denominator_text || null,
      data_source: selectedInd.data_source_text || null,
      available: true,
      average: districtLgd && composite ? summaryScore : districtLgd ? overall : selectedAvg,
      average_display:
        districtLgd && composite
          ? summaryScore
          : districtLgd
            ? formatValue(overall, unit)
            : summaryAvgDisplay,
      average_bar_pct: barPct(
        districtLgd && composite ? summaryScore : districtLgd ? overall : selectedAvg,
        barScale
      ),
      bar_scale: barScale,
    },
    trend_compare_period: hasPrev ? prev.period_label : null,
    trend_compare_period_display: hasPrev ? prev.period_display : null,
    // When a district is selected, this MUST match that district's score (and the gauge)
    overall_composite_score: overall,
    overall_composite_label: 'OVERALL COMPOSITE SCORE',
    state_overall_composite_score: stateOverall,
    selected_district: selectedDistrict,
    bands,
    indicators,
    by_type,
    by_domain,
    ranking: rankingMarked,
    count: total,
    sync: syncMeta,
  };
}

/**
 * Division ranking rolled up from district outcome cache.
 * Composite = AVG(index_outcome); ranks recomputed across divisions.
 */
async function getDivisionOutcomeDashboard({
  period,
  month,
  year,
  divCode,
  division,
  parentAreaId,
  indicatorCode,
  skipSync = false,
} = {}) {
  let p = parsePeriodInput({ period, month, year });
  if (!p && !period && month == null) {
    const periods = await store.listOutcomePeriods();
    if (!periods.length) return null;
    p = parsePeriodInput({
      month: periods[0].month,
      year: periods[0].year,
    });
  }
  if (!p) return null;

  const cfg = outcomeConfig();
  let syncMeta = null;
  if (!skipSync && cfg.syncOnRead && cfg.enabled && cfg.districtUrl) {
    syncMeta = await syncDistrictOutcome({ month: p.month, year: p.year });
  }

  const has = await store.hasDistrictOutcomePeriod(p.year, p.month);
  if (!has) return null;

  let divisionRow = null;
  if (divCode || division || parentAreaId) {
    const { rows } = await query(
      `
      SELECT id, code, name FROM division
      WHERE ($1::text IS NOT NULL AND code::text = $1)
         OR ($2::text IS NOT NULL AND lower(trim(name)) = lower(trim($2)))
         OR ($3::text IS NOT NULL AND id::text = $3)
      LIMIT 1
      `,
      [
        divCode ? String(divCode) : null,
        division ? String(division) : null,
        parentAreaId ? String(parentAreaId) : null,
      ]
    );
    divisionRow = rows[0] || null;
  }

  const requested = String(indicatorCode || 'RANK_COMPOSITE').trim().toUpperCase();
  const selectedInd = await resolveMasterIndicator(requested);
  if (!selectedInd) {
    return {
      view: 'ranking_division',
      source: 'indicator_outcome',
      has_data: false,
      message: `Unknown indicator_code: ${requested}`,
      geo_level: 'division',
      period: p.period_label,
      period_display: p.period_display,
      ranking: [],
      indicators: [],
      sync: syncMeta,
    };
  }

  const composite = isCompositeCode(requested) || selectedInd.is_composite;
  const prev = prevPeriod(p);
  const hasPrev = await store.hasDistrictOutcomePeriod(prev.year, prev.month);
  const divisionId = divisionRow ? divisionRow.id : null;

  let currentRows;
  let prevRows;
  if (composite) {
    currentRows = await getDivisionCompositeRows({
      year: p.year,
      month: p.month,
      divisionId,
    });
    prevRows = hasPrev
      ? await getDivisionCompositeRows({
          year: prev.year,
          month: prev.month,
          divisionId,
        })
      : [];
  } else {
    const indRows = await getDivisionIndicatorRows({
      year: p.year,
      month: p.month,
      indicatorCode: selectedInd.code,
      divisionId,
    });
    const isNeg = !!selectedInd.is_negative;
    indRows.sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return isNeg ? a.value - b.value : b.value - a.value;
    });
    currentRows = indRows.map((r, idx) => ({
      ...r,
      index_outcome: r.value,
      rank_outcome: idx + 1,
    }));
    const prevInd = hasPrev
      ? await getDivisionIndicatorRows({
          year: prev.year,
          month: prev.month,
          indicatorCode: selectedInd.code,
          divisionId,
        })
      : [];
    prevInd.sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return isNeg ? a.value - b.value : b.value - a.value;
    });
    prevRows = prevInd.map((r, idx) => ({
      ...r,
      index_outcome: r.value,
      rank_outcome: idx + 1,
    }));
  }

  const prevById = new Map(prevRows.map((r) => [Number(r.division_id), r]));
  const total = currentRows.length;
  const filtered = Boolean(divisionRow);
  const nBand = bandSize(total);
  const bands = {
    top: { label: `Top ${nBand} Divisions`, color: 'green', count: 0, items: [], size: nBand },
    moderate: { label: 'Moderate', color: 'yellow', count: 0, items: [], size: nBand },
    bottom: { label: `Bottom ${nBand} Divisions`, color: 'red', count: 0, items: [], size: nBand },
  };

  const unit = selectedInd.unit || (composite ? 'index' : 'percent');
  const barScale = computeBarScale(
    unit,
    currentRows.flatMap((r) => {
      const prevR = prevById.get(Number(r.division_id));
      return [num(r.index_outcome), prevR ? num(prevR.index_outcome) : null];
    })
  );

  const ranking = currentRows.map((r, idx) => {
    const localRank = idx + 1;
    const rank = r.rank_outcome || localRank;
    const score = num(r.index_outcome);
    const prevR = prevById.get(Number(r.division_id));
    const prevScore = prevR ? num(prevR.index_outcome) : null;
    const prevRank = prevR && prevR.rank_outcome != null ? Number(prevR.rank_outcome) : null;
    const rankChange = prevRank == null ? null : rank - prevRank;
    const rankTrend =
      rankChange === null ? null : rankChange === 0 ? 'same' : rankChange < 0 ? 'up' : 'down';
    const valueChange =
      score == null || prevScore == null ? null : Number((score - prevScore).toFixed(4));
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
    const bandRank = filtered ? localRank : rank;
    const item = {
      rank,
      local_rank: localRank,
      name: r.division_name,
      division_id: Number(r.division_id),
      division_code: r.division_code,
      district: null,
      unit,
      score,
      display_value: composite ? score : formatValue(score, unit),
      prev_score: prevScore,
      prev_display_value: composite ? prevScore : formatValue(prevScore, unit),
      value_change: valueChange,
      value_trend: valueTrend,
      bar_pct: barPct(score, barScale),
      prev_bar_pct: barPct(prevScore, barScale),
      band: bandByTercile(bandRank, total),
      prev_rank: prevRank,
      rank_change: rankChange,
      rank_trend: rankTrend,
      district_count: r.district_count != null ? Number(r.district_count) : null,
    };
    if (bands[item.band]) {
      bands[item.band].items.push(item);
      bands[item.band].count += 1;
    }
    return item;
  });

  const scores = ranking.map((r) => r.score).filter((x) => x != null);
  const selectedAvg =
    scores.length > 0
      ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4))
      : null;

  // Overall = AVG of all district index_outcome (not avg of division avgs)
  const overallRow = await store.getCompositeAverage({
    year: p.year,
    month: p.month,
    divisionId,
  });
  const overall = num(overallRow.avg_value);

  const avgs = await store.getIndicatorAverages({
    year: p.year,
    month: p.month,
    divisionId,
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

  const indicators = masterInds.map((i) => {
    const value = avgMap.has(i.code) ? avgMap.get(i.code) : null;
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
      available: value != null,
    };
  });

  indicators.unshift({
    code: 'RANK_COMPOSITE',
    name: 'Overall composite score',
    full_name: 'Overall composite score',
    unit: 'index',
    is_composite: true,
    is_negative: false,
    value: overall,
    display_value: overall,
    selected: composite,
    available: overall != null,
  });

  const { by_type, by_domain } = groupIndicatorsForSummary(
    indicators.filter((i) => !i.is_composite)
  );

  return {
    view: 'ranking_division',
    source: syncMeta && syncMeta.ok ? 'indicator_outcome_api' : 'indicator_outcome_cache',
    has_data: total > 0,
    geo_level: 'division',
    period: p.period_label,
    period_display: p.period_display,
    district: null,
    district_lgd: null,
    summary_scope: divisionRow ? 'division' : 'state',
    div_code: divisionRow ? divisionRow.code : null,
    division: divisionRow ? divisionRow.name : null,
    parent_area_id: parentAreaId || null,
    indicator_code: composite ? 'RANK_COMPOSITE' : selectedInd.code,
    selected_indicator: {
      code: composite ? 'RANK_COMPOSITE' : selectedInd.code,
      name: selectedInd.short_name || selectedInd.name,
      full_name: selectedInd.name,
      unit,
      is_composite: !!composite,
      is_negative: !!selectedInd.is_negative,
      domain_label: selectedInd.domain_label || null,
      numerator: selectedInd.numerator_text || null,
      denominator: selectedInd.denominator_text || null,
      data_source: selectedInd.data_source_text || null,
      available: true,
      average: selectedAvg,
      average_display: composite ? selectedAvg : formatValue(selectedAvg, unit),
      average_bar_pct: barPct(selectedAvg, barScale),
      bar_scale: barScale,
    },
    trend_compare_period: hasPrev ? prev.period_label : null,
    trend_compare_period_display: hasPrev ? prev.period_display : null,
    overall_composite_score: overall,
    overall_composite_label: 'OVERALL COMPOSITE SCORE',
    bands,
    indicators,
    by_type,
    by_domain,
    ranking,
    count: total,
    sync: syncMeta,
  };
}

module.exports = {
  syncDistrictOutcome,
  ingestDistrictOutcomeJson,
  getDistrictOutcomeDashboard,
  getDivisionOutcomeDashboard,
  parsePeriodInput,
};
