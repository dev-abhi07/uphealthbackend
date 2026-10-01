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
  resolveExcelDomainKey,
  typeMeta,
} = require('./rankingRegistry');
const {
  listOutcomePeriodLabels,
  loadCompositeByPeriod,
  loadIndicatorByPeriod,
} = require('../outcome/outcomeRankingQueries');

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
    q.area_name ||
    q.district_name ||
    q.selected_district ||
    // Prefer explicit district_id (master PK or LGD) — resolved in resolveScope
    (q.district_id != null && String(q.district_id).trim() !== ''
      ? String(q.district_id).trim()
      : null) ||
    // Numeric area_id is LGD / master id — resolved in resolveScope
    (q.area_id && /^\d+$/.test(String(q.area_id)) && !q.block && !q.block_id
      ? String(q.area_id).trim()
      : null) ||
    (q.area_id && !/^\d+$/.test(String(q.area_id)) ? slugToTitle(q.area_id) : null) ||
    blockSlug.district ||
    districtSlug.district ||
    (q.parent_area_id && !/^\d+$/.test(String(q.parent_area_id))
      ? slugToTitle(q.parent_area_id)
      : null);

  const block =
    q.block ||
    q.block_name ||
    q.selected_block ||
    // block_id may be name ("Chinhat"), master id, LGD, or district__block slug
    (q.block_id &&
    !/^\d+$/.test(String(q.block_id).trim()) &&
    !String(q.block_id).includes('__')
      ? String(q.block_id).trim()
      : null) ||
    (blockSlug.block ? blockSlug.block : null) ||
    (q.area_id &&
    !/^\d+$/.test(String(q.area_id).trim()) &&
    !String(q.area_id).includes('__') &&
    (q.block_id || String(q.level || q.geo_level || '').toLowerCase() === 'block')
      ? String(q.area_id).trim()
      : null) ||
    null;

  // parent_area_id is division.code on map drill-down, but district slug on analytics block view
  const parentRaw = q.parent_area_id != null ? String(q.parent_area_id).trim() : '';
  const parentIsDivCode = /^\d+$/.test(parentRaw);
  const divCode = q.div_code || (parentIsDivCode ? parentRaw : null);
  const division = q.division || null;

  let periodFrom = q.period_from || q.from_period || q.from || null;
  let periodTo = q.period_to || q.to_period || q.to || null;
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
  return listOutcomePeriodLabels();
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
      SELECT d.name, d.id, d.lgd_code, dv.code AS div_code, dv.name AS division_name
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
      SELECT d.name, d.id, d.lgd_code, dv.code AS div_code, dv.name AS division_name
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

  return {
    divisions: divisions.map((d) => ({ code: d.code, name: d.name, value: d.name })),
    districts: districts.map((d) => ({
      name: d.name,
      value: d.name,
      id: d.id != null ? Number(d.id) : null,
      district_id: d.id != null ? Number(d.id) : null,
      lgd_code: d.lgd_code != null ? String(d.lgd_code) : null,
      // Same as ranking[].area_id — Excel DistrictLGDcode (Pilibhit = 173)
      area_id: d.lgd_code != null ? Number(d.lgd_code) : null,
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
    const raw = String(district).trim();
    let rows = [];
    if (/^\d+$/.test(raw)) {
      const hit = await query(
        `
        SELECT d.name, dv.name AS division_name, dv.code AS div_code
        FROM district d
        JOIN division dv ON dv.id = d.division_id
        WHERE d.id::text = $1 OR d.lgd_code::text = $1
        LIMIT 1
        `,
        [raw]
      );
      rows = hit.rows;
    } else {
      const dn = normalizeGeoName(district);
      const hit = await query(
        `
        SELECT d.name, dv.name AS division_name, dv.code AS div_code
        FROM district d
        JOIN division dv ON dv.id = d.division_id
        WHERE d.name ILIKE $1
        LIMIT 1
        `,
        [dn]
      );
      rows = hit.rows;
    }
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
    const { rows: blockHit } = await query(
      `
      SELECT b.name
      FROM block b
      JOIN district d ON d.id = b.district_id
      WHERE d.name ILIKE $1
        AND (
          b.name ILIKE $2
          OR replace(lower(b.name), ' ', '-') = lower($3)
          OR replace(lower(b.name), ' ', '') = replace(lower($2), ' ', '')
          OR b.id::text = $2
          OR b.lgd_code::text = $2
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
 * Load values for one indicator across geos for given periods (outcome tables).
 * indicatorCode: RANK_COMPOSITE or IND###
 */
async function loadIndicatorValues({
  indicatorCode,
  geoLevel,
  periodLabels,
  geoName,
  districtName = null,
  isNegative = false,
}) {
  if (!periodLabels.length) return [];
  const code = String(indicatorCode || 'RANK_COMPOSITE').toUpperCase();
  const isComposite = !code || code === 'RANK_COMPOSITE' || code === 'COMPOSITE';

  if (geoLevel === 'state') {
    const level = 'district';
    const rows = isComposite
      ? await loadCompositeByPeriod(level, periodLabels)
      : await loadIndicatorByPeriod({
          geoLevel: level,
          indicatorCode: code,
          periodLabels,
          isNegative,
        });
    const byPeriod = new Map();
    for (const r of rows) {
      if (!byPeriod.has(r.period)) byPeriod.set(r.period, []);
      byPeriod.get(r.period).push(r.value);
    }
    return [...byPeriod.entries()].map(([period, vals]) => ({
      period,
      value: avg(vals),
      geo_name: 'Uttar Pradesh',
    }));
  }

  if (geoLevel === 'block') {
    const rows = isComposite
      ? await loadCompositeByPeriod('block', periodLabels)
      : await loadIndicatorByPeriod({
          geoLevel: 'block',
          indicatorCode: code,
          periodLabels,
          isNegative,
        });
    const filtered = geoName
      ? rows.filter((r) => {
          const nameOk =
            String(r.name || '').toLowerCase() === String(geoName).toLowerCase() ||
            normalizeGeoName(r.name || '').toLowerCase() ===
              normalizeGeoName(geoName).toLowerCase();
          if (!nameOk) return false;
          if (districtName) {
            const dn = normalizeGeoName(districtName).toLowerCase();
            const rd = normalizeGeoName(r.district_name || '').toLowerCase();
            if (rd && dn && rd !== dn) return false;
          }
          return true;
        })
      : rows;
    const hasValue = filtered.some((r) => r.value != null);
    // Some indicators (e.g. Ayushman Bharat Digital Mission) are district-only
    if (!hasValue && districtName) {
      const distRows = await loadIndicatorValues({
        indicatorCode: code,
        geoLevel: 'district',
        periodLabels,
        geoName: districtName,
        isNegative,
      });
      return distRows.map((r) => ({
        ...r,
        geo_name: geoName || r.geo_name,
        district_name: districtName,
        value_source: 'district_fallback',
      }));
    }
    return filtered.map((r) => ({
      period: r.period,
      value: r.value,
      geo_name: r.name,
      district_name: r.district_name || null,
    }));
  }

  const level = geoLevel === 'division' ? 'division' : 'district';
  const rows = isComposite
    ? await loadCompositeByPeriod(level, periodLabels)
    : await loadIndicatorByPeriod({
        geoLevel: level,
        indicatorCode: code,
        periodLabels,
        isNegative,
      });

  const filtered = geoName
    ? rows.filter((r) => String(r.name).toLowerCase() === String(geoName).toLowerCase()
      || String(r.name).toLowerCase().includes(String(geoName).toLowerCase().replace(/ division$/i, '')))
    : rows;

  return filtered.map((r) => ({
    period: r.period,
    value: r.value,
    rank: r.rank,
    geo_name: r.name,
  }));
}

async function loadDistrictPool({ indicatorCode, periodLabels, isNegative = false }) {
  const code = String(indicatorCode || 'RANK_COMPOSITE').toUpperCase();
  const isComposite = !code || code === 'RANK_COMPOSITE' || code === 'COMPOSITE';
  const rows = isComposite
    ? await loadCompositeByPeriod('district', periodLabels)
    : await loadIndicatorByPeriod({
        geoLevel: 'district',
        indicatorCode: code,
        periodLabels,
        isNegative,
      });
  return rows.map((r) => ({
    period: r.period,
    geo_name: r.name,
    value: r.value,
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
        message: 'No outcome periods synced yet',
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

  const { rows: masterInds } = await query(
    `
    SELECT code, name, short_name, unit, is_negative, sno,
           domain, domain_label, indicator_type
    FROM indicator
    WHERE is_active = TRUE AND code ~ '^IND\\d{3}$'
    ORDER BY sno NULLS LAST, code
    `
  );
  const indicatorsDb = [
    {
      code: 'RANK_COMPOSITE',
      name: 'Overall composite score',
      short_name: 'Overall composite score',
      unit: 'index',
      is_composite: true,
      is_negative: false,
      sort_order: 0,
    },
    ...masterInds.map((i, idx) => ({
      code: i.code,
      name: i.name,
      short_name: i.short_name || i.name,
      unit: i.unit,
      is_composite: false,
      is_negative: !!i.is_negative,
      domain: i.domain || null,
      domain_label: i.domain_label || null,
      indicator_type: i.indicator_type || null,
      type: i.indicator_type || null,
      sort_order: i.sno != null ? Number(i.sno) : idx + 1,
    })),
  ];

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
      indicatorCode: ind.code,
      geoLevel: scope.geoLevel === 'state' ? 'state' : scope.geoLevel,
      periodLabels: queryMonths,
      geoName: scope.geoLevel === 'state' ? null : scope.geoName,
      districtName: scope.districtName || null,
      isNegative: !!ind.is_negative,
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
        indicatorCode: ind.code,
        periodLabels: queryMonths,
        isNegative: !!ind.is_negative,
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
            const better = ind.is_negative ? r.value < best.value : r.value > best.value;
            if (better) best = r;
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
    const resolvedDomain = resolveExcelDomainKey(
      ind.domain_label,
      ind.domain || g.domain
    );
    const typeKey = String(
      ind.indicator_type || ind.type || g.type || ''
    )
      .trim()
      .toLowerCase() || null;
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
      type: typeKey,
      indicator_type: typeKey,
      type_label: typeKey ? typeMeta(typeKey).label : null,
      // Excel Domain bifurcation (same as map SUMMARY)
      domain: resolvedDomain.key,
      domain_label: resolvedDomain.label,
      domain_slug: ind.domain || g.domain || null,
      sort_order: ind.sort_order != null ? Number(ind.sort_order) : null,
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

  const { by_type, by_domain } = groupIndicatorsForSummary(indicatorRows);

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
