/**
 * Deep Dive dashboard — rankings with MONTHLY / FY / TREND series + indicator breakup.
 * Separate from map SUMMARY `/api/ranking/dashboard`.
 */
const { query } = require('../db/pool');
const { normalizeGeoName } = require('./rankingNameNormalize');
const { formatValue: fmt } = (() => {
  // local copy to avoid circular deps; mirrors rankingService.formatValue
  function formatValue(value, unit) {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    if (Number.isNaN(n)) return null;
    if (unit === 'percent') return `${Number(n.toFixed(2))}%`;
    if (unit === 'index') return Number(n.toFixed(2));
    if (unit === 'amount') return `Rs.${Number(n.toFixed(2))}`;
    return Number(n.toFixed(2));
  }
  return { formatValue };
})();

/** Static filters (UP aspirational districts — extend as needed). */
const ASPIRATIONAL_DISTRICTS = [
  'Bahraich',
  'Balrampur',
  'Chandauli',
  'Chitrakoot',
  'Fatehpur',
  'Gonda',
  'Kaushambi',
  'Shravasti',
  'Siddharth Nagar',
  'Sonbhadra',
].map((n) => n.toLowerCase());

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function formatValue(value, unit) {
  return fmt(value, unit);
}

function parsePeriodLabel(label) {
  const m = String(label || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), label };
}

function prevMonthLabel(label) {
  const p = parsePeriodLabel(label);
  if (!p) return null;
  let { year, month } = p;
  month -= 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Indian FY Apr–Mar: periods from FY start through selected month. */
function fyPeriodLabels(periodLabel) {
  const p = parsePeriodLabel(periodLabel);
  if (!p) return [];
  const fyStartYear = p.month >= 4 ? p.year : p.year - 1;
  const out = [];
  let y = fyStartYear;
  let m = 4;
  while (y < p.year || (y === p.year && m <= p.month)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Inclusive month range ending at periodLabel, length up to `count`. */
function trailingPeriodLabels(periodLabel, count = 6) {
  const out = [];
  let cur = periodLabel;
  for (let i = 0; i < count; i += 1) {
    if (!cur) break;
    out.unshift(cur);
    cur = prevMonthLabel(cur);
  }
  return out;
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
    GROUP BY p.id
    ORDER BY p.label DESC
    LIMIT 1
    `
  );
  return rows[0] || null;
}

async function resolveIndicator(code) {
  const c = String(code || 'RANK_COMPOSITE').trim().toUpperCase();
  const { rows } = await query(
    `
    SELECT id, code, name, short_name, unit, is_composite
    FROM ranking_indicator
    WHERE is_active = TRUE AND upper(code) = $1
    LIMIT 1
    `,
    [c]
  );
  return rows[0] || null;
}

async function loadValuesForPeriods({ geoLevel, indicatorId, periodLabels }) {
  if (!periodLabels.length) return [];
  const { rows } = await query(
    `
    SELECT p.label AS period, v.geo_name, v.district_name, v.value, v.rank
    FROM ranking_value v
    JOIN ranking_period p ON p.id = v.period_id
    WHERE v.geo_level = $1
      AND v.indicator_id = $2
      AND p.label = ANY($3::text[])
    `,
    [geoLevel, indicatorId, periodLabels]
  );
  return rows;
}

function avg(nums) {
  const xs = nums.filter((x) => x != null && !Number.isNaN(Number(x))).map(Number);
  if (!xs.length) return null;
  return Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4));
}

function roundScore(v, isComposite) {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return isComposite ? Number(n.toFixed(2)) : Number(n.toFixed(2));
}

/**
 * Indicator breakup only (state / division / district / block).
 * Right-panel uses this so block clicks don't rebuild the full rankings tree.
 */
async function buildIndicatorBreakup({
  periodRow,
  fyLabels,
  division,
  district,
  block,
  divCode,
  districtMaster = [],
}) {
  const scopeBlock = block ? normalizeGeoName(block) : null;
  let resolvedScopeDistrict = district ? normalizeGeoName(district) : null;
  const scopeDivision = division ? normalizeGeoName(division) : null;
  let breakupGeoLevel = 'district';
  let breakupGeoNames = null;
  let breakupTitle = 'UTTAR PRADESH';
  /** @type {Set<string>|null} */
  let breakupBlockScope = null;

  if (scopeBlock && resolvedScopeDistrict) {
    breakupGeoLevel = 'block';
    breakupTitle = `${scopeBlock.toUpperCase()} - ${resolvedScopeDistrict.toUpperCase()}`;
    breakupBlockScope = new Set([scopeBlock.toLowerCase()]);
  } else if (scopeBlock && !resolvedScopeDistrict) {
    const { rows: blockDistRows } = await query(
      `
      SELECT DISTINCT district_name
      FROM ranking_value
      WHERE geo_level = 'block'
        AND LOWER(geo_name) = LOWER($1)
        AND district_name IS NOT NULL
        AND district_name <> ''
      LIMIT 1
      `,
      [scopeBlock]
    );
    resolvedScopeDistrict = blockDistRows[0]
      ? normalizeGeoName(blockDistRows[0].district_name)
      : null;
    if (resolvedScopeDistrict) {
      breakupGeoLevel = 'block';
      breakupTitle = `${scopeBlock.toUpperCase()} - ${resolvedScopeDistrict.toUpperCase()}`;
      breakupBlockScope = new Set([scopeBlock.toLowerCase()]);
    }
  } else if (resolvedScopeDistrict) {
    breakupGeoLevel = 'district';
    breakupGeoNames = [resolvedScopeDistrict];
    breakupTitle = resolvedScopeDistrict.toUpperCase();
  } else if (scopeDivision || divCode) {
    const { rows: divRows } = await query(
      `
      SELECT name, code FROM division
      WHERE ($1::text IS NOT NULL AND (name ILIKE $1 OR name ILIKE $2))
         OR ($3::text IS NOT NULL AND code = $3)
      LIMIT 1
      `,
      [
        scopeDivision || null,
        scopeDivision ? `%${scopeDivision}%` : null,
        divCode || null,
      ]
    );
    if (divRows[0]) {
      breakupTitle = divRows[0].name.toUpperCase();
      breakupGeoNames = (districtMaster || [])
        .filter((d) => d.division_name === divRows[0].name)
        .map((d) => d.district_name);
    }
  }

  const { rows: allInds } = await query(
    `
    SELECT id, code, short_name, name, unit, is_composite, sort_order
    FROM ranking_indicator
    WHERE is_active = TRUE AND is_composite = FALSE
    ORDER BY sort_order
    `
  );

  const breakupPeriodLabels = [...new Set([periodRow.label, ...fyLabels])];
  const indIds = allInds.map((i) => i.id);
  const breakupGeoQueryLevel = breakupGeoLevel === 'block' ? 'block' : 'district';
  const { rows: allBreakupRows } = indIds.length
    ? await query(
        `
        SELECT v.indicator_id, p.label AS period, v.geo_name, v.district_name, v.value, v.rank
        FROM ranking_value v
        JOIN ranking_period p ON p.id = v.period_id
        WHERE v.geo_level = $1
          AND v.indicator_id = ANY($2::int[])
          AND p.label = ANY($3::text[])
        `,
        [breakupGeoQueryLevel, indIds, breakupPeriodLabels]
      )
    : { rows: [] };

  const scopeSet = breakupGeoNames
    ? new Set(breakupGeoNames.map((n) => n.toLowerCase()))
    : null;
  const scopeDistrictKey = resolvedScopeDistrict
    ? resolvedScopeDistrict.toLowerCase()
    : null;

  const indicator_breakup = allInds.map((bi) => {
    const bRows = allBreakupRows.filter(
      (r) => Number(r.indicator_id) === Number(bi.id)
    );
    let scoped = bRows;
    if (breakupBlockScope && scopeDistrictKey) {
      scoped = bRows.filter((r) => {
        const geoKey = String(r.geo_name || '')
          .toLowerCase()
          .trim();
        const distKey = String(r.district_name || '')
          .toLowerCase()
          .trim();
        const distNorm = normalizeGeoName(r.district_name || '')
          .toLowerCase()
          .trim();
        return (
          breakupBlockScope.has(geoKey) &&
          (distKey === scopeDistrictKey || distNorm === scopeDistrictKey)
        );
      });
    } else if (scopeSet) {
      scoped = bRows.filter((r) =>
        scopeSet.has(String(r.geo_name).toLowerCase())
      );
    }
    const monthRows = scoped.filter((r) => r.period === periodRow.label);
    const monthly = avg(monthRows.map((r) => num(r.value)));
    const upPool = bRows.filter((r) => r.period === periodRow.label);
    const up_avg = avg(upPool.map((r) => num(r.value)));
    const bestPool = monthRows.length ? monthRows : upPool;
    let best = null;
    for (const r of bestPool) {
      const v = num(r.value);
      if (v == null) continue;
      if (!best || v > best.value) best = { name: r.geo_name, value: v };
    }
    const fyScopedVals = [];
    for (const pl of fyLabels) {
      const a = avg(
        scoped.filter((r) => r.period === pl).map((r) => num(r.value))
      );
      if (a != null) fyScopedVals.push(a);
    }
    const fy = avg(fyScopedVals);

    return {
      code: bi.code,
      indicator: bi.short_name || bi.name,
      unit: bi.unit,
      up_avg: roundScore(up_avg, false),
      up_avg_display: formatValue(up_avg, bi.unit),
      best_perf: best
        ? {
            name: best.name,
            value: roundScore(best.value, false),
            display_value: formatValue(best.value, bi.unit),
          }
        : null,
      monthly: roundScore(monthly, false),
      monthly_display: formatValue(monthly, bi.unit),
      fy: roundScore(fy, false),
      fy_display: formatValue(fy, bi.unit),
    };
  });

  return {
    breakup_scope: breakupTitle,
    breakup_geo_level: breakupGeoLevel,
    indicator_breakup,
  };
}

/**
 * @param {object} opts
 * @param {'division'|'district'|'table'} opts.view  table → use tableMode/level
 * @param {string} [opts.level] frontend level=
 * @param {string} [opts.tableMode] frontend table_mode=
 * @param {string} [opts.period]
 * @param {string} [opts.indicatorCode]
 * @param {'all'|'aspirational'|'high_priority'} [opts.filter]
 * @param {string} [opts.division] selected geo for breakup
 * @param {string} [opts.district]
 * @param {string} [opts.block]
 * @param {string} [opts.divCode]
 * @param {string} [opts.panelTab] indicators|type|domain
 * @param {boolean|string|number} [opts.labels]
 * @param {string} [opts.analyticsCompare] timeperiod|…
 * @param {string} [opts.analyticsMode] month|fy
 * @param {boolean|string|number} [opts.breakupOnly]
 */
async function getDeepDiveDashboard({
  view = 'division',
  level,
  tableMode,
  period,
  indicatorCode = 'RANK_COMPOSITE',
  filter = 'all',
  division,
  district,
  block,
  divCode,
  panelTab = 'indicators',
  labels = true,
  analyticsCompare = 'timeperiod',
  analyticsMode = 'month',
  breakupOnly = false,
} = {}) {
  const uiView = view === 'table' || String(view).toLowerCase() === 'table' ? 'table' : 'deep_dive';
  const rawGeo =
    String(tableMode || level || (view === 'table' ? 'division' : view) || 'division').toLowerCase();
  const geoLevel = rawGeo === 'district' ? 'district' : 'division';
  const panel = String(panelTab || 'indicators').toLowerCase();
  const showLabels = labels === true || labels === 1 || labels === '1' || labels === 'true';
  const compare = String(analyticsCompare || 'timeperiod').toLowerCase();
  const mode = String(analyticsMode || 'month').toLowerCase();
  const onlyBreakup =
    breakupOnly === true ||
    breakupOnly === 1 ||
    breakupOnly === '1' ||
    breakupOnly === 'true';

  const periodRow = await resolvePeriod(period);
  if (!periodRow) {
    return {
      view: uiView,
      has_data: false,
      message: 'No ranking periods imported yet',
      geo_level: geoLevel,
      level: geoLevel,
      table_mode: geoLevel,
      period: period || null,
      panel_tab: panel,
      labels: showLabels,
      analytics: { compare, mode, periods: [] },
      summary: null,
      rankings: [],
      indicator_breakup: [],
      indicator_options: [],
      breakup_scope: 'UTTAR PRADESH',
    };
  }

  // Fast path for table right-panel (block / district / division / state)
  if (onlyBreakup) {
    const fyLabels = fyPeriodLabels(periodRow.label);
    let districtMaster = [];
    if ((division || divCode) && !district && !block) {
      const { rows } = await query(
        `
        SELECT d.name AS district_name, dv.name AS division_name, dv.code AS div_code
        FROM district d
        JOIN division dv ON dv.id = d.division_id
        WHERE d.is_active = TRUE
        `
      );
      districtMaster = rows;
    }
    const breakup = await buildIndicatorBreakup({
      periodRow,
      fyLabels,
      division,
      district,
      block,
      divCode,
      districtMaster,
    });
    return {
      view: uiView,
      has_data: (breakup.indicator_breakup || []).some(
        (r) => r.monthly != null || r.fy != null
      ),
      geo_level: geoLevel,
      level: geoLevel,
      table_mode: geoLevel,
      period: periodRow.label,
      period_display: periodRow.display,
      panel_tab: panel,
      labels: showLabels,
      breakup_only: true,
      breakup_scope: breakup.breakup_scope,
      breakup_geo_level: breakup.breakup_geo_level,
      indicator_breakup: breakup.indicator_breakup,
      indicators: breakup.indicator_breakup.map((r) => ({
        code: r.code,
        name: r.indicator,
        unit: r.unit,
        value: r.monthly,
        display_value: r.monthly_display,
        up_avg: r.up_avg,
        up_avg_display: r.up_avg_display,
        best_perf: r.best_perf,
        fy: r.fy,
        fy_display: r.fy_display,
      })),
      rankings: [],
      summary: null,
    };
  }

  const ind = await resolveIndicator(indicatorCode);
  if (!ind) {
    return {
      view: uiView,
      has_data: false,
      message: `Unknown indicator_code: ${indicatorCode}`,
      geo_level: geoLevel,
      level: geoLevel,
      table_mode: geoLevel,
      period: periodRow.label,
      panel_tab: panel,
      labels: showLabels,
      analytics: { compare, mode, periods: [] },
      summary: null,
      rankings: [],
      indicator_breakup: [],
      indicator_options: [],
    };
  }

  // Month columns for timeperiod analytics: imported periods up to selected
  const { rows: importedPeriods } = await query(
    `
    SELECT DISTINCT p.label
    FROM ranking_period p
    JOIN ranking_value v ON v.period_id = p.id
    WHERE v.geo_level = $1
      AND p.label <= $2
    ORDER BY p.label ASC
    `,
    [geoLevel, periodRow.label]
  );
  const analyticsPeriodLabels = importedPeriods.map((r) => r.label);
  const trendLabels =
    mode === 'fy'
      ? fyPeriodLabels(periodRow.label)
      : analyticsPeriodLabels.length
        ? analyticsPeriodLabels.slice(-6)
        : trailingPeriodLabels(periodRow.label, 6);
  const fyLabels = fyPeriodLabels(periodRow.label);
  const allLabels = [
    ...new Set([...trendLabels, ...fyLabels, periodRow.label, ...analyticsPeriodLabels]),
  ];

  const rows = await loadValuesForPeriods({
    geoLevel,
    indicatorId: ind.id,
    periodLabels: allLabels,
  });

  // District master → division for hierarchy / filters
  const { rows: districtMaster } = await query(
    `
    SELECT d.name AS district_name, dv.name AS division_name, dv.code AS div_code
    FROM district d
    JOIN division dv ON dv.id = d.division_id
    WHERE d.is_active = TRUE
    `
  );
  const divisionByDistrict = new Map();
  for (const r of districtMaster) {
    divisionByDistrict.set(r.district_name.toLowerCase(), {
      division: r.division_name,
      div_code: r.div_code,
    });
  }

  // Pivot: geo_name → period → {value, rank}
  const byGeo = new Map();
  for (const r of rows) {
    const key = r.geo_name;
    if (!byGeo.has(key)) byGeo.set(key, new Map());
    byGeo.get(key).set(r.period, {
      value: num(r.value),
      rank: r.rank != null ? Number(r.rank) : null,
    });
  }

  let geoNames = [...byGeo.keys()].sort((a, b) => a.localeCompare(b));

  // Optional aspirational filter (district view, or division children later)
  const filterKey = String(filter || 'all').toLowerCase();
  if (filterKey === 'aspirational' && geoLevel === 'district') {
    geoNames = geoNames.filter((n) => ASPIRATIONAL_DISTRICTS.includes(n.toLowerCase()));
  } else if (filterKey === 'high_priority' && geoLevel === 'district') {
    // Placeholder: no master list yet — return empty with note in meta
    geoNames = [];
  }

  const isComposite = !!ind.is_composite;

  function buildFromSeries(geoName, series, extra = {}) {
    const monthlyCell = series.get(periodRow.label);
    const monthly = monthlyCell ? monthlyCell.value : null;
    const fy = avg(fyLabels.map((pl) => (series.get(pl) ? series.get(pl).value : null)));
    const trend_series = trendLabels.map((pl) => {
      const c = series.get(pl);
      return {
        period: pl,
        value: c ? roundScore(c.value, isComposite) : null,
        rank: c ? c.rank : null,
      };
    });
    const period_values = {};
    for (const pl of analyticsPeriodLabels) {
      const c = series.get(pl);
      period_values[pl] = c ? roundScore(c.value, isComposite) : null;
    }
    const trendDelta = (() => {
      const vals = trend_series.map((t) => t.value).filter((x) => x != null);
      if (vals.length < 2) return null;
      return roundScore(vals[vals.length - 1] - vals[0], true);
    })();

    return {
      name: geoName,
      rank: monthlyCell ? monthlyCell.rank : null,
      monthly: roundScore(monthly, isComposite),
      monthly_display: isComposite
        ? roundScore(monthly, true)
        : formatValue(monthly, ind.unit),
      fy: roundScore(fy, isComposite),
      fy_display: isComposite ? roundScore(fy, true) : formatValue(fy, ind.unit),
      trend_series,
      trend_delta: trendDelta,
      period_values,
      ...extra,
    };
  }

  function buildRow(geoName) {
    return buildFromSeries(geoName, byGeo.get(geoName) || new Map(), {
      geo_level: geoLevel,
    });
  }

  function sortRankRows(a, b) {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    if (a.monthly != null && b.monthly != null) return b.monthly - a.monthly;
    return a.name.localeCompare(b.name);
  }

  // Block series keyed by district → block name (for Division→District→Block expand)
  const blockRows = await loadValuesForPeriods({
    geoLevel: 'block',
    indicatorId: ind.id,
    periodLabels: allLabels,
  });
  /** @type {Map<string, Map<string, Map<string, {value:number|null, rank:number|null}>>>} */
  const blocksByDistrict = new Map();
  for (const r of blockRows) {
    const distKey = String(r.district_name || '').toLowerCase();
    if (!distKey) continue;
    if (!blocksByDistrict.has(distKey)) blocksByDistrict.set(distKey, new Map());
    const byBlock = blocksByDistrict.get(distKey);
    if (!byBlock.has(r.geo_name)) byBlock.set(r.geo_name, new Map());
    byBlock.get(r.geo_name).set(r.period, {
      value: num(r.value),
      rank: r.rank != null ? Number(r.rank) : null,
    });
  }

  function buildBlockChildren(districtName) {
    const byBlock = blocksByDistrict.get(String(districtName).toLowerCase());
    if (!byBlock) return [];
    return [...byBlock.keys()]
      .map((blockName) =>
        buildFromSeries(blockName, byBlock.get(blockName) || new Map(), {
          geo_level: 'block',
          district_name: districtName,
          children: null,
          child_count: 0,
          expandable: false,
        })
      )
      .sort(sortRankRows);
  }

  let rankings = geoNames.map(buildRow);
  rankings.sort(sortRankRows);

  // Attach district children under each division (By Division tab expand)
  // and block children under each district (Division → District → Block)
  if (geoLevel === 'division') {
    const districtRows = await loadValuesForPeriods({
      geoLevel: 'district',
      indicatorId: ind.id,
      periodLabels: allLabels,
    });
    const distByGeo = new Map();
    for (const r of districtRows) {
      if (!distByGeo.has(r.geo_name)) distByGeo.set(r.geo_name, new Map());
      distByGeo.get(r.geo_name).set(r.period, {
        value: num(r.value),
        rank: r.rank != null ? Number(r.rank) : null,
      });
    }

    function buildDistrictRow(geoName) {
      const blockChildren = buildBlockChildren(geoName);
      return buildFromSeries(geoName, distByGeo.get(geoName) || new Map(), {
        geo_level: 'district',
        children: blockChildren,
        child_count: blockChildren.length,
        expandable: blockChildren.length > 0,
      });
    }

    let allDistrictNames = [...distByGeo.keys()];
    if (filterKey === 'aspirational') {
      allDistrictNames = allDistrictNames.filter((n) =>
        ASPIRATIONAL_DISTRICTS.includes(n.toLowerCase())
      );
    }

    rankings = rankings.map((divRow) => {
      const children = allDistrictNames
        .filter((dn) => {
          const meta = divisionByDistrict.get(dn.toLowerCase());
          return meta && meta.division === divRow.name;
        })
        .map(buildDistrictRow)
        .sort(sortRankRows);
      return {
        ...divRow,
        geo_level: 'division',
        children,
        child_count: children.length,
        expandable: children.length > 0,
      };
    });
  } else if (geoLevel === 'district') {
    // By District tab: expand district → blocks
    rankings = rankings.map((distRow) => {
      const blockChildren = buildBlockChildren(distRow.name);
      return {
        ...distRow,
        geo_level: 'district',
        children: blockChildren,
        child_count: blockChildren.length,
        expandable: blockChildren.length > 0,
      };
    });
  }

  // State (UP) aggregate row
  const stateMonthly = avg(rankings.map((r) => r.monthly));
  const stateFy = avg(rankings.map((r) => r.fy));
  const stateTrend = trendLabels.map((pl) => {
    const vals = rankings
      .map((r) => {
        const t = (r.trend_series || []).find((x) => x.period === pl);
        return t ? t.value : null;
      })
      .filter((x) => x != null);
    return { period: pl, value: roundScore(avg(vals), isComposite), rank: null };
  });
  const statePeriodValues = {};
  for (const pl of analyticsPeriodLabels) {
    const vals = rankings
      .map((r) => (r.period_values ? r.period_values[pl] : null))
      .filter((x) => x != null);
    statePeriodValues[pl] = roundScore(avg(vals), isComposite);
  }

  const stateRow = {
    name: 'Uttar Pradesh',
    is_state: true,
    rank: null,
    monthly: roundScore(stateMonthly, isComposite),
    monthly_display: isComposite
      ? roundScore(stateMonthly, true)
      : formatValue(stateMonthly, ind.unit),
    fy: roundScore(stateFy, isComposite),
    fy_display: isComposite ? roundScore(stateFy, true) : formatValue(stateFy, ind.unit),
    trend_series: stateTrend,
    period_values: statePeriodValues,
    children: null,
  };

  // Summary cards — always district-based for top/lowest/total (matches screenshot)
  const districtComposite = await loadValuesForPeriods({
    geoLevel: 'district',
    indicatorId: ind.id,
    periodLabels: [periodRow.label, prevMonthLabel(periodRow.label)].filter(Boolean),
  });
  const distCurrent = districtComposite.filter((r) => r.period === periodRow.label);
  const distScores = distCurrent
    .map((r) => ({ name: r.geo_name, score: num(r.value), rank: r.rank }))
    .filter((r) => r.score != null)
    .sort((a, b) => b.score - a.score);

  const prevLabel = prevMonthLabel(periodRow.label);
  // Screenshot compares avg vs Apr — use previous month if available, else 2 months back
  const compareLabel = prevLabel;
  const distPrev = districtComposite.filter((r) => r.period === compareLabel);
  const avgNow = avg(distScores.map((d) => d.score));
  const avgPrev = avg(distPrev.map((r) => num(r.value)));
  const avgChange =
    avgNow != null && avgPrev != null ? roundScore(avgNow - avgPrev, true) : null;

  const summary = {
    total_districts: distScores.length,
    top_district: distScores[0]
      ? { name: distScores[0].name, score: roundScore(distScores[0].score, isComposite) }
      : null,
    lowest_district: distScores.length
      ? {
          name: distScores[distScores.length - 1].name,
          score: roundScore(distScores[distScores.length - 1].score, isComposite),
        }
      : null,
    average_score: roundScore(avgNow, isComposite),
    average_change: avgChange,
    average_change_vs_period: compareLabel,
  };

  // Indicator options for dropdown
  const { rows: indOpts } = await query(
    `
    SELECT DISTINCT i.code, i.short_name, i.name, i.unit, i.is_composite, i.sort_order
    FROM ranking_indicator i
    JOIN ranking_value v ON v.indicator_id = i.id
    WHERE v.geo_level = $1 AND i.is_active = TRUE
    ORDER BY i.sort_order
    `,
    [geoLevel]
  );
  const indicator_options = indOpts.map((r) => ({
    code: r.code,
    name: r.short_name || r.name,
    unit: r.unit,
    is_composite: r.is_composite,
  }));

  const breakup = await buildIndicatorBreakup({
    periodRow,
    fyLabels,
    division,
    district,
    block,
    divCode,
    districtMaster,
  });
  const breakupTitle = breakup.breakup_scope;
  const indicator_breakup = breakup.indicator_breakup;

  return {
    view: uiView,
    has_data: rankings.length > 0 || distScores.length > 0,
    geo_level: geoLevel,
    level: geoLevel,
    table_mode: geoLevel,
    tab: geoLevel === 'division' ? 'By Division' : 'By District',
    period: periodRow.label,
    period_display: periodRow.display,
    panel_tab: panel,
    labels: showLabels,
    filter: filterKey,
    filter_note:
      filterKey === 'high_priority'
        ? 'high_priority district master list not configured yet'
        : null,
    analytics: {
      compare,
      mode,
      periods: analyticsPeriodLabels,
      period_columns: analyticsPeriodLabels,
    },
    selected_indicator: {
      code: ind.code,
      name: ind.short_name || ind.name,
      unit: ind.unit,
      is_composite: ind.is_composite,
    },
    trend_from: trendLabels[0] || null,
    trend_to: trendLabels[trendLabels.length - 1] || null,
    fy_periods: fyLabels,
    summary,
    state_row: stateRow,
    rankings,
    ranking: rankings,
    count: rankings.length,
    hierarchy: geoLevel === 'division' ? ['division', 'district', 'block'] : ['district', 'block'],
    breakup_scope: breakupTitle,
    indicator_breakup,
    // panel_tab=indicators → same rows as map SUMMARY BY INDICATORS style
    indicators: indicator_breakup.map((r) => ({
      code: r.code,
      name: r.indicator,
      unit: r.unit,
      value: r.monthly,
      display_value: r.monthly_display,
      up_avg: r.up_avg,
      up_avg_display: r.up_avg_display,
      best_perf: r.best_perf,
      fy: r.fy,
      fy_display: r.fy_display,
    })),
    indicator_options,
  };
}

module.exports = {
  getDeepDiveDashboard,
  ASPIRATIONAL_DISTRICTS,
};
