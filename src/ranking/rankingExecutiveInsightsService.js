/**
 * Executive Summary bottom sections: Insights, Rank Movement, Indicator matrix.
 * Division mode → district content; district mode → block content.
 * Scoped logins filter to their division districts / district blocks (response shape unchanged).
 * Data from indicator_outcome_*.
 */
const { query } = require('../db/pool');
const {
  resolveOutcomePeriod,
  loadCompositeByPeriod: loadOutcomeComposite,
  loadIndicatorByPeriod,
} = require('../outcome/outcomeRankingQueries');
const { normalizeName } = require('../services/geoScopeService');

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
  return resolveOutcomePeriod(period);
}

async function loadCompositeByPeriod(geoLevel, periodLabels) {
  const rows = await loadOutcomeComposite(geoLevel, periodLabels);
  return rows.map((r) => ({
    period: r.period,
    name: r.name,
    value: r.value,
    rank: r.rank,
    district_name: r.district_name || null,
  }));
}

function buildRankColumn(rows, period, total) {
  const filtered = rows.filter((r) => r.period === period);
  const sorted = [...filtered].sort((a, b) => {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    return (b.value ?? 0) - (a.value ?? 0);
  });
  return sorted.map((r, idx) => {
    const stateRank = r.rank ?? idx + 1;
    const rank = idx + 1; // dense 1..n within this column (chart / scoped list)
    return {
      areaId: geoKey(r.name),
      areaName: shortGeoName(r.name),
      rank,
      state_rank: stateRank,
      score: round(r.value, 2),
      color: rankTierColor(rank, total),
      district_name: r.district_name || null,
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
  const { rows: inds } = await query(
    `
    SELECT code, short_name, name, unit, is_negative, sno
    FROM indicator
    WHERE is_active = TRUE AND code ~ '^IND\\d{3}$'
    ORDER BY sno NULLS LAST, code
    `
  );

  const byKey = new Map();
  for (const ind of inds) {
    const rows = await loadIndicatorByPeriod({
      geoLevel,
      indicatorCode: ind.code,
      periodLabels: labels,
      isNegative: !!ind.is_negative,
    });
    for (const r of rows) {
      const key = `${geoKey(r.name)}::${ind.code}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          areaId: geoKey(r.name),
          areaName: shortGeoName(r.name),
          code: ind.code,
          indicatorName: (ind.short_name || ind.name || ind.code).toUpperCase(),
          lowerIsBetter: !!ind.is_negative,
          current: null,
          previous: null,
        });
      }
      const row = byKey.get(key);
      if (r.period === currentLabel) row.current = r.value;
      if (r.period === prevLabel) row.previous = r.value;
    }
  }

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

/** Allowed area names for scoped login; null = statewide (no filter). */
function allowedAreaNames(scope, contentGeo) {
  if (!scope || scope.isStateAdmin || scope.unrestricted) return null;
  if (contentGeo === 'district') {
    if (scope.level === 'division') {
      return new Set(
        (scope.districtNamesInDivision || []).map((n) => normalizeName(n))
      );
    }
    if (scope.level === 'district' || scope.level === 'block') {
      return new Set([normalizeName(scope.districtName)].filter(Boolean));
    }
  }
  if (contentGeo === 'block') {
    if (scope.level === 'block') {
      return new Set([normalizeName(scope.blockName)].filter(Boolean));
    }
    if (scope.level === 'district') {
      return new Set(
        (scope.blockNamesInDistrict || []).map((n) => normalizeName(n))
      );
    }
    if (scope.level === 'division') {
      // Division login on block content: all blocks under districts in that division
      const districts = new Set(
        (scope.districtNamesInDivision || []).map((n) => normalizeName(n))
      );
      return { type: 'block_by_district', districts };
    }
  }
  return null;
}

function nameAllowed(name, allowed) {
  if (!allowed) return true;
  if (allowed instanceof Set) return allowed.has(normalizeName(name));
  return true;
}

function filterCompositeByScope(rows, scope, contentGeo) {
  const allowed = allowedAreaNames(scope, contentGeo);
  if (!allowed) return rows;
  if (allowed instanceof Set) {
    return rows.filter((r) => nameAllowed(r.name, allowed));
  }
  if (allowed.type === 'block_by_district') {
    return rows.filter((r) =>
      allowed.districts.has(normalizeName(r.district_name || ''))
    );
  }
  return rows;
}

function filterIndicatorRowsByScope(rows, scope, contentGeo) {
  const allowed = allowedAreaNames(scope, contentGeo);
  if (!allowed) return rows;
  if (allowed instanceof Set) {
    return rows.filter((r) => nameAllowed(r.areaName, allowed));
  }
  return rows;
}

/**
 * Insights + 3-month rank movement.
 * State/sysadmin: division → divisions; district → districts.
 * Division login → districts; district login → blocks.
 */
async function getRankInsights({ period, mode = 'division', scope = null } = {}) {
  const viewMode = mode === 'district' ? 'district' : 'division';
  const statewide = !scope || scope.isStateAdmin || scope.unrestricted;
  const contentGeo = statewide
    ? viewMode === 'district'
      ? 'district'
      : 'division'
    : scope.level === 'division'
      ? 'district'
      : 'block';
  const levelLabel =
    contentGeo === 'block' ? 'Block' : contentGeo === 'district' ? 'District' : 'Division';
  const periodRow = await resolvePeriod(period);
  if (!periodRow) {
    return {
      has_data: false,
      message: 'No outcome periods synced yet',
      period: period || null,
      mode: viewMode,
      content_geo_level: contentGeo,
    };
  }

  const periodKeys = trailingMonths(periodRow.label, 3);
  const prevLabel = prevMonthLabel(periodRow.label);
  let compositeRows = await loadCompositeByPeriod(contentGeo, periodKeys);
  compositeRows = filterCompositeByScope(compositeRows, scope, contentGeo);

  const latestCount = compositeRows.filter(
    (r) => r.period === periodRow.label
  ).length;
  const total = Math.max(latestCount, 1);
  const columns = periodKeys.map((pl) => buildRankColumn(compositeRows, pl, total));
  const colMax = Math.max(...columns.map((c) => c.length), total);
  const rankInsights = buildRankInsights(columns, periodKeys, levelLabel);

  let indicatorRows = await loadIndicatorMoM(
    contentGeo,
    periodRow.label,
    prevLabel
  );
  indicatorRows = filterIndicatorRowsByScope(indicatorRows, scope, contentGeo);
  const indicatorInsights = buildIndicatorInsights(indicatorRows, levelLabel);

  return {
    has_data: true,
    period: periodRow.label,
    mode: viewMode,
    content_geo_level: contentGeo,
    period_label: displayPeriod(periodRow.label),
    insights: {
      ...rankInsights,
      ...indicatorInsights,
    },
    rank_movement: {
      geo_level: contentGeo,
      periods: periodKeys,
      period_labels: periodKeys.map(formatPeriodTick),
      total: colMax,
      columns,
    },
  };
}

async function loadMatrixData(geoLevel, currentLabel, prevLabel) {
  const labels = prevLabel ? [currentLabel, prevLabel] : [currentLabel];
  const out = [];

  const composite = await loadOutcomeComposite(geoLevel, labels);
  for (const r of composite) {
    out.push({
      period: r.period,
      geo_name: r.name,
      district_name: r.district_name || null,
      rank: r.rank,
      value: r.value,
      code: 'RANK_COMPOSITE',
      short_name: 'Overall composite score',
      name: 'Overall composite score',
      unit: 'index',
      sort_order: 0,
      is_composite: true,
      is_negative: false,
    });
  }

  const { rows: inds } = await query(
    `
    SELECT code, short_name, name, unit, is_negative, sno
    FROM indicator
    WHERE is_active = TRUE AND code ~ '^IND\\d{3}$'
    ORDER BY sno NULLS LAST, code
    `
  );
  for (const ind of inds) {
    const rows = await loadIndicatorByPeriod({
      geoLevel,
      indicatorCode: ind.code,
      periodLabels: labels,
      isNegative: !!ind.is_negative,
    });
    for (const r of rows) {
      out.push({
        period: r.period,
        geo_name: r.name,
        district_name: r.district_name || null,
        rank: r.rank,
        value: r.value,
        code: ind.code,
        short_name: ind.short_name || ind.name,
        name: ind.name,
        unit: ind.unit,
        sort_order: ind.sno != null ? Number(ind.sno) : 999,
        is_composite: false,
        is_negative: !!ind.is_negative,
      });
    }
  }
  return out;
}

/**
 * Indicator × area matrix with MoM trend arrows.
 * State/sysadmin: division → divisions; district → districts.
 * Division login → districts; district login → blocks.
 */
async function getIndicatorPerformanceMatrix({
  period,
  mode = 'district',
  scope = null,
} = {}) {
  const viewMode = mode === 'division' ? 'division' : 'district';
  const statewide = !scope || scope.isStateAdmin || scope.unrestricted;
  const contentGeo = statewide
    ? viewMode === 'division'
      ? 'division'
      : 'district'
    : scope.level === 'division'
      ? 'district'
      : 'block';
  const periodRow = await resolvePeriod(period);
  if (!periodRow) {
    return {
      has_data: false,
      message: 'No outcome periods synced yet',
      period: period || null,
      mode: viewMode,
      content_geo_level: contentGeo,
    };
  }

  const prevLabel = prevMonthLabel(periodRow.label);
  let rows = await loadMatrixData(contentGeo, periodRow.label, prevLabel);

  const allowed = allowedAreaNames(scope, contentGeo);
  if (allowed instanceof Set) {
    rows = rows.filter((r) => nameAllowed(r.geo_name, allowed));
  } else if (allowed?.type === 'block_by_district') {
    rows = rows.filter((r) =>
      allowed.districts.has(normalizeName(r.district_name || ''))
    );
  }

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
        lowerIsBetter: !!r.is_negative,
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
    mode: viewMode,
    content_geo_level: contentGeo,
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
