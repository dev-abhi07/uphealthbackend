/**
 * Overall Composite Score analytics — By Timeperiod + Division/District/Block cascade.
 * UI: UP Health Overall Composite Score (sidebar filters + indicator bars/trends).
 */
const { query } = require('../db/pool');
const { normalizeGeoName } = require('./rankingNameNormalize');
const {
  INDICATOR_GROUPING,
  TYPE_ORDER,
  DOMAIN_ORDER,
  groupIndicatorsForSummary,
} = require('./rankingRegistry');

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

function avg(vals) {
  const xs = vals.filter((x) => x != null && !Number.isNaN(Number(x))).map(Number);
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  if (unit === 'percent') return `${round(n, 2)}%`;
  if (unit === 'index') return round(n, 2);
  if (unit === 'amount') return `Rs.${round(n, 2)}`;
  return round(n, 2);
}

/** Bar-chart labels as in Overall Composite Score UI (often 1 decimal). */
function formatBarLabel(value, unit) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  if (unit === 'percent') return `${round(n, 1)}%`;
  if (unit === 'index') return round(n, 2);
  if (unit === 'amount') return `Rs.${round(n, 2)}`;
  return round(n, 1);
}

function shortPeriodLabel(label) {
  const p = parsePeriodLabel(label);
  if (!p) return label;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[p.month - 1]} ${String(p.year).slice(2)}`;
}

function parsePeriodLabel(label) {
  const m = String(label || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), label };
}

function nextMonth(label) {
  const p = parsePeriodLabel(label);
  if (!p) return null;
  let { year, month } = p;
  month += 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthRange(fromLabel, toLabel) {
  const from = parsePeriodLabel(fromLabel);
  const to = parsePeriodLabel(toLabel);
  if (!from || !to) return [];
  if (fromLabel > toLabel) return monthRange(toLabel, fromLabel);
  const out = [];
  let cur = fromLabel;
  while (cur && cur <= toLabel) {
    out.push(cur);
    cur = nextMonth(cur);
  }
  return out;
}

/**
 * Parse quarter token: "2026-27-Q1", "2026-2027-Q2", "Q1", with fyYear optional.
 * Indian FY Apr–Mar: FY 2026-27 → Q1 Apr–Jun 2026 … Q4 Jan–Mar 2027.
 */
function parseQuarterToken(token, fyHint) {
  const s = String(token || '').trim().toUpperCase();
  const m = s.match(/^(?:(\d{4})(?:-(\d{2}|\d{4}))?-)?Q([1-4])$/);
  if (!m) return null;
  let startYear;
  if (m[1]) {
    startYear = Number(m[1]);
  } else if (fyHint) {
    const fy = String(fyHint).match(/^(\d{4})/);
    startYear = fy ? Number(fy[1]) : null;
  }
  if (!startYear) return null;
  const q = Number(m[3]);
  const monthsByQ = {
    1: [`${startYear}-04`, `${startYear}-05`, `${startYear}-06`],
    2: [`${startYear}-07`, `${startYear}-08`, `${startYear}-09`],
    3: [`${startYear}-10`, `${startYear}-11`, `${startYear}-12`],
    4: [`${startYear + 1}-01`, `${startYear + 1}-02`, `${startYear + 1}-03`],
  };
  const fyLabel = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  return {
    key: `${fyLabel}-Q${q}`,
    label: `Q${q} ${fyLabel}`,
    fy: fyLabel,
    quarter: q,
    months: monthsByQ[q],
  };
}

function expandQuarters(quarterFrom, quarterTo, fyYear) {
  const a = parseQuarterToken(quarterFrom, fyYear);
  const b = parseQuarterToken(quarterTo || quarterFrom, fyYear);
  if (!a || !b) return null;
  const startYear = Number(String(a.fy).slice(0, 4));
  const list = [];
  let y = startYear;
  let q = a.quarter;
  const endY = Number(String(b.fy).slice(0, 4));
  const endQ = b.quarter;
  // Safety: max 8 quarters
  for (let i = 0; i < 8; i += 1) {
    const tok = parseQuarterToken(`Q${q}`, `${y}`);
    if (!tok) break;
    // fix fy for this year
    const fixed = parseQuarterToken(`${y}-Q${q}`, `${y}`);
    list.push(fixed);
    if (y === endY && q === endQ) break;
    q += 1;
    if (q > 4) {
      q = 1;
      y += 1;
    }
  }
  return list;
}

function displayPeriod(label) {
  const p = parsePeriodLabel(label);
  if (!p) return label;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[p.month - 1]} ${p.year}`;
}

/**
 * Frontend slug → display name.
 * auraiya → Auraiya
 * erwa-katra → Erwa Katra
 * auraiya__erwa-katra → { district: Auraiya, block: Erwa Katra }
 */
function slugToTitle(slug) {
  const s = String(slug || '').trim();
  if (!s) return null;
  return s
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function parseAreaSlug(slug) {
  const raw = String(slug || '').trim();
  if (!raw) return { district: null, block: null, raw: null };
  if (raw.includes('__')) {
    const [dist, ...rest] = raw.split('__');
    return {
      district: slugToTitle(dist),
      block: slugToTitle(rest.join('-')),
      raw,
    };
  }
  return { district: slugToTitle(raw), block: null, raw };
}

/**
 * Map health-ranking?view=analytics… query params → getAnalyticsDashboard opts.
 *
 * Example:
 * view=analytics&analytics_mode=quarter&analytics_from=2026-Q1&analytics_to=2026-Q1
 * &district_id=auraiya&block_id=auraiya__erwa-katra&area_id=auraiya__erwa-katra
 * &parent_area_id=auraiya&analytics_period=2026-06&panel_tab=indicators
 */
function parseFrontendAnalyticsQuery(q = {}) {
  const mode = String(q.analytics_mode || q.mode || '').toLowerCase();
  const labels = q.labels === '1' || q.labels === 'true' || q.labels === 1 || q.labels === true;

  const blockSlug = parseAreaSlug(q.block_id || q.area_id);
  const districtSlug = parseAreaSlug(q.district_id || q.parent_area_id);

  const district =
    q.district ||
    blockSlug.district ||
    districtSlug.district ||
    (q.parent_area_id && !/^\d+$/.test(String(q.parent_area_id))
      ? slugToTitle(q.parent_area_id)
      : null);

  const block =
    q.block ||
    (blockSlug.block ? blockSlug.block : null) ||
    null;

  // parent_area_id is division.code on map drill-down, but district slug on analytics block view
  const parentRaw = q.parent_area_id != null ? String(q.parent_area_id).trim() : '';
  const parentIsDivCode = /^\d+$/.test(parentRaw);
  const divCode = q.div_code || (parentIsDivCode ? parentRaw : null);
  const division = q.division || null;

  let periodFrom = q.period_from || q.from || null;
  let periodTo = q.period_to || q.to || null;
  let quarterFrom = q.quarter_from || null;
  let quarterTo = q.quarter_to || null;

  const analyticsFrom = q.analytics_from || null;
  const analyticsTo = q.analytics_to || null;

  if (mode === 'quarter' || (analyticsFrom && /Q[1-4]/i.test(String(analyticsFrom)))) {
    quarterFrom = quarterFrom || analyticsFrom;
    quarterTo = quarterTo || analyticsTo || analyticsFrom;
  } else if (mode === 'month' || analyticsFrom || analyticsTo) {
    // analytics_from/to may be YYYY-MM in month mode
    if (analyticsFrom && /^\d{4}-\d{2}$/.test(String(analyticsFrom))) {
      periodFrom = periodFrom || analyticsFrom;
    }
    if (analyticsTo && /^\d{4}-\d{2}$/.test(String(analyticsTo))) {
      periodTo = periodTo || analyticsTo;
    }
  }

  // Single-month fallback from analytics_period / period
  const single = q.analytics_period || q.period || null;
  if (!quarterFrom && !periodFrom && single) {
    periodFrom = single;
    periodTo = single;
  }

  const truthy = (v) =>
    v === undefined || v === '' || v === '1' || v === 'true' || v === true || v === 1;
  const compareUp =
    q.compare_up_avg === undefined && q.up_avg === undefined
      ? true
      : truthy(q.compare_up_avg ?? q.up_avg);
  const compareBest =
    q.compare_best === undefined && q.best_perf === undefined
      ? true
      : truthy(q.compare_best ?? q.best_perf);

  return {
    periodFrom,
    periodTo,
    quarterFrom,
    quarterTo,
    fyYear: q.fy_year || q.fy || null,
    division,
    district,
    block,
    divCode,
    compareUpAvg: compareUp,
    compareBest,
    panelTab: q.panel_tab || 'indicators',
    labels,
    analyticsCompare: q.analytics_compare || 'timeperiod',
    analyticsMode: mode || (quarterFrom ? 'quarter' : 'month'),
    // echo for clients
    request: {
      area_id: q.area_id || null,
      district_id: q.district_id || null,
      block_id: q.block_id || null,
      parent_area_id: q.parent_area_id || null,
      analytics_from: analyticsFrom,
      analytics_to: analyticsTo,
      analytics_period: q.analytics_period || null,
      analytics_mode: mode || null,
    },
  };
}

async function listImportedPeriodLabels() {
  const { rows } = await query(
    `
    SELECT DISTINCT p.label
    FROM ranking_period p
    JOIN ranking_value v ON v.period_id = p.id
    ORDER BY p.label ASC
    `
  );
  return rows.map((r) => r.label);
}

/**
 * Dropdown cascade for Division → District → Block.
 */
async function getGeoOptions({ division, district } = {}) {
  const { rows: divisions } = await query(
    `
    SELECT code, name
    FROM division
    WHERE is_active = TRUE
    ORDER BY name
    `
  );

  let districts = [];
  const divName = division ? normalizeGeoName(division) : null;
  if (divName) {
    const { rows } = await query(
      `
      SELECT d.name, d.id, dv.code AS div_code, dv.name AS division_name
      FROM district d
      JOIN division dv ON dv.id = d.division_id
      WHERE d.is_active = TRUE
        AND (dv.name ILIKE $1 OR dv.name ILIKE $2 OR dv.code = $3)
      ORDER BY d.name
      `,
      [divName, `%${divName.replace(/ division$/i, '')}%`, division]
    );
    districts = rows;
  } else {
    const { rows } = await query(
      `
      SELECT d.name, d.id, dv.code AS div_code, dv.name AS division_name
      FROM district d
      JOIN division dv ON dv.id = d.division_id
      WHERE d.is_active = TRUE
      ORDER BY d.name
      `
    );
    districts = rows;
  }

  let blocks = [{ name: 'All Blocks', value: 'all' }];
  const distName = district ? normalizeGeoName(district) : null;
  if (distName && distName.toLowerCase() !== 'all') {
    const { rows } = await query(
      `
      SELECT DISTINCT v.geo_name AS name
      FROM ranking_value v
      WHERE v.geo_level = 'block'
        AND v.district_name ILIKE $1
      ORDER BY 1
      `,
      [distName]
    );
    if (rows.length) {
      blocks = [{ name: 'All Blocks', value: 'all' }, ...rows.map((r) => ({ name: r.name, value: r.name }))];
    } else {
      const { rows: masterBlocks } = await query(
        `
        SELECT b.name
        FROM block b
        JOIN district d ON d.id = b.district_id
        WHERE b.is_active = TRUE AND d.name ILIKE $1
        ORDER BY b.name
        `,
        [distName]
      );
      blocks = [
        { name: 'All Blocks', value: 'all' },
        ...masterBlocks.map((r) => ({ name: r.name, value: r.name })),
      ];
    }
  }

  return {
    divisions: divisions.map((d) => ({ code: d.code, name: d.name, value: d.name })),
    districts: districts.map((d) => ({
      name: d.name,
      value: d.name,
      div_code: d.div_code,
      division_name: d.division_name,
    })),
    blocks,
  };
}

async function resolveScope({ division, district, block, divCode }) {
  const breadcrumb = [];
  let geoLevel = 'division';
  let geoName = null;
  let districtName = null;

  const divFilter = division || divCode;
  let divisionRow = null;
  if (divFilter) {
    const { rows } = await query(
      `
      SELECT code, name FROM division
      WHERE code = $1 OR name ILIKE $2 OR name ILIKE $3
      LIMIT 1
      `,
      [
        String(divFilter),
        normalizeGeoName(division || ''),
        division ? `%${String(division).replace(/ division$/i, '')}%` : '',
      ]
    );
    divisionRow = rows[0] || null;
    if (divisionRow) {
      breadcrumb.push(divisionRow.name);
      geoLevel = 'division';
      geoName = divisionRow.name;
    }
  }

  if (district && String(district).toLowerCase() !== 'all') {
    const dn = normalizeGeoName(district);
    const { rows } = await query(
      `
      SELECT d.name, dv.name AS division_name, dv.code AS div_code
      FROM district d
      JOIN division dv ON dv.id = d.division_id
      WHERE d.name ILIKE $1
      LIMIT 1
      `,
      [dn]
    );
    if (rows[0]) {
      if (!divisionRow) breadcrumb.push(rows[0].division_name);
      else if (breadcrumb[0] !== rows[0].division_name) {
        breadcrumb[0] = rows[0].division_name;
      }
      breadcrumb.push(rows[0].name);
      geoLevel = 'district';
      geoName = rows[0].name;
      districtName = rows[0].name;
      if (!divisionRow) {
        divisionRow = { name: rows[0].division_name, code: rows[0].div_code };
      }
    }
  }

  const blockVal = block && String(block).toLowerCase() !== 'all' && String(block).toLowerCase() !== 'all blocks'
    ? String(block).trim()
    : null;
  if (blockVal && districtName) {
    // Resolve canonical block name (slug "Erwa Katra" / "erwa-katra")
    const { rows: blockHit } = await query(
      `
      SELECT DISTINCT v.geo_name AS name
      FROM ranking_value v
      WHERE v.geo_level = 'block'
        AND v.district_name ILIKE $1
        AND (
          v.geo_name ILIKE $2
          OR replace(lower(v.geo_name), ' ', '-') = lower($3)
          OR replace(lower(v.geo_name), ' ', '') = replace(lower($2), ' ', '')
        )
      LIMIT 1
      `,
      [districtName, blockVal, blockVal.replace(/\s+/g, '-')]
    );
    const resolvedBlock = blockHit[0] ? blockHit[0].name : blockVal;
    breadcrumb.push(resolvedBlock);
    geoLevel = 'block';
    geoName = resolvedBlock;
  }

  // Statewide if nothing selected
  if (!geoName) {
    return {
      geoLevel: 'state',
      geoName: 'Uttar Pradesh',
      districtName: null,
      division: null,
      breadcrumb: ['Uttar Pradesh'],
    };
  }

  return {
    geoLevel,
    geoName,
    districtName,
    division: divisionRow,
    breadcrumb,
  };
}

/**
 * Load values for one indicator across geos for given periods.
 */
async function loadIndicatorValues({ indicatorId, geoLevel, periodLabels, geoName, districtName }) {
  if (!periodLabels.length) return [];
  if (geoLevel === 'state') {
    // Statewide = average across all districts for that indicator/period
    const { rows } = await query(
      `
      SELECT p.label AS period, AVG(v.value::float) AS value
      FROM ranking_value v
      JOIN ranking_period p ON p.id = v.period_id
      WHERE v.indicator_id = $1
        AND v.geo_level = 'district'
        AND p.label = ANY($2::text[])
      GROUP BY p.label
      `,
      [indicatorId, periodLabels]
    );
    return rows.map((r) => ({ period: r.period, value: num(r.value), geo_name: 'Uttar Pradesh' }));
  }

  let sql = `
    SELECT p.label AS period, v.geo_name, v.district_name, v.value, v.rank
    FROM ranking_value v
    JOIN ranking_period p ON p.id = v.period_id
    WHERE v.indicator_id = $1
      AND v.geo_level = $2
      AND p.label = ANY($3::text[])
  `;
  const params = [indicatorId, geoLevel, periodLabels];
  if (geoLevel === 'block' && geoName) {
    sql += ` AND v.geo_name ILIKE $4`;
    params.push(geoName);
    if (districtName) {
      sql += ` AND v.district_name ILIKE $5`;
      params.push(districtName);
    }
  } else if (geoName) {
    sql += ` AND v.geo_name ILIKE $4`;
    params.push(geoName);
  }
  const { rows } = await query(sql, params);
  return rows.map((r) => ({
    period: r.period,
    value: num(r.value),
    rank: r.rank != null ? Number(r.rank) : null,
    geo_name: r.geo_name,
  }));
}

async function loadDistrictPool({ indicatorId, periodLabels }) {
  const { rows } = await query(
    `
    SELECT p.label AS period, v.geo_name, v.value
    FROM ranking_value v
    JOIN ranking_period p ON p.id = v.period_id
    WHERE v.indicator_id = $1
      AND v.geo_level = 'district'
      AND p.label = ANY($2::text[])
    `,
    [indicatorId, periodLabels]
  );
  return rows.map((r) => ({
    period: r.period,
    geo_name: r.geo_name,
    value: num(r.value),
  }));
}

function seriesFromMap(periodKeys, byPeriod, displayFn) {
  return periodKeys.map((pl) => {
    const v = byPeriod.get(pl);
    return {
      period: pl,
      period_display: displayFn(pl),
      value: v != null ? round(v) : null,
    };
  });
}

/**
 * Chart payload matching Overall Composite Score trend panel:
 * orange bars = selected geo, blue line = UP Average, grey band = Best Performance.
 */
function buildTrendChart({ axisKeys, axisMode, axisDisplay, series, upAvgSeries, bestPerfSeries }) {
  const upBy = new Map((upAvgSeries || []).map((p) => [p.period, p.value]));
  const bestBy = new Map((bestPerfSeries || []).map((p) => [p.period, p.value]));
  const points = (series || []).map((p) => {
    const label =
      axisMode === 'month' ? shortPeriodLabel(p.period) : p.period_display || axisDisplay.get(p.period) || p.period;
    return {
      period: p.period,
      label,
      bar: p.value, // orange vertical bars
      up_avg: upBy.has(p.period) ? upBy.get(p.period) : null, // blue line markers
      best_perf: bestBy.has(p.period) ? bestBy.get(p.period) : null, // grey band / markers
    };
  });
  return {
    categories: points.map((p) => p.label),
    bars: points.map((p) => p.bar),
    up_avg: points.map((p) => p.up_avg),
    best_perf: points.map((p) => p.best_perf),
    points,
    layers: {
      bars: { role: 'selected_geo', style: 'bar', color: '#e07a3d' },
      up_avg: { role: 'up_average', style: 'line', color: '#1e88e5', label: 'UP Average' },
      best_perf: {
        role: 'best_performance',
        style: 'area',
        color: '#bdbdbd',
        label: 'Best Performance',
      },
    },
  };
}

/**
 * Main analytics payload for Overall Composite Score screen.
 */
async function getAnalyticsDashboard({
  periodFrom,
  periodTo,
  quarterFrom,
  quarterTo,
  fyYear,
  division,
  district,
  block,
  divCode,
  compareUpAvg = true,
  compareBest = true,
  panelTab = 'all',
  labels = true,
  analyticsCompare = 'timeperiod',
  analyticsMode = null,
  request = null,
} = {}) {
  const imported = await listImportedPeriodLabels();
  const wantUp = compareUpAvg === true || compareUpAvg === 1 || compareUpAvg === '1' || compareUpAvg === 'true';
  const wantBest =
    compareBest === true || compareBest === 1 || compareBest === '1' || compareBest === 'true';

  let axisMode = 'month'; // month | quarter
  let axisKeys = []; // month labels or quarter keys
  let axisDisplay = new Map();
  let monthLabels = []; // underlying months to query
  let quarterDefs = null;

  if (quarterFrom) {
    axisMode = 'quarter';
    quarterDefs = expandQuarters(quarterFrom, quarterTo || quarterFrom, fyYear);
    if (!quarterDefs || !quarterDefs.length) {
      return {
        view: 'analytics',
        has_data: false,
        message: 'Invalid quarter_from / quarter_to (use e.g. 2026-27-Q1)',
      };
    }
    axisKeys = quarterDefs.map((q) => q.key);
    for (const q of quarterDefs) axisDisplay.set(q.key, q.label);
    monthLabels = [...new Set(quarterDefs.flatMap((q) => q.months))];
  } else {
    const from = periodFrom || imported[0] || null;
    const to = periodTo || periodFrom || imported[imported.length - 1] || null;
    if (!from || !to) {
      return {
        view: 'analytics',
        has_data: false,
        message: 'No ranking periods imported yet',
      };
    }
    monthLabels = monthRange(from, to);
    axisKeys = monthLabels.filter((pl) => imported.includes(pl));
    // Keep full requested axis even if some months missing (null values)
    if (!axisKeys.length) axisKeys = monthLabels;
    else {
      // show all months in range that are either imported or within range for axis
      axisKeys = monthLabels;
    }
    for (const pl of axisKeys) axisDisplay.set(pl, displayPeriod(pl));
  }

  const queryMonths = monthLabels.filter((pl) => imported.includes(pl));
  const scope = await resolveScope({ division, district, block, divCode });

  const { rows: indicatorsDb } = await query(
    `
    SELECT id, code, name, short_name, unit, is_composite, sort_order
    FROM ranking_indicator
    WHERE is_active = TRUE
    ORDER BY sort_order
    `
  );

  const compositeInd = indicatorsDb.find((i) => i.code === 'RANK_COMPOSITE');
  const nonComposite = indicatorsDb.filter((i) => !i.is_composite);

  function aggregateAxis(monthValueMap) {
    // monthValueMap: periodLabel → number|null
    if (axisMode === 'month') {
      const by = new Map();
      for (const pl of axisKeys) by.set(pl, monthValueMap.get(pl) ?? null);
      return by;
    }
    const by = new Map();
    for (const q of quarterDefs) {
      const vals = q.months.map((m) => monthValueMap.get(m)).filter((x) => x != null);
      by.set(q.key, vals.length ? avg(vals) : null);
    }
    return by;
  }

  async function buildMetric(ind) {
    const rows = await loadIndicatorValues({
      indicatorId: ind.id,
      geoLevel: scope.geoLevel === 'state' ? 'state' : scope.geoLevel,
      periodLabels: queryMonths,
      geoName: scope.geoLevel === 'state' ? null : scope.geoName,
      districtName: scope.districtName,
    });
    const monthMap = new Map();
    for (const r of rows) {
      // if multiple rows, take first / avg
      if (!monthMap.has(r.period)) monthMap.set(r.period, r.value);
      else {
        const prev = monthMap.get(r.period);
        monthMap.set(r.period, avg([prev, r.value]));
      }
    }
    const axisMap = aggregateAxis(monthMap);
    const series = seriesFromMap(axisKeys, axisMap, (k) => axisDisplay.get(k) || k);
    const from_value = series.length ? series[0].value : null;
    const to_value = series.length ? series[series.length - 1].value : null;

    let up_avg_series = null;
    let best_perf_series = null;
    let best_perf_name = null;

    if (wantUp || wantBest) {
      const pool = await loadDistrictPool({
        indicatorId: ind.id,
        periodLabels: queryMonths,
      });
      const upMonth = new Map();
      const bestMonth = new Map();
      const bestNameMonth = new Map();
      for (const pl of queryMonths) {
        const slice = pool.filter((r) => r.period === pl && r.value != null);
        if (wantUp) upMonth.set(pl, avg(slice.map((r) => r.value)));
        if (wantBest && slice.length) {
          let best = slice[0];
          for (const r of slice) {
            if (r.value > best.value) best = r;
          }
          bestMonth.set(pl, best.value);
          bestNameMonth.set(pl, best.geo_name);
        }
      }
      if (wantUp) {
        up_avg_series = seriesFromMap(axisKeys, aggregateAxis(upMonth), (k) => axisDisplay.get(k) || k);
      }
      if (wantBest) {
        best_perf_series = seriesFromMap(
          axisKeys,
          aggregateAxis(bestMonth),
          (k) => axisDisplay.get(k) || k
        );
        // Prefer best name from last axis period that has data
        for (let i = queryMonths.length - 1; i >= 0; i -= 1) {
          if (bestNameMonth.has(queryMonths[i])) {
            best_perf_name = bestNameMonth.get(queryMonths[i]);
            break;
          }
        }
      }
    }

    const g = INDICATOR_GROUPING[ind.code] || {};
    const chart = buildTrendChart({
      axisKeys,
      axisMode,
      axisDisplay,
      series,
      upAvgSeries: up_avg_series,
      bestPerfSeries: best_perf_series,
    });
    return {
      code: ind.code,
      name: (ind.short_name || ind.name || '').toUpperCase(),
      full_name: ind.name,
      unit: ind.unit,
      is_composite: !!ind.is_composite,
      type: g.type || null,
      domain: g.domain || null,
      // Exact Excel values (2 dp) — Agra Jun INST_DEL=79.88, DH=36.16, etc.
      from_value: round(from_value),
      from_display: formatValue(from_value, ind.unit),
      from_bar_label: formatBarLabel(from_value, ind.unit),
      to_value: round(to_value),
      to_display: formatValue(to_value, ind.unit),
      to_bar_label: formatBarLabel(to_value, ind.unit),
      series,
      up_avg_series,
      best_perf_series,
      best_perf_name,
      // Screenshot trend panel (bars + UP Average line + Best Performance band)
      chart,
    };
  }

  let composite = null;
  if (compositeInd) {
    const c = await buildMetric(compositeInd);
    const lastAvail = [...(c.series || [])].reverse().find((p) => p.value != null);
    composite = {
      score: lastAvail ? lastAvail.value : c.to_value,
      score_display: lastAvail
        ? formatValue(lastAvail.value, compositeInd.unit)
        : c.to_display,
      score_period: lastAvail ? lastAvail.period : null,
      from_value: c.from_value,
      to_value: c.to_value,
      series: c.series,
      up_avg_series: c.up_avg_series,
      best_perf_series: c.best_perf_series,
      best_perf_name: c.best_perf_name,
      chart: c.chart,
    };
  }

  let indicatorRows = [];
  for (const ind of nonComposite) {
    indicatorRows.push(await buildMetric(ind));
  }
  // Hide indicators with no data in range (screenshot only shows populated rows)
  indicatorRows = indicatorRows.filter((r) =>
    (r.series || []).some((p) => p.value != null)
  );

  const { by_type, by_domain } = groupIndicatorsForSummary(
    indicatorRows.map((r) => ({
      code: r.code,
      name: r.full_name,
      short_name: r.name,
      unit: r.unit,
      is_composite: false,
      value: r.to_value,
      display_value: r.to_display,
      from_value: r.from_value,
      to_value: r.to_value,
      series: r.series,
      up_avg_series: r.up_avg_series,
      best_perf_series: r.best_perf_series,
      chart: r.chart,
    }))
  );

  const panel = String(panelTab || 'all').toLowerCase();
  const availableMonths = queryMonths;
  const fromKey = axisKeys[0] || null;
  const toKey = axisKeys[axisKeys.length - 1] || null;

  return {
    view: 'analytics',
    has_data: availableMonths.length > 0 && (composite != null || indicatorRows.length > 0),
    mode: 'timeperiod',
    axis_mode: axisMode,
    period_from: axisMode === 'month' ? fromKey : null,
    period_to: axisMode === 'month' ? toKey : null,
    period_from_display: axisMode === 'month' ? axisDisplay.get(fromKey) : null,
    period_to_display: axisMode === 'month' ? axisDisplay.get(toKey) : null,
    period_from_short: axisMode === 'month' && fromKey ? shortPeriodLabel(fromKey) : null,
    period_to_short: axisMode === 'month' && toKey ? shortPeriodLabel(toKey) : null,
    quarter_from: axisMode === 'quarter' ? fromKey : null,
    quarter_to: axisMode === 'quarter' ? toKey : null,
    // Matches UI legend: orange = FROM month, brown = TO month
    legend: {
      from: {
        period: fromKey,
        label: axisMode === 'month' ? shortPeriodLabel(fromKey) : axisDisplay.get(fromKey),
        color: '#e07a3d',
      },
      to: {
        period: toKey,
        label: axisMode === 'month' ? shortPeriodLabel(toKey) : axisDisplay.get(toKey),
        color: '#6b3f2a',
      },
      // Matches trend panel legend (blue line = UP Average, grey band = Best)
      bars: { label: 'Selected area', style: 'bar', color: '#e07a3d' },
      up_avg: { label: 'UP Average', style: 'line', color: '#1e88e5' },
      best_perf: { label: 'Best Performance', style: 'area', color: '#bdbdbd' },
    },
    periods: axisKeys.map((k) => ({
      key: k,
      label: axisDisplay.get(k) || k,
      short_label: axisMode === 'month' ? shortPeriodLabel(k) : axisDisplay.get(k) || k,
    })),
    available_months: availableMonths,
    missing_months: monthLabels.filter((m) => !imported.includes(m)),
    geo_level: scope.geoLevel,
    geo_name: scope.geoName,
    division: scope.division ? scope.division.name : null,
    div_code: scope.division ? scope.division.code : null,
    district: scope.districtName,
    block: scope.geoLevel === 'block' ? scope.geoName : block && String(block).toLowerCase() !== 'all' ? block : 'All Blocks',
    breadcrumb: scope.breadcrumb,
    breadcrumb_display: scope.breadcrumb.join(' → ').toUpperCase(),
    compare: { up_avg: wantUp, best_perf: wantBest },
    panel_tab: panel,
    labels: labels === true || labels === 1 || labels === '1' || labels === 'true',
    analytics_compare: analyticsCompare || 'timeperiod',
    analytics_mode: analyticsMode || axisMode,
    request,
    composite,
    indicators: indicatorRows,
    by_domain,
    by_type,
    count: indicatorRows.length,
  };
}

module.exports = {
  getGeoOptions,
  getAnalyticsDashboard,
  parseFrontendAnalyticsQuery,
  parseAreaSlug,
  slugToTitle,
  monthRange,
  parseQuarterToken,
  expandQuarters,
};
