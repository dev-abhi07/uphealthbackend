/**
 * UP Health Executive Summary — division (or district) performance snapshot.
 * UI: Top/Bottom 3, narrative, key indicators, map ranks, MoM change charts.
 */
const { query } = require('../db/pool');

/** Indicators where lower value is better (for best/worst KPI ranking). */
const LOWER_IS_BETTER = new Set([
  'RANK_STILLBIRTH',
  'RANK_OUTLIER',
  'RANK_CSECTION_CHC_70',
  'RANK_CSECTION_DH_30',
  'RANK_DEL_LOAD_POINT',
  'RANK_DEL_LOAD_ANM',
]);

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
  if (period) {
    const { rows } = await query(
      `SELECT * FROM ranking_period WHERE label = $1 OR display ILIKE $1 LIMIT 1`,
      [period]
    );
    return rows[0] || null;
  }
  const { rows } = await query(
    `
    SELECT p.* FROM ranking_period p
    JOIN ranking_value v ON v.period_id = p.id
    WHERE v.geo_level = 'division'
    GROUP BY p.id
    ORDER BY p.label DESC
    LIMIT 1
    `
  );
  return rows[0] || null;
}

async function loadCompositeByPeriod(geoLevel, periodLabels) {
  if (!periodLabels.length) return [];
  const { rows } = await query(
    `
    SELECT p.label AS period, v.geo_name, v.value::float AS value, v.rank
    FROM ranking_value v
    JOIN ranking_indicator i ON i.id = v.indicator_id
    JOIN ranking_period p ON p.id = v.period_id
    WHERE i.code = 'RANK_COMPOSITE'
      AND v.geo_level = $1
      AND p.label = ANY($2::text[])
    `,
    [geoLevel, periodLabels]
  );
  return rows.map((r) => ({
    period: r.period,
    name: r.geo_name,
    value: num(r.value),
    rank: r.rank != null ? Number(r.rank) : null,
  }));
}

async function loadStatewideIndicatorAvgs(periodLabel) {
  const { rows } = await query(
    `
    SELECT i.code, i.short_name, i.name, i.unit, i.sort_order,
           AVG(v.value::float) AS avg_val
    FROM ranking_value v
    JOIN ranking_indicator i ON i.id = v.indicator_id
    JOIN ranking_period p ON p.id = v.period_id
    WHERE v.geo_level = 'district'
      AND p.label = $1
      AND i.is_active = TRUE
      AND i.is_composite = FALSE
      AND i.code <> 'RANK_ASHA_EXP'
    GROUP BY i.id
    HAVING COUNT(v.id) > 0
    ORDER BY i.sort_order
    `,
    [periodLabel]
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.short_name || r.name,
    full_name: r.name,
    unit: r.unit,
    value: round(r.avg_val, 2),
    lower_is_better: LOWER_IS_BETTER.has(r.code),
  }));
}

function pickBestWorstIndicators(indicators, n = 3) {
  // Score: higher = better performance for ranking "best"
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
    display_value:
      i.unit === 'percent' ? `${i.value}%` : i.value,
    sentiment, // positive | negative
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

/**
 * Screenshot-style multi-paragraph executive narrative (dynamic from rankings).
 */
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

  // Least performing: worst rank first (matches screenshot ordering).
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

/**
 * @param {object} opts
 * @param {string} [opts.period] YYYY-MM
 * @param {'division'|'district'} [opts.level]
 * @param {number} [opts.topN]
 * @param {number} [opts.historyMonths]
 */
async function getExecutiveSummary({
  period,
  level = 'division',
  topN = 3,
  historyMonths = 3,
} = {}) {
  const geoLevel = level === 'district' ? 'district' : 'division';
  const levelLabel = geoLevel === 'division' ? 'Division' : 'District';
  const periodRow = await resolvePeriod(period);
  if (!periodRow) {
    return {
      view: 'executive_summary',
      has_data: false,
      message: 'No ranking periods imported yet',
      period: period || null,
      level: geoLevel,
    };
  }

  const historyLabels = trailingMonths(periodRow.label, historyMonths);
  const prevLabel = prevMonthLabel(periodRow.label);
  const loadLabels = [...new Set([...historyLabels, periodRow.label, prevLabel].filter(Boolean))];

  const { rows: importedRows } = await query(
    `
    SELECT DISTINCT p.label
    FROM ranking_period p
    JOIN ranking_value v ON v.period_id = p.id
    WHERE v.geo_level = $1
    ORDER BY p.label
    `,
    [geoLevel]
  );
  const imported = new Set(importedRows.map((r) => r.label));
  const availableHistory = historyLabels.filter((l) => imported.has(l));

  const allComposite = await loadCompositeByPeriod(geoLevel, loadLabels);
  const current = allComposite
    .filter((r) => r.period === periodRow.label && r.value != null)
    .sort((a, b) => {
      if (a.rank != null && b.rank != null) return a.rank - b.rank;
      return b.value - a.value;
    });

  if (!current.length) {
    return {
      view: 'executive_summary',
      has_data: false,
      message: `No ${geoLevel} composite data for ${periodRow.label}`,
      period: periodRow.label,
      period_display: displayPeriod(periodRow.label),
      level: geoLevel,
    };
  }

  const total = current.length;
  const withMeta = current.map((r, idx) => {
    const rank = r.rank != null ? r.rank : idx + 1;
    return {
      name: r.name,
      short_name: shortGeoName(r.name),
      score: round(r.value, 2),
      rank,
      band: bandForRank(rank, total),
    };
  });

  const top_3 = withMeta.slice(0, topN);
  const bottom_3 = [...withMeta].sort((a, b) => b.rank - a.rank).slice(0, topN).reverse();

  // Key indicators (statewide district averages)
  const indicatorAvgs = await loadStatewideIndicatorAvgs(periodRow.label);
  const { best_indicators, worst_indicators } = pickBestWorstIndicators(indicatorAvgs, topN);

  const narrative = buildNarrative({
    bestIndicators: best_indicators,
    topAreas: top_3,
    bottomAreas: bottom_3,
    levelLabel,
  });

  // Map + full ranking list
  const map_ranking = withMeta.map((r) => ({
    ...r,
    color_band: r.band, // top | moderate | bottom
  }));

  // Performance change: last N months + MoM delta
  const byNamePeriod = new Map();
  for (const r of allComposite) {
    if (!byNamePeriod.has(r.name)) byNamePeriod.set(r.name, new Map());
    byNamePeriod.get(r.name).set(r.period, r.value);
  }

  const performance_change = withMeta.map((r) => {
    const seriesMap = byNamePeriod.get(r.name) || new Map();
    const history = availableHistory.map((pl) => ({
      period: pl,
      period_display: displayPeriod(pl),
      period_short: displayPeriod(pl).replace(/(\w+)\s+(\d{4})/, (_, m, y) => `${m.slice(0, 3)} ${y.slice(2)}`),
      value: round(seriesMap.get(pl), 2),
    }));
    const cur = seriesMap.get(periodRow.label);
    const prev = prevLabel && imported.has(prevLabel) ? seriesMap.get(prevLabel) : null;
    const change =
      cur != null && prev != null ? round(cur - prev, 2) : null;
    return {
      rank: r.rank,
      name: r.name,
      short_name: r.short_name,
      score: r.score,
      change,
      change_display: change == null ? null : change >= 0 ? `+${change}` : `${change}`,
      trend: change == null ? null : change > 0 ? 'up' : change < 0 ? 'down' : 'same',
      history,
    };
  });

  // Highest increase / lowest decrease vs previous month
  const withChange = performance_change.filter((r) => r.change != null);
  const highest_increase = [...withChange]
    .sort((a, b) => b.change - a.change)
    .slice(0, topN)
    .map((r) => {
      const seriesMap = byNamePeriod.get(r.name) || new Map();
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
      const seriesMap = byNamePeriod.get(r.name) || new Map();
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
    // Screenshot: green = current, blue = prev, gray = older
    const colors = ['#9e9e9e', '#1976d2', '#43a047'];
    const color = colors[Math.min(idx, colors.length - 1)];
    // Prefer green for latest
    const isLatest = pl === periodRow.label;
    return {
      period: pl,
      label: displayPeriod(pl),
      short_label: displayPeriod(pl).replace(/(\w+)\s+(\d{4})/, (_, m, y) => `${m.slice(0, 3)} ${y.slice(2)}`),
      color: isLatest ? '#43a047' : color,
    };
  });
  // Fix legend colors: oldest gray, middle blue, latest green
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
    level: geoLevel,
    period: periodRow.label,
    period_display: displayPeriod(periodRow.label),
    previous_period: prevLabel && imported.has(prevLabel) ? prevLabel : null,
    previous_period_display:
      prevLabel && imported.has(prevLabel) ? displayPeriod(prevLabel) : null,
    history_periods: availableHistory,
    history_legend,
    missing_history_periods: historyLabels.filter((l) => !imported.has(l)),
    count: total,
    narrative,
    narrative_badge: displayPeriod(periodRow.label),
    top_performers: top_3,
    bottom_performers: bottom_3,
    key_indicators: {
      positive: best_indicators,
      negative: worst_indicators,
    },
    map: {
      geo_level: geoLevel,
      ranking: map_ranking,
    },
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

module.exports = {
  getExecutiveSummary,
  LOWER_IS_BETTER,
};
