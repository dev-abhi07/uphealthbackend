/**
 * Executive Summary bottom sections: Insights, Rank Movement, Indicator matrix.
 */
const { query } = require('../db/pool');
const { LOWER_IS_BETTER } = require('./rankingExecutiveSummaryService');

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

function geoKey(name) {
  return shortGeoName(name).toLowerCase().replace(/\s+/g, '-');
}

function displayPeriod(label) {
  const m = String(label || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return label;
  const names = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${names[Number(m[2]) - 1]} ${m[1]}`;
}

function formatPeriodTick(label) {
  const m = String(label || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(label || '').toUpperCase();
  const names = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${names[Number(m[2]) - 1]}'${m[1].slice(-2)}`;
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

function rankTierColor(rank, total = 18) {
  const r = Number(rank) || total;
  const third = Math.max(1, Math.ceil(total / 3));
  if (r <= third) return '#0f9d58';
  if (r <= third * 2) return '#f59e0b';
  return '#d62828';
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

function buildRankColumn(rows, period, total) {
  const filtered = rows.filter((r) => r.period === period);
  const sorted = [...filtered].sort((a, b) => {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    return (b.value ?? 0) - (a.value ?? 0);
  });
  return sorted.map((r, idx) => {
    const rank = r.rank ?? idx + 1;
    return {
      areaId: geoKey(r.name),
      areaName: shortGeoName(r.name),
      rank,
      score: round(r.value, 2),
      color: rankTierColor(rank, total),
    };
  });
}

function buildRankInsights(columns, periodKeys, levelLabel) {
  const current = columns[columns.length - 1] || [];
  const previous = columns[columns.length - 2] || [];
  const total = current.length || 1;
  const prevMap = new Map(previous.map((r) => [r.areaId, r]));

  let bestUp = null;
  let bestDown = null;

  current.forEach((row) => {
    const prev = prevMap.get(row.areaId);
    if (!prev) return;
    const delta = prev.rank - row.rank;
    if (!bestUp || delta > bestUp.delta) {
      bestUp = {
        areaId: row.areaId,
        areaName: row.areaName,
        currentRank: row.rank,
        previousRank: prev.rank,
        delta,
        total,
        currentPeriod: periodKeys[periodKeys.length - 1],
        previousPeriod: periodKeys[periodKeys.length - 2],
      };
    }
    if (!bestDown || delta < bestDown.delta) {
      bestDown = {
        areaId: row.areaId,
        areaName: row.areaName,
        currentRank: row.rank,
        previousRank: prev.rank,
        delta,
        total,
        currentPeriod: periodKeys[periodKeys.length - 1],
        previousPeriod: periodKeys[periodKeys.length - 2],
      };
    }
  });

  return {
    highestRankIncrease: bestUp
      ? {
          ...bestUp,
          title: 'Highest increase in rank from last month based on composite score',
          levelLabel,
        }
      : null,
    maxRankDecrease: bestDown
      ? {
          ...bestDown,
          title: 'Maximum decrease in rank from last month based on composite score',
          levelLabel,
        }
      : null,
  };
}

async function loadIndicatorMoM(geoLevel, currentLabel, prevLabel) {
  if (!currentLabel) return [];
  const labels = prevLabel ? [currentLabel, prevLabel] : [currentLabel];
  const { rows } = await query(
    `
    SELECT p.label AS period, v.geo_name, i.code, i.short_name, i.name, i.unit,
           v.value::float AS value
    FROM ranking_value v
    JOIN ranking_indicator i ON i.id = v.indicator_id
    JOIN ranking_period p ON p.id = v.period_id
    WHERE v.geo_level = $1
      AND p.label = ANY($2::text[])
      AND i.is_active = TRUE
      AND i.is_composite = FALSE
      AND i.code <> 'RANK_ASHA_EXP'
    `,
    [geoLevel, labels]
  );

  const byKey = new Map();
  rows.forEach((r) => {
    const key = `${geoKey(r.geo_name)}::${r.code}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        areaId: geoKey(r.geo_name),
        areaName: shortGeoName(r.geo_name),
        code: r.code,
        indicatorName: (r.short_name || r.name || r.code).toUpperCase(),
        lowerIsBetter: LOWER_IS_BETTER.has(r.code),
        current: null,
        previous: null,
      });
    }
    const row = byKey.get(key);
    const val = num(r.value);
    if (r.period === currentLabel) row.current = val;
    if (r.period === prevLabel) row.previous = val;
  });

  return [...byKey.values()].filter((r) => r.current != null && r.previous != null);
}

function pctChange(current, previous) {
  if (current == null || previous == null) return null;
  if (previous === 0) {
    if (current === 0) return 0;
    return current > 0 ? 100 : -100;
  }
  return round(((current - previous) / Math.abs(previous)) * 100, 1);
}

function buildIndicatorInsights(rows, levelLabel) {
  let bestIncrease = null;
  let bestDecrease = null;

  rows.forEach((row) => {
    const change = row.current - row.previous;
    const pct = pctChange(row.current, row.previous);
    if (pct == null) return;

    const increaseCandidate = {
      areaId: row.areaId,
      areaName: row.areaName,
      indicatorName: row.indicatorName,
      value: round(row.current, 2),
      pctChange: pct,
      title: 'Highest increase in indicator from last month',
      levelLabel,
      lowerIsBetter: row.lowerIsBetter,
    };
    const decreaseCandidate = {
      areaId: row.areaId,
      areaName: row.areaName,
      indicatorName: row.indicatorName,
      value: round(row.current, 2),
      pctChange: pct,
      title: 'Maximum decrease in indicator from last month',
      levelLabel,
      lowerIsBetter: row.lowerIsBetter,
    };

    if (!bestIncrease || pct > bestIncrease.pctChange) {
      bestIncrease = increaseCandidate;
    }
    if (!bestDecrease || pct < bestDecrease.pctChange) {
      bestDecrease = decreaseCandidate;
    }
  });

  return {
    highestIndicatorIncrease: bestIncrease,
    maxIndicatorDecrease: bestDecrease,
  };
}

function matrixKind(unit) {
  if (unit === 'percent') return 'percent';
  if (unit === 'index') return 'rank';
  if (unit === 'amount') return 'number';
  return 'ratio';
}

function formatMatrixDisplay(kind, value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  if (kind === 'rank') return String(Math.round(n));
  if (kind === 'percent') {
    const pct = n <= 1 ? n * 100 : n;
    if (Math.abs(pct - Math.round(pct)) < 0.005) return `${Math.round(pct)}%`;
    return `${pct.toFixed(2)}%`;
  }
  if (kind === 'number') return n % 1 === 0 ? String(n) : n.toFixed(2);
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function resolveTrend(delta, { lowerIsBetter = false, flatEps = 0.005 } = {}) {
  if (delta == null || Number.isNaN(Number(delta))) return 'flat';
  const d = Number(delta);
  if (Math.abs(d) <= flatEps) return 'flat';
  const improved = lowerIsBetter ? d < 0 : d > 0;
  return improved ? 'up' : 'down';
}

/**
 * Insights + 3-month rank movement (division level for Sankey chart).
 */
async function getRankInsights({ period, mode = 'division' } = {}) {
  const geoLevel = mode === 'district' ? 'district' : 'division';
  const levelLabel = geoLevel === 'division' ? 'Division' : 'District';
  const periodRow = await resolvePeriod(period);
  if (!periodRow) {
    return {
      has_data: false,
      message: 'No ranking periods imported yet',
      period: period || null,
      mode: geoLevel,
    };
  }

  const periodKeys = trailingMonths(periodRow.label, 3);
  const prevLabel = prevMonthLabel(periodRow.label);
  const compositeRows = await loadCompositeByPeriod('division', periodKeys);
  const total = Math.max(
    ...periodKeys.map((pl) => compositeRows.filter((r) => r.period === pl).length),
    1
  );
  const columns = periodKeys.map((pl) => buildRankColumn(compositeRows, pl, total));
  const rankInsights = buildRankInsights(columns, periodKeys, 'Division');

  const indicatorRows = await loadIndicatorMoM(
    geoLevel,
    periodRow.label,
    prevLabel
  );
  const indicatorInsights = buildIndicatorInsights(indicatorRows, levelLabel);

  return {
    has_data: true,
    period: periodRow.label,
    mode: geoLevel,
    period_label: displayPeriod(periodRow.label),
    insights: {
      ...rankInsights,
      ...indicatorInsights,
    },
    rank_movement: {
      periods: periodKeys,
      period_labels: periodKeys.map(formatPeriodTick),
      total,
      columns,
    },
  };
}

async function loadMatrixData(geoLevel, currentLabel, prevLabel) {
  const labels = prevLabel ? [currentLabel, prevLabel] : [currentLabel];
  const { rows } = await query(
    `
    SELECT p.label AS period, v.geo_name, v.rank, v.value::float AS value,
           i.code, i.short_name, i.name, i.unit, i.sort_order, i.is_composite
    FROM ranking_value v
    JOIN ranking_indicator i ON i.id = v.indicator_id
    JOIN ranking_period p ON p.id = v.period_id
    WHERE v.geo_level = $1
      AND p.label = ANY($2::text[])
      AND i.is_active = TRUE
      AND i.code <> 'RANK_ASHA_EXP'
    ORDER BY i.sort_order, v.geo_name
    `,
    [geoLevel, labels]
  );
  return rows;
}

/**
 * Indicator × area matrix with MoM trend arrows.
 */
async function getIndicatorPerformanceMatrix({ period, mode = 'district' } = {}) {
  const geoLevel = mode === 'division' ? 'division' : 'district';
  const periodRow = await resolvePeriod(period);
  if (!periodRow) {
    return {
      has_data: false,
      message: 'No ranking periods imported yet',
      period: period || null,
      mode: geoLevel,
    };
  }

  const prevLabel = prevMonthLabel(periodRow.label);
  const rows = await loadMatrixData(geoLevel, periodRow.label, prevLabel);

  const areaMap = new Map();
  const indicatorMap = new Map();
  const valueMap = new Map();

  rows.forEach((r) => {
    const areaId = geoKey(r.geo_name);
    if (!areaMap.has(areaId)) {
      areaMap.set(areaId, {
        id: areaId,
        name: shortGeoName(r.geo_name),
      });
    }

    if (r.is_composite) return;

    const indId = r.code;
    if (!indicatorMap.has(indId)) {
      const kind = matrixKind(r.unit);
      indicatorMap.set(indId, {
        id: indId,
        code: r.code,
        name: (r.short_name || r.name || r.code).toUpperCase(),
        kind,
        lowerIsBetter: LOWER_IS_BETTER.has(r.code),
        sortOrder: r.sort_order,
      });
    }

    const key = `${areaId}::${indId}::${r.period}`;
    valueMap.set(key, {
      value: num(r.value),
      rank: r.rank != null ? Number(r.rank) : null,
    });
  });

  const areas = [...areaMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  const rankRows = rows.filter(
    (r) => r.is_composite && r.period === periodRow.label
  );
  rankRows.forEach((r) => {
    const areaId = geoKey(r.geo_name);
    const key = `${areaId}::RANK_COMPOSITE::${r.period}`;
    valueMap.set(key, { value: num(r.rank ?? r.value), rank: r.rank });
  });

  const prevRankKey = (areaId) => `${areaId}::RANK_COMPOSITE::${prevLabel}`;
  rankRows.forEach((r) => {
    const areaId = geoKey(r.geo_name);
    const prev = valueMap.get(prevRankKey(areaId));
    if (prevLabel) {
      const prevRow = rows.find(
        (x) =>
          x.is_composite &&
          x.period === prevLabel &&
          geoKey(x.geo_name) === areaId
      );
      if (prevRow) {
        valueMap.set(prevRankKey(areaId), {
          value: num(prevRow.rank ?? prevRow.value),
          rank: prevRow.rank,
        });
      }
    }
  });

  const indicatorList = [...indicatorMap.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder
  );

  const overallRankIndicator = {
    id: 'overall_rank',
    name: 'OVERALL RANK',
    kind: 'rank',
    lowerIsBetter: true,
    cells: {},
  };

  areas.forEach((area) => {
    const cur = valueMap.get(`${area.id}::RANK_COMPOSITE::${periodRow.label}`);
    const prev = prevLabel
      ? valueMap.get(`${area.id}::RANK_COMPOSITE::${prevLabel}`)
      : null;
    const value = cur?.value ?? cur?.rank ?? null;
    const previous = prev?.value ?? prev?.rank ?? null;
    const delta =
      value != null && previous != null ? round(value - previous, 4) : null;
    overallRankIndicator.cells[area.id] = {
      value,
      previous,
      delta,
      trend: resolveTrend(delta, { lowerIsBetter: true, flatEps: 0 }),
      display: formatMatrixDisplay('rank', value),
    };
  });

  const indicators = [
    overallRankIndicator,
    ...indicatorList.map((ind) => {
      const cells = {};
      areas.forEach((area) => {
        const cur = valueMap.get(`${area.id}::${ind.code}::${periodRow.label}`);
        const prev = prevLabel
          ? valueMap.get(`${area.id}::${ind.code}::${prevLabel}`)
          : null;
        const value = cur?.value ?? null;
        const previous = prev?.value ?? null;
        const delta =
          value != null && previous != null ? round(value - previous, 4) : null;
        const flatEps = ind.kind === 'percent' ? 0.002 : 0.01;
        cells[area.id] = {
          value,
          previous,
          delta,
          trend: resolveTrend(delta, {
            lowerIsBetter: ind.lowerIsBetter,
            flatEps,
          }),
          display: formatMatrixDisplay(ind.kind, value),
        };
      });
      return {
        id: ind.id,
        name: ind.name,
        kind: ind.kind,
        lower_is_better: ind.lowerIsBetter,
        cells,
      };
    }),
  ];

  return {
    has_data: true,
    period: periodRow.label,
    mode: geoLevel,
    period_label: formatPeriodTick(periodRow.label),
    total_areas: areas.length,
    areas,
    indicators,
  };
}

module.exports = {
  getRankInsights,
  getIndicatorPerformanceMatrix,
};
