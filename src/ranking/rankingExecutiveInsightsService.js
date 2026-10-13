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

/** Stable identity for rank-movement links (LGD / id — never bare name alone). */
function entityKey(row, geoLevel) {
  const level = String(geoLevel || '').toLowerCase();
  if (level === 'block' && row.block_lgd != null && row.block_lgd !== '') {
    return `b-${row.block_lgd}`;
  }
  if (level === 'district' && row.district_lgd != null && row.district_lgd !== '') {
    return `d-${row.district_lgd}`;
  }
  if (level === 'division') {
    if (row.division_id != null && row.division_id !== '') {
      return `v-${row.division_id}`;
    }
    if (row.division_code != null && row.division_code !== '') {
      return `v-${row.division_code}`;
    }
  }
  // Fallback: name + district so two "Rajpura" blocks in theory stay distinct
  const dist = row.district_lgd != null ? String(row.district_lgd) : '';
  return `n-${geoKey(row.name)}${dist ? `@${dist}` : ''}`;
}

/**
 * One row per entity per period (outcome sync can emit duplicate block names/LGDs).
 * Keeps the better statewide rank, then higher composite.
 */
function dedupeCompositeRows(rows, geoLevel) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const best = new Map();
  for (const r of rows) {
    const key = `${r.period || ''}::${entityKey(r, geoLevel)}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, r);
      continue;
    }
    const prevRank = prev.rank != null ? Number(prev.rank) : 99999;
    const nextRank = r.rank != null ? Number(r.rank) : 99999;
    if (nextRank < prevRank) {
      best.set(key, r);
    } else if (
      nextRank === prevRank &&
      Number(r.value ?? -Infinity) > Number(prev.value ?? -Infinity)
    ) {
      best.set(key, r);
    }
  }
  return [...best.values()];
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
    block_lgd: r.block_lgd != null ? Number(r.block_lgd) : null,
    district_lgd: r.district_lgd != null ? Number(r.district_lgd) : null,
    division_id: r.division_id != null ? Number(r.division_id) : null,
    division_code: r.division_code != null ? String(r.division_code) : null,
    district_name: r.district_name || null,
  }));
}

function buildRankColumn(rows, period, total, geoLevel) {
  const filtered = rows.filter((r) => r.period === period);
  const sorted = [...filtered].sort((a, b) => {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    return (b.value ?? 0) - (a.value ?? 0);
  });
  const mapped = sorted.map((r, idx) => {
    const stateRank = r.rank ?? idx + 1;
    const rank = idx + 1; // dense 1..n within this column (chart / scoped list)
    return {
      areaId: entityKey(r, geoLevel),
      areaName: shortGeoName(r.name),
      rank,
      state_rank: stateRank,
      score: round(r.value, 2),
      color: rankTierColor(rank, total),
      district_name: r.district_name || null,
      block_lgd: r.block_lgd,
      district_lgd: r.district_lgd,
    };
  });

  // Same display name, different LGD → keep both, label distinctly
  const nameCounts = new Map();
  for (const m of mapped) {
    const n = String(m.areaName || '').toLowerCase();
    nameCounts.set(n, (nameCounts.get(n) || 0) + 1);
  }
  const nameSeen = new Map();
  return mapped.map((m) => {
    const n = String(m.areaName || '').toLowerCase();
    if ((nameCounts.get(n) || 0) <= 1) return m;
    const i = (nameSeen.get(n) || 0) + 1;
    nameSeen.set(n, i);
    const tag =
      m.block_lgd != null
        ? String(m.block_lgd)
        : m.district_lgd != null
          ? String(m.district_lgd)
          : String(i);
    return { ...m, areaName: `${m.areaName} (${tag})` };
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
    const code = String(ind.code || '').toUpperCase();
    const lowerIsBetter =
      !!ind.is_negative || code === 'IND010' || code === 'IND011';
    const rows = await loadIndicatorByPeriod({
      geoLevel,
      indicatorCode: ind.code,
      periodLabels: labels,
      isNegative: lowerIsBetter,
    });
    for (const r of rows) {
      const idPart =
        r.block_lgd != null
          ? `b-${r.block_lgd}`
          : r.district_lgd != null
            ? `d-${r.district_lgd}`
            : geoKey(r.name);
      const key = `${idPart}::${ind.code}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          areaId: idPart,
          areaName: shortGeoName(r.name),
          code: ind.code,
          indicatorName: (ind.short_name || ind.name || ind.code).toUpperCase(),
          lowerIsBetter,
          district_lgd: r.district_lgd != null ? Number(r.district_lgd) : null,
          district_name: r.district_name || null,
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

function resolveTrend(delta, { lowerIsBetter = false, flatEps = 0.005 } = {}) {
  if (delta == null || Number.isNaN(Number(delta))) return 'flat';
  const d = Number(delta);
  if (Math.abs(d) <= flatEps) return 'flat';
  const improved = lowerIsBetter ? d < 0 : d > 0;
  return improved ? 'up' : 'down';
}

function buildIndicatorInsights(rows, levelLabel) {
  let bestIncrease = null;
  let bestDecrease = null;

  rows.forEach((row) => {
    const change = row.current - row.previous;
    const pct = pctChange(row.current, row.previous);
    if (pct == null) return;
    const lowerIsBetter = !!row.lowerIsBetter;
    // Semantic: 'up' = improved (green), 'down' = worsened (red)
    const trend = resolveTrend(change, { lowerIsBetter, flatEps: 0 });

    const increaseCandidate = {
      areaId: row.areaId,
      areaName: row.areaName,
      code: row.code || null,
      indicatorName: row.indicatorName,
      value: round(row.current, 2),
      pctChange: pct,
      title: 'Highest increase in indicator from last month',
      levelLabel,
      lowerIsBetter,
      lower_is_better: lowerIsBetter,
      trend,
    };
    const decreaseCandidate = {
      areaId: row.areaId,
      areaName: row.areaName,
      code: row.code || null,
      indicatorName: row.indicatorName,
      value: round(row.current, 2),
      pctChange: pct,
      title: 'Maximum decrease in indicator from last month',
      levelLabel,
      lowerIsBetter,
      lower_is_better: lowerIsBetter,
      trend,
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

/** Indicators: |value| < 10 keep decimals; 10+ whole number. */
function formatIndicatorNumber(n) {
  if (Math.abs(n) < 10) return Number(n.toFixed(2)).toString();
  return String(Math.round(n));
}

function formatMatrixDisplay(kind, value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  if (kind === 'rank') return String(Math.round(n));
  if (kind === 'percent') {
    const pct = n <= 1 ? n * 100 : n;
    return `${formatIndicatorNumber(pct)}%`;
  }
  return formatIndicatorNumber(n);
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
      // Prefer district_lgd (keeps Urban / synthetic LGDs); name set is fallback.
      return {
        type: 'block_in_district',
        districtLgd:
          scope.districtLgd != null ? Number(scope.districtLgd) : null,
        districtName: normalizeName(scope.districtName || ''),
        blocks: new Set(
          (scope.blockNamesInDistrict || []).map((n) => normalizeName(n))
        ),
      };
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
  if (allowed.type === 'block_in_district') {
    // Strict district scope — never keep foreign blocks via shared names.
    return rows.filter((r) => {
      if (
        allowed.districtLgd != null &&
        r.district_lgd != null &&
        Number(r.district_lgd) === allowed.districtLgd
      ) {
        return true;
      }
      if (
        allowed.districtName &&
        normalizeName(r.district_name || '') === allowed.districtName
      ) {
        return true;
      }
      return false;
    });
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
  if (allowed.type === 'block_in_district') {
    return rows.filter((r) => {
      if (
        allowed.districtLgd != null &&
        r.district_lgd != null &&
        Number(r.district_lgd) === allowed.districtLgd
      ) {
        return true;
      }
      if (
        allowed.districtName &&
        normalizeName(r.district_name || '') === allowed.districtName
      ) {
        return true;
      }
      return false;
    });
  }
  if (allowed.type === 'block_by_district') {
    return rows.filter((r) =>
      allowed.districts.has(normalizeName(r.district_name || ''))
    );
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
  // Drop duplicate outcome rows (same block/district LGD twice → double "RAJPURA")
  compositeRows = dedupeCompositeRows(compositeRows, contentGeo);

  const latestCount = compositeRows.filter(
    (r) => r.period === periodRow.label
  ).length;
  const total = Math.max(latestCount, 1);
  const columns = periodKeys.map((pl) =>
    buildRankColumn(compositeRows, pl, total, contentGeo)
  );
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
      district_lgd: r.district_lgd != null ? Number(r.district_lgd) : null,
      block_lgd: r.block_lgd != null ? Number(r.block_lgd) : null,
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
    const code = String(ind.code || '').toUpperCase();
    const isNegative =
      !!ind.is_negative || code === 'IND010' || code === 'IND011';
    const rows = await loadIndicatorByPeriod({
      geoLevel,
      indicatorCode: ind.code,
      periodLabels: labels,
      isNegative,
    });
    for (const r of rows) {
      out.push({
        period: r.period,
        geo_name: r.name,
        district_name: r.district_name || null,
        district_lgd: r.district_lgd != null ? Number(r.district_lgd) : null,
        block_lgd: r.block_lgd != null ? Number(r.block_lgd) : null,
        rank: r.rank,
        value: r.value,
        code: ind.code,
        short_name: ind.short_name || ind.name,
        name: ind.name,
        unit: ind.unit,
        sort_order: ind.sno != null ? Number(ind.sno) : 999,
        is_composite: false,
        is_negative: isNegative,
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
  } else if (allowed?.type === 'block_in_district') {
    // District login: only that district's blocks (was unfiltered → all ~900)
    rows = rows.filter((r) => {
      if (
        allowed.districtLgd != null &&
        r.district_lgd != null &&
        Number(r.district_lgd) === allowed.districtLgd
      ) {
        return true;
      }
      if (
        allowed.districtName &&
        normalizeName(r.district_name || '') === allowed.districtName
      ) {
        return true;
      }
      return false;
    });
  } else if (allowed?.type === 'block_by_district') {
    rows = rows.filter((r) =>
      allowed.districts.has(normalizeName(r.district_name || ''))
    );
  }

  const matrixAreaId = (r) => {
    if (contentGeo === 'block' && r.block_lgd != null) return `b-${r.block_lgd}`;
    if (contentGeo === 'district' && r.district_lgd != null) {
      return `d-${r.district_lgd}`;
    }
    return geoKey(r.geo_name);
  };

  const areaMap = new Map();
  const indicatorMap = new Map();
  const valueMap = new Map();

  rows.forEach((r) => {
    const areaId = matrixAreaId(r);
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
    const areaId = matrixAreaId(r);
    const key = `${areaId}::RANK_COMPOSITE::${r.period}`;
    valueMap.set(key, { value: num(r.rank ?? r.value), rank: r.rank });
  });

  const prevRankKey = (areaId) => `${areaId}::RANK_COMPOSITE::${prevLabel}`;
  rankRows.forEach((r) => {
    const areaId = matrixAreaId(r);
    if (prevLabel) {
      const prevRow = rows.find(
        (x) =>
          x.is_composite &&
          x.period === prevLabel &&
          matrixAreaId(x) === areaId
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
