/**
 * UP Health Executive Summary — performance snapshot.
 * State/sysadmin: division tab → divisions; district tab → districts.
 * Division login: districts in that division.
 * District login: blocks in that district.
 * Data: indicator_outcome_* cache. No ranking_value.
 */
const { query } = require('../db/pool');
const {
  resolveOutcomePeriod,
  listOutcomePeriodLabels,
  loadCompositeByPeriod,
  loadStatewideIndicatorAvgs,
} = require('../outcome/outcomeRankingQueries');
const { normalizeGeoName } = require('./rankingNameNormalize');

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function round(v, digits = 2) {
  if (v == null || Number.isNaN(Number(v))) return null;
  const f = 10 ** digits;
  return Math.round(Number(v) * f + 1e-9) / f;
}

function shortGeoName(name) {
  return String(name || '')
    .replace(/\s+Division$/i, '')
    .trim();
}

function displayPeriod(label) {
  const m = String(label || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return label;
  const names = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${names[Number(m[2]) - 1]} ${m[1]}`;
}

function prevMonthLabel(label) {
  const m = String(label || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1;
  if (mo < 1) {
    mo = 12;
    y -= 1;
  }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

function trailingMonths(label, count = 3) {
  const out = [];
  let cur = label;
  for (let i = 0; i < count; i += 1) {
    if (!cur) break;
    out.unshift(cur);
    cur = prevMonthLabel(cur);
  }
  return out;
}

function bandForRank(rank, total) {
  if (rank == null || !total) return null;
  const topN = total <= 18 ? 6 : Math.ceil(total / 3);
  const bottomN = topN;
  if (rank <= topN) return 'top';
  if (rank > total - bottomN) return 'bottom';
  return 'moderate';
}

async function resolvePeriod(period) {
  return resolveOutcomePeriod(period);
}

function pickBestWorstIndicators(indicators, n = 3) {
  const scored = indicators
    .filter((i) => i.value != null)
    .map((i) => ({
      ...i,
      quality: i.lower_is_better ? -i.value : i.value,
    }));
  const byBest = [...scored].sort((a, b) => b.quality - a.quality);
  const byWorst = [...scored].sort((a, b) => a.quality - b.quality);
  const mapRow = (i, sentiment) => ({
    code: i.code,
    name: i.name,
    full_name: i.full_name,
    unit: i.unit,
    value: i.value,
    display_value: i.unit === 'percent' ? `${i.value}%` : i.value,
    sentiment,
  });
  return {
    best_indicators: byBest.slice(0, n).map((i) => mapRow(i, 'positive')),
    worst_indicators: byWorst.slice(0, n).map((i) => mapRow(i, 'negative')),
  };
}

function formatIndicatorScore(ind) {
  if (!ind) return null;
  if (ind.display_value != null && ind.display_value !== '') {
    return String(ind.display_value);
  }
  if (ind.value == null) return null;
  return ind.unit === 'percent' ? `${ind.value}%` : String(ind.value);
}

function formatGeoList(areas, levelLabel) {
  return (areas || [])
    .map((a) => {
      const base = a.short_name || shortGeoName(a.name) || a.name;
      if (!base) return null;
      if (new RegExp(`\\b${levelLabel}$`, 'i').test(base)) return base;
      return `${base} ${levelLabel}`;
    })
    .filter(Boolean)
    .join(', ');
}

function buildNarrative({
  bestIndicators = [],
  topAreas = [],
  bottomAreas = [],
  levelLabel = 'Division',
}) {
  const levelPlural = `${levelLabel}s`.toLowerCase();
  const compared = ' as compared to last month';
  const paragraphs = [];

  const best = bestIndicators[0];
  const nextBest = bestIndicators[1];

  if (best?.name) {
    const score = formatIndicatorScore(best);
    paragraphs.push(
      score != null
        ? `UP's best performing indicator is ${best.name} with a score of ${score}${compared}.`
        : `UP's best performing indicator is ${best.name}${compared}.`
    );
  }

  if (nextBest?.name) {
    const score = formatIndicatorScore(nextBest);
    paragraphs.push(
      score != null
        ? `The next best performing indicator is ${nextBest.name} with a score of ${score}${compared}.`
        : `The next best performing indicator is ${nextBest.name}${compared}.`
    );
  }

  const topList = formatGeoList(topAreas, levelLabel);
  if (topList) {
    paragraphs.push(
      `${topList} are the top performing ${levelPlural} wrt composite score.`
    );
  }

  const bottomSorted = [...(bottomAreas || [])].sort(
    (a, b) => (Number(b.rank) || 0) - (Number(a.rank) || 0)
  );
  const bottomList = formatGeoList(bottomSorted, levelLabel);
  if (bottomList) {
    paragraphs.push(
      `${bottomList} are the least performing ${levelPlural} wrt composite score.`
    );
  }

  return paragraphs.join('\n\n') || null;
}

function buildMetaList(currentRows) {
  const total = currentRows.length;
  return currentRows.map((r, idx) => {
    const rank = r.rank != null ? r.rank : idx + 1;
    return {
      name: r.name,
      short_name: shortGeoName(r.name),
      score: round(r.value, 2),
      rank,
      band: bandForRank(rank, total),
      district_lgd: r.district_lgd != null ? Number(r.district_lgd) : null,
      block_lgd: r.block_lgd != null ? Number(r.block_lgd) : null,
      district_name: r.district_name || null,
      division_name: r.division_name || null,
      division_id: r.division_id != null ? Number(r.division_id) : null,
      geo_level: r.geo_level || null,
    };
  });
}

function buildPerformanceChange(
  withMeta,
  allComposite,
  availableHistory,
  periodLabel,
  prevLabel,
  imported
) {
  const byNamePeriod = new Map();
  for (const r of allComposite) {
    if (!byNamePeriod.has(r.name)) byNamePeriod.set(r.name, new Map());
    byNamePeriod.get(r.name).set(r.period, r.value);
  }
  const rows = withMeta.map((r) => {
    const seriesMap = byNamePeriod.get(r.name) || new Map();
    const history = availableHistory.map((pl) => ({
      period: pl,
      period_display: displayPeriod(pl),
      period_short: displayPeriod(pl).replace(
        /(\w+)\s+(\d{4})/,
        (_, m, y) => `${m.slice(0, 3)} ${y.slice(2)}`
      ),
      value: round(seriesMap.get(pl), 2),
    }));
    const cur = seriesMap.get(periodLabel);
    const prev = prevLabel && imported.has(prevLabel) ? seriesMap.get(prevLabel) : null;
    const change = cur != null && prev != null ? round(cur - prev, 2) : null;
    return {
      rank: r.rank,
      name: r.name,
      short_name: r.short_name,
      score: r.score,
      district_name: r.district_name || null,
      division_name: r.division_name || null,
      change,
      change_display: change == null ? null : change >= 0 ? `+${change}` : `${change}`,
      trend: change == null ? null : change > 0 ? 'up' : change < 0 ? 'down' : 'same',
      history,
    };
  });
  // TOP 3 (best rank) always green; BOTTOM 3 always red — independent of statewide band
  return paintPerformanceChangeTiers(rows, 3);
}

const TIER_COLORS = {
  top: '#1f9d55',
  moderate: '#f0a202',
  bottom: '#d62828',
};

/** Color TOP/BOTTOM panels by list position (not statewide rank thirds). */
function paintPerformanceChangeTiers(rows, topN = 3) {
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  const byRank = [...rows].sort(
    (a, b) => (Number(a.rank) || 9999) - (Number(b.rank) || 9999)
  );
  const topSet = new Set(byRank.slice(0, topN).map((r) => r.name));
  const bottomSet = new Set(byRank.slice(-topN).map((r) => r.name));
  return rows.map((r) => {
    let color_band = 'moderate';
    if (topSet.has(r.name)) color_band = 'top';
    else if (bottomSet.has(r.name)) color_band = 'bottom';
    return {
      ...r,
      band: color_band,
      color_band,
      color: TIER_COLORS[color_band],
    };
  });
}

async function loadDistrictDivisionLookup() {
  const { rows } = await query(
    `
    SELECT d.name AS district_name,
           d.lgd_code AS district_lgd,
           div.id AS division_id,
           div.name AS division_name,
           div.code AS division_code
    FROM district d
    JOIN division div ON div.id = d.division_id
    WHERE d.is_active = TRUE
    `
  );
  const byName = new Map();
  const byLgd = new Map();
  for (const r of rows) {
    const meta = {
      division_id: Number(r.division_id),
      division_name: r.division_name,
      division_code: r.division_code != null ? String(r.division_code) : null,
      district_lgd: r.district_lgd != null ? Number(r.district_lgd) : null,
    };
    byName.set(normalizeGeoName(r.district_name).toLowerCase(), meta);
    if (r.district_lgd != null) byLgd.set(Number(r.district_lgd), meta);
  }
  return { byName, byLgd };
}

function enrichDistrictRows(rows, lookup) {
  return (rows || []).map((r) => {
    const meta =
      (r.district_lgd != null && lookup.byLgd.get(Number(r.district_lgd))) ||
      lookup.byName.get(normalizeGeoName(r.name).toLowerCase()) ||
      null;
    return {
      ...r,
      geo_level: 'district',
      division_id: meta?.division_id || null,
      division_name: meta?.division_name || null,
      division_code: meta?.division_code || null,
    };
  });
}

/**
 * @param {object} opts
 * @param {string} [opts.period]
 * @param {'division'|'district'} [opts.level]
 * @param {object|null} [opts.scope] user geo scope
 * @param {number} [opts.topN]
 * @param {number} [opts.historyMonths]
 */
function isStatewideScope(scope) {
  return !scope || scope.isStateAdmin || scope.unrestricted;
}

/** Tab → content geo. Statewide matches tab; scoped users see one level down. */
function resolveContentGeo(viewLevel, scope) {
  if (isStatewideScope(scope)) {
    return viewLevel === 'district' ? 'district' : 'division';
  }
  if (scope.level === 'division') return 'district';
  return 'block';
}

function contentLevelLabel(primaryGeo) {
  if (primaryGeo === 'block') return 'Block';
  if (primaryGeo === 'district') return 'District';
  return 'Division';
}

function scopeNameKey(name) {
  return String(normalizeGeoName(name) || name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Keep only geos in the user's region:
 * - division login → districts in that division
 * - district/block login → blocks in that district
 */
function filterCompositeToScope(rows, primaryGeo, scope) {
  if (isStatewideScope(scope) || !Array.isArray(rows)) return rows;

  if (primaryGeo === 'district' && scope.level === 'division') {
    const divId = scope.divisionId != null ? Number(scope.divisionId) : null;
    const allowed = new Set(
      (scope.districtNamesInDivision || []).map((n) => scopeNameKey(n))
    );
    return rows.filter((r) => {
      if (
        divId != null &&
        r.division_id != null &&
        Number(r.division_id) === divId
      ) {
        return true;
      }
      return allowed.has(scopeNameKey(r.name || r.district_name || ''));
    });
  }

  if (primaryGeo === 'block') {
    const lgd = scope.districtLgd != null ? Number(scope.districtLgd) : null;
    const distKey = scopeNameKey(scope.districtName || '');
    const allowedBlocks = new Set(
      (scope.blockNamesInDistrict || []).map((n) => scopeNameKey(n))
    );
    return rows.filter((r) => {
      if (
        lgd != null &&
        r.district_lgd != null &&
        Number(r.district_lgd) === lgd
      ) {
        return true;
      }
      if (distKey && scopeNameKey(r.district_name || '') === distKey) {
        return true;
      }
      return allowedBlocks.has(scopeNameKey(r.name || ''));
    });
  }

  return rows;
}

/** Re-rank 1..n within each period after geo scope filter. */
function densifyCompositeRanks(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const byPeriod = new Map();
  for (const r of rows) {
    const p = r.period || '';
    if (!byPeriod.has(p)) byPeriod.set(p, []);
    byPeriod.get(p).push(r);
  }
  const out = [];
  for (const list of byPeriod.values()) {
    const sorted = [...list].sort((a, b) => {
      const va = Number(a.value);
      const vb = Number(b.value);
      if (vb !== va) return vb - va;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    sorted.forEach((r, idx) => {
      out.push({ ...r, rank: idx + 1 });
    });
  }
  return out;
}

async function getExecutiveSummary({
  period,
  level = 'division',
  scope = null,
  topN = 3,
  historyMonths = 3,
} = {}) {
  const viewLevel = level === 'district' ? 'district' : 'division';
  const primaryGeo = resolveContentGeo(viewLevel, scope);
  const levelLabel = contentLevelLabel(primaryGeo);
  const periodRow = await resolvePeriod(period);
  if (!periodRow) {
    return {
      view: 'executive_summary',
      has_data: false,
      message: 'No outcome periods synced yet. POST /api/ranking/outcome/district/sync',
      period: period || null,
      level: viewLevel,
      content_geo_level: primaryGeo,
      child_geo_level: null,
    };
  }

  const historyLabels = trailingMonths(periodRow.label, historyMonths);
  const prevLabel = prevMonthLabel(periodRow.label);
  const loadLabels = [...new Set([...historyLabels, periodRow.label, prevLabel].filter(Boolean))];

  const importedLabels = await listOutcomePeriodLabels();
  const imported = new Set(importedLabels);
  const availableHistory = historyLabels.filter((l) => imported.has(l));

  let allComposite;
  if (primaryGeo === 'district') {
    const distLookup = await loadDistrictDivisionLookup();
    allComposite = enrichDistrictRows(
      await loadCompositeByPeriod('district', loadLabels),
      distLookup
    );
  } else if (primaryGeo === 'block') {
    allComposite = (await loadCompositeByPeriod('block', loadLabels)).map((r) => ({
      ...r,
      geo_level: 'block',
    }));
  } else {
    allComposite = (await loadCompositeByPeriod('division', loadLabels)).map((r) => ({
      ...r,
      geo_level: 'division',
    }));
  }

  // Division → only that division's districts; district → only that district's blocks
  allComposite = densifyCompositeRanks(
    filterCompositeToScope(allComposite, primaryGeo, scope)
  );

  const current = allComposite
    .filter((r) => r.period === periodRow.label && r.value != null)
    .sort((a, b) => {
      if (a.rank != null && b.rank != null) return a.rank - b.rank;
      return b.value - a.value;
    })
    .map((r) => ({ ...r, geo_level: primaryGeo }));

  if (!current.length) {
    return {
      view: 'executive_summary',
      has_data: false,
      message: `No ${primaryGeo} composite data for ${periodRow.label}`,
      period: periodRow.label,
      period_display: displayPeriod(periodRow.label),
      level: viewLevel,
      content_geo_level: primaryGeo,
      child_geo_level: null,
    };
  }

  const withMeta = buildMetaList(current);
  const total = withMeta.length;
  const top_3 = withMeta.slice(0, topN);
  const bottom_3 = [...withMeta].sort((a, b) => b.rank - a.rank).slice(0, topN).reverse();

  const indicatorAvgs = await loadStatewideIndicatorAvgs(periodRow.label);
  const { best_indicators, worst_indicators } = pickBestWorstIndicators(indicatorAvgs, topN);

  const narrative = buildNarrative({
    bestIndicators: best_indicators,
    topAreas: top_3,
    bottomAreas: bottom_3,
    levelLabel,
  });

  const map_ranking = withMeta.map((r) => ({
    ...r,
    color_band: r.band,
  }));

  const performance_change = buildPerformanceChange(
    withMeta,
    allComposite,
    availableHistory,
    periodRow.label,
    prevLabel,
    imported
  );

  const areas = map_ranking.map((row) => ({
    ...row,
    children_count: 0,
    children: [],
  }));

  const withChange = performance_change.filter((r) => r.change != null);
  const highest_increase = [...withChange]
    .sort((a, b) => b.change - a.change)
    .slice(0, topN)
    .map((r) => {
      const seriesMap = new Map(
        (allComposite || [])
          .filter((x) => x.name === r.name)
          .map((x) => [x.period, x.value])
      );
      return {
        name: r.name,
        short_name: r.short_name,
        change: r.change,
        previous: {
          period: prevLabel,
          period_display: displayPeriod(prevLabel),
          value: round(seriesMap.get(prevLabel), 2),
        },
        current: {
          period: periodRow.label,
          period_display: displayPeriod(periodRow.label),
          value: r.score,
        },
      };
    });

  const lowest_decrease = [...withChange]
    .sort((a, b) => a.change - b.change)
    .slice(0, topN)
    .map((r) => {
      const seriesMap = new Map(
        (allComposite || [])
          .filter((x) => x.name === r.name)
          .map((x) => [x.period, x.value])
      );
      return {
        name: r.name,
        short_name: r.short_name,
        change: r.change,
        previous: {
          period: prevLabel,
          period_display: displayPeriod(prevLabel),
          value: round(seriesMap.get(prevLabel), 2),
        },
        current: {
          period: periodRow.label,
          period_display: displayPeriod(periodRow.label),
          value: r.score,
        },
      };
    });

  const history_legend = availableHistory.map((pl, idx) => {
    const colors = ['#9e9e9e', '#1976d2', '#43a047'];
    const color = colors[Math.min(idx, colors.length - 1)];
    const isLatest = pl === periodRow.label;
    return {
      period: pl,
      label: displayPeriod(pl),
      short_label: displayPeriod(pl).replace(
        /(\w+)\s+(\d{4})/,
        (_, m, y) => `${m.slice(0, 3)} ${y.slice(2)}`
      ),
      color: isLatest ? '#43a047' : color,
    };
  });
  if (history_legend.length >= 3) {
    history_legend[0].color = '#9e9e9e';
    history_legend[1].color = '#1976d2';
    history_legend[2].color = '#43a047';
  } else if (history_legend.length === 2) {
    history_legend[0].color = '#1976d2';
    history_legend[1].color = '#43a047';
  } else if (history_legend.length === 1) {
    history_legend[0].color = '#43a047';
  }

  return {
    view: 'executive_summary',
    has_data: true,
    level: viewLevel,
    content_geo_level: primaryGeo,
    child_geo_level: null,
    child_level_label: null,
    period: periodRow.label,
    period_display: displayPeriod(periodRow.label),
    previous_period: prevLabel && imported.has(prevLabel) ? prevLabel : null,
    previous_period_display:
      prevLabel && imported.has(prevLabel) ? displayPeriod(prevLabel) : null,
    history_periods: availableHistory,
    history_legend,
    missing_history_periods: historyLabels.filter((l) => !imported.has(l)),
    count: total,
    child_count: 0,
    narrative,
    narrative_badge: displayPeriod(periodRow.label),
    top_performers: top_3,
    bottom_performers: bottom_3,
    key_indicators: {
      positive: best_indicators,
      negative: worst_indicators,
    },
    ranking: map_ranking,
    rankings: map_ranking,
    map: {
      geo_level: primaryGeo,
      ranking: map_ranking,
    },
    areas,
    division_ranking: primaryGeo === 'division' ? map_ranking : undefined,
    district_ranking: primaryGeo === 'district' ? map_ranking : undefined,
    block_ranking: primaryGeo === 'block' ? map_ranking : undefined,
    performance_change,
    highest_increase,
    lowest_decrease,
    compare_chart_legend: {
      previous: {
        period: prevLabel,
        label: prevLabel ? displayPeriod(prevLabel) : null,
        color: '#1976d2',
      },
      current: {
        period: periodRow.label,
        label: displayPeriod(periodRow.label),
        color: '#43a047',
      },
    },
  };
}

/**
 * Rebuild narrative after attachScopedRankings recomputes top/bottom cards.
 * Keeps summary text aligned with scoped performers.
 */
function rebuildNarrativeFromPayload(data) {
  if (!data || typeof data !== 'object') return data;
  const levelLabel = contentLevelLabel(data.content_geo_level || 'division');
  const positives = Array.isArray(data.key_indicators?.positive)
    ? data.key_indicators.positive
    : Array.isArray(data.keyIndicators?.positive)
      ? data.keyIndicators.positive
      : [];
  data.narrative = buildNarrative({
    bestIndicators: positives,
    topAreas: data.top_performers || data.topPerformers || [],
    bottomAreas: data.bottom_performers || data.bottomPerformers || [],
    levelLabel,
  });
  return data;
}

module.exports = {
  getExecutiveSummary,
  rebuildNarrativeFromPayload,
  buildNarrative,
  contentLevelLabel,
  LOWER_IS_BETTER: new Set(),
};
