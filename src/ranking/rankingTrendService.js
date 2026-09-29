/**
 * Trend / comparison chart for health-ranking VIEW BY: Trend.
 * Source: indicator_outcome_district / indicator_outcome_block (genuine cached outcome scores).
 *
 * FE example:
 * GET /api/ranking/trend?level=district&from_period=2026-01&to_period=2026-06
 *   &area_id=173&area_name=Pilibhit&compare_area_id=145&compare_name=Ghaziabad
 * GET /api/ranking/trend?level=block&from_period=2026-01&to_period=2026-07
 *   &area_id=1329&block=Bakshi-Ka-Talab&compare_area_id=121&compare_name=Ambedkar+Nagar
 *   &indicator_code=IND004
 */
const { query } = require('../db/pool');
const {
  listOutcomePeriodLabels,
  listBlockOutcomePeriodLabels,
  loadCompositeByPeriod,
  loadIndicatorByPeriod,
  resolveMasterIndicator,
} = require('../outcome/outcomeRankingQueries');
const { normalizeGeoName, normalizeDistrictName } = require('./rankingNameNormalize');

/** Periods pulled from live outcome API (exclude manual clones). */
async function listApiSyncedPeriodLabels(geoLevel = 'district') {
  if (geoLevel === 'block') {
    const { rows } = await query(
      `
      SELECT DISTINCT period_label
      FROM indicator_outcome_block
      WHERE source = 'api'
      ORDER BY period_label
      `
    );
    return rows.map((r) => r.period_label);
  }
  const { rows } = await query(
    `
    SELECT DISTINCT period_label
    FROM indicator_outcome_district
    WHERE source = 'api'
    ORDER BY period_label
    `
  );
  return rows.map((r) => r.period_label);
}

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function round(v, digits = 4) {
  if (v == null || Number.isNaN(Number(v))) return null;
  const f = 10 ** digits;
  return Math.round(Number(v) * f + 1e-9) / f;
}

function avg(vals) {
  const xs = vals.filter((x) => x != null && !Number.isNaN(Number(x))).map(Number);
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Display score same as ranking table (index → 2 dp like 0.55; percent → 2 dp). */
function displayScore(value, unit) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const n = Number(value);
  const u = String(unit || 'index').toLowerCase();
  if (u === 'index') return round(n, 2);
  if (u === 'percent') return round(n, 2);
  if (u === 'amount') return round(n, 2);
  return round(n, 2);
}

/**
 * Y-axis + plot scale for selected metric.
 * Composite index matches DISTRICT RANKING (0–1), not ×100.
 * Percent indicators use 0–100.
 */
function chartAxisForUnit(unit, seriesValues = []) {
  const u = String(unit || 'index').toLowerCase();
  const xs = seriesValues.filter((x) => x != null && !Number.isNaN(Number(x))).map(Number);
  const dataMax = xs.length ? Math.max(...xs) : 0;

  if (u === 'index') {
    return {
      y_min: 0,
      y_max: 1,
      y_label: 'Overall Composite Score',
      chart_unit: 'index',
      tick_hint: [0, 0.25, 0.5, 0.75, 1],
    };
  }
  if (u === 'percent') {
    return {
      y_min: 0,
      y_max: Math.max(100, Math.ceil(dataMax / 10) * 10 || 100),
      y_label: 'Percent',
      chart_unit: 'percent',
      tick_hint: [0, 25, 50, 75, 100],
    };
  }
  if (u === 'amount') {
    const ymax = dataMax > 0 ? Math.ceil(dataMax * 1.15) : 1;
    return {
      y_min: 0,
      y_max: ymax,
      y_label: 'Amount',
      chart_unit: 'amount',
      tick_hint: null,
    };
  }
  const ymax = dataMax > 0 ? Math.ceil(dataMax * 1.15 * 100) / 100 : 1;
  return {
    y_min: 0,
    y_max: ymax,
    y_label: 'Value',
    chart_unit: u || 'number',
    tick_hint: null,
  };
}

function shortPeriodLabel(label) {
  const m = String(label || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return label;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(m[2]) - 1]} '${String(m[1]).slice(2)}`;
}

function displayPeriod(label) {
  const m = String(label || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return label;
  const names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${names[Number(m[2]) - 1]} ${m[1]}`;
}

function monthRange(fromLabel, toLabel) {
  const from = String(fromLabel || '').match(/^(\d{4})-(\d{2})$/);
  const to = String(toLabel || '').match(/^(\d{4})-(\d{2})$/);
  if (!from || !to) return [];
  let y = Number(from[1]);
  let mo = Number(from[2]);
  const endY = Number(to[1]);
  const endM = Number(to[2]);
  const out = [];
  for (let i = 0; i < 48; i += 1) {
    const pl = `${y}-${String(mo).padStart(2, '0')}`;
    out.push(pl);
    if (y === endY && mo === endM) break;
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Resolve division / district / block from FE ids/names.
 * area_id: prefer LGD (Pilibhit=173, Bakshi-Ka-Talab=1329), then master id, then name.
 */
async function resolveArea({ level, areaId, areaName, divCode, districtHint } = {}) {
  const lvl = String(level || 'district').toLowerCase();
  const rawId = areaId != null && String(areaId).trim() !== '' ? String(areaId).trim() : null;
  const rawName = areaName != null && String(areaName).trim() !== '' ? String(areaName).trim() : null;

  if (lvl === 'block') {
    const nameNorm = rawName
      ? String(rawName)
          .trim()
          .replace(/-/g, ' ')
      : null;
    const { rows } = await query(
      `
      SELECT b.id, b.name, b.lgd_code, b.district_id,
             d.name AS district_name, d.lgd_code AS district_lgd,
             dv.name AS division_name, dv.code AS division_code
      FROM block b
      JOIN district d ON d.id = b.district_id
      LEFT JOIN division dv ON dv.id = d.division_id
      WHERE ($1::text IS NOT NULL AND (
              b.lgd_code::text = $1
           OR b.id::text = $1
           ))
         OR ($2::text IS NOT NULL AND (
              lower(trim(b.name)) = lower(trim($2))
           OR lower(replace(trim(b.name), ' ', '-')) = lower(replace(trim($2), ' ', '-'))
           OR lower(replace(trim(b.name), ' ', '')) = lower(replace(trim($2), ' ', ''))
           ))
         OR ($3::text IS NOT NULL AND (
              d.lgd_code::text = $3 OR d.id::text = $3 OR lower(trim(d.name)) = lower(trim($3))
           ) AND $2::text IS NOT NULL AND (
              lower(trim(b.name)) = lower(trim($2))
           OR lower(replace(trim(b.name), ' ', '-')) = lower(replace(trim($2), ' ', '-'))
           ))
      ORDER BY
        CASE
          WHEN $1::text IS NOT NULL AND b.lgd_code::text = $1 THEN 0
          WHEN $1::text IS NOT NULL AND b.id::text = $1 THEN 1
          ELSE 2
        END
      LIMIT 1
      `,
      [rawId, nameNorm || rawName, districtHint ? String(districtHint).trim() : null]
    );
    if (!rows[0]) return null;
    const lgd = rows[0].lgd_code != null ? Number(rows[0].lgd_code) : null;
    const dtLgd = rows[0].district_lgd != null ? Number(rows[0].district_lgd) : null;
    return {
      level: 'block',
      id: Number(rows[0].id),
      code: null,
      name: rows[0].name,
      area_id: lgd,
      lgd_code: lgd,
      block_id: Number(rows[0].id),
      block_lgd: lgd,
      district_id: rows[0].district_id != null ? Number(rows[0].district_id) : null,
      district_name: rows[0].district_name || null,
      district_lgd: dtLgd,
      division_name: rows[0].division_name || null,
      division_code: rows[0].division_code || null,
      match_name: rows[0].name,
    };
  }

  if (lvl === 'division') {
    const { rows } = await query(
      `
      SELECT id, code, name
      FROM division
      WHERE ($1::text IS NOT NULL AND (code::text = $1 OR id::text = $1))
         OR ($2::text IS NOT NULL AND (
              lower(trim(name)) = lower(trim($2))
           OR lower(trim(name)) = lower(trim($2)) || ' division'
           OR lower(replace(trim(name), ' division', '')) = lower(replace(trim($2), ' division', ''))
         ))
         OR ($3::text IS NOT NULL AND code::text = $3)
      ORDER BY
        CASE
          WHEN $1::text IS NOT NULL AND code::text = $1 THEN 0
          WHEN $1::text IS NOT NULL AND id::text = $1 THEN 1
          ELSE 2
        END
      LIMIT 1
      `,
      [rawId, rawName ? normalizeGeoName(rawName) : null, divCode ? String(divCode) : null]
    );
    if (!rows[0]) return null;
    return {
      level: 'division',
      id: Number(rows[0].id),
      code: rows[0].code,
      name: rows[0].name,
      area_id: rows[0].code != null ? Number(rows[0].code) || rows[0].code : Number(rows[0].id),
      lgd_code: null,
      match_name: rows[0].name,
    };
  }

  // district
  const nameNorm = rawName ? normalizeDistrictName(rawName) : null;
  const { rows } = await query(
    `
    SELECT d.id, d.name, d.lgd_code, d.division_id,
           dv.name AS division_name, dv.code AS division_code
    FROM district d
    LEFT JOIN division dv ON dv.id = d.division_id
    WHERE ($1::text IS NOT NULL AND (
            d.lgd_code::text = $1
         OR d.id::text = $1
         ))
       OR ($2::text IS NOT NULL AND (
            lower(trim(d.name)) = lower(trim($2))
         OR lower(replace(trim(d.name), ' ', '-')) = lower(replace(trim($2), ' ', '-'))
         OR lower(replace(trim(d.name), ' ', '')) = lower(replace(trim($2), ' ', ''))
         ))
    ORDER BY
      CASE
        WHEN $1::text IS NOT NULL AND d.lgd_code::text = $1 THEN 0
        WHEN $1::text IS NOT NULL AND d.id::text = $1 THEN 1
        ELSE 2
      END
    LIMIT 1
    `,
    [rawId, nameNorm]
  );
  if (!rows[0]) return null;
  const lgd = rows[0].lgd_code != null ? Number(rows[0].lgd_code) : null;
  return {
    level: 'district',
    id: Number(rows[0].id),
    code: null,
    name: rows[0].name,
    area_id: lgd,
    lgd_code: lgd,
    district_id: Number(rows[0].id),
    division_id: rows[0].division_id != null ? Number(rows[0].division_id) : null,
    division_name: rows[0].division_name || null,
    division_code: rows[0].division_code || null,
    match_name: rows[0].name,
  };
}

function pickSeriesForName(rows, matchName, lgd, { blockLgd } = {}) {
  const want = String(matchName || '')
    .toLowerCase()
    .replace(/\s+division$/i, '')
    .trim();
  return rows.filter((r) => {
    if (blockLgd != null && r.block_lgd != null && Number(r.block_lgd) === Number(blockLgd)) {
      return true;
    }
    if (lgd != null && r.district_lgd != null && Number(r.district_lgd) === Number(lgd)) {
      return true;
    }
    const n = String(r.name || '')
      .toLowerCase()
      .replace(/\s+division$/i, '')
      .trim();
    // Prefer exact / prefix match — avoid "Rampur" ⊂ longer names incorrectly
    return n === want || n.startsWith(want) || want.startsWith(n);
  });
}

function value100(v) {
  if (v == null) return null;
  return round(Number(v) * 100, 1);
}

function enrichSeriesPoint(value, rank, pl, unit) {
  const raw = value != null ? round(value, 4) : null;
  return {
    period: pl,
    label: displayPeriod(pl),
    short_label: shortPeriodLabel(pl),
    value: raw,
    display_value: displayScore(raw, unit),
    value_100: unit === 'index' ? value100(raw) : displayScore(raw, unit),
    rank: rank != null ? Number(rank) : null,
  };
}

function buildAreaSeries(periodLabels, rows, area, unit = 'index') {
  const byPeriod = new Map();
  for (const r of rows) {
    byPeriod.set(r.period, r);
  }
  const series = periodLabels.map((pl) => {
    const hit = byPeriod.get(pl);
    return enrichSeriesPoint(hit ? num(hit.value) : null, hit && hit.rank, pl, unit);
  });
  const latest = [...series].reverse().find((p) => p.value != null) || null;
  return {
    name: area.name,
    level: area.level,
    area_id: area.area_id,
    district_id: area.district_id || (area.level === 'district' ? area.id : null) || null,
    block_id: area.block_id || (area.level === 'block' ? area.id : null) || null,
    lgd_code: area.lgd_code != null ? String(area.lgd_code) : null,
    block_lgd: area.block_lgd != null ? Number(area.block_lgd) : null,
    district_lgd: area.district_lgd != null ? Number(area.district_lgd) : null,
    division_code: area.division_code || area.code || null,
    series,
    latest: latest
      ? {
          period: latest.period,
          label: latest.short_label,
          value: latest.value,
          display_value: latest.display_value,
          value_100: latest.value_100,
          rank: latest.rank,
        }
      : null,
  };
}

function buildUpAvgSeries(periodLabels, allDistrictRows, unit = 'index') {
  const byPeriod = new Map();
  for (const r of allDistrictRows) {
    if (!byPeriod.has(r.period)) byPeriod.set(r.period, []);
    if (r.value != null) byPeriod.get(r.period).push(r.value);
  }
  const series = periodLabels.map((pl) => {
    const value = avg(byPeriod.get(pl) || []);
    return enrichSeriesPoint(value, null, pl, unit);
  });
  const latest = [...series].reverse().find((p) => p.value != null) || null;
  return {
    name: 'UP',
    level: 'state',
    area_id: null,
    series,
    latest: latest
      ? {
          period: latest.period,
          label: latest.short_label,
          value: latest.value,
          display_value: latest.display_value,
          value_100: latest.value_100,
        }
      : null,
  };
}

async function listCompareOptions(level, { districtLgd, districtId } = {}) {
  const lvl = String(level || 'district').toLowerCase();
  if (lvl === 'division') {
    const { rows } = await query(
      `SELECT id, code, name FROM division WHERE is_active = TRUE ORDER BY name`
    );
    return rows.map((r) => ({
      name: r.name,
      value: r.name,
      id: Number(r.id),
      area_id: r.code != null ? Number(r.code) || r.code : Number(r.id),
      code: r.code,
    }));
  }
  if (lvl === 'block') {
    const params = [];
    let sql = `
      SELECT b.id, b.name, b.lgd_code, d.id AS district_id, d.name AS district_name,
             d.lgd_code AS district_lgd
      FROM block b
      JOIN district d ON d.id = b.district_id
      WHERE b.is_active = TRUE
    `;
    if (districtLgd != null || districtId != null) {
      params.push(districtLgd != null ? String(districtLgd) : null);
      params.push(districtId != null ? String(districtId) : null);
      sql += ` AND (
        ($1::text IS NOT NULL AND d.lgd_code::text = $1)
        OR ($2::text IS NOT NULL AND d.id::text = $2)
      )`;
    }
    sql += ` ORDER BY b.name`;
    const { rows } = await query(sql, params);
    return rows.map((r) => ({
      name: r.name,
      value: r.name,
      id: Number(r.id),
      block_id: Number(r.id),
      area_id: r.lgd_code != null ? Number(r.lgd_code) : null,
      lgd_code: r.lgd_code != null ? String(r.lgd_code) : null,
      district_id: r.district_id != null ? Number(r.district_id) : null,
      district_name: r.district_name,
      district_lgd: r.district_lgd != null ? Number(r.district_lgd) : null,
    }));
  }
  const { rows } = await query(
    `
    SELECT d.id, d.name, d.lgd_code, dv.code AS div_code, dv.name AS division_name
    FROM district d
    JOIN division dv ON dv.id = d.division_id
    WHERE d.is_active = TRUE
    ORDER BY d.name
    `
  );
  return rows.map((r) => ({
    name: r.name,
    value: r.name,
    id: Number(r.id),
    district_id: Number(r.id),
    area_id: r.lgd_code != null ? Number(r.lgd_code) : null,
    lgd_code: r.lgd_code != null ? String(r.lgd_code) : null,
    div_code: r.div_code,
    division_name: r.division_name,
  }));
}

/**
 * Main trend payload for VIEW BY: Trend (+ Compare with).
 */
async function getTrendDashboard(queryParams = {}) {
  const q = queryParams || {};
  const rawLevel = String(q.level || q.geo_level || q.table_mode || 'district').toLowerCase();
  const geoLevel =
    rawLevel === 'division' ? 'division' : rawLevel === 'block' ? 'block' : 'district';

  const indicatorCodeRaw = String(
    q.indicator_code || q.indicator || 'RANK_COMPOSITE'
  )
    .trim()
    .toUpperCase();
  const masterInd = await resolveMasterIndicator(indicatorCodeRaw);
  if (!masterInd) {
    return {
      view: 'trend',
      source: 'indicator_outcome',
      has_data: false,
      message: `Unknown indicator_code: ${indicatorCodeRaw}`,
      geo_level: geoLevel,
      periods: [],
      primary: null,
      compare: null,
      up_avg: null,
      chart: null,
    };
  }
  const isComposite = !!masterInd.is_composite;
  const indicatorCode = isComposite ? 'RANK_COMPOSITE' : masterInd.code;
  const unit = String(masterInd.unit || (isComposite ? 'index' : 'percent')).toLowerCase();
  const metricName = masterInd.short_name || masterInd.name || 'Overall composite score';

  const districtPeriods = await listOutcomePeriodLabels();
  const blockPeriods = geoLevel === 'block' ? await listBlockOutcomePeriodLabels() : [];
  // Axis uses district periods (UP/compare) ∪ block periods so FE Jan–Jul range works;
  // primary block series is null where that block has no row.
  const imported = Array.from(
    new Set([...(districtPeriods || []), ...(blockPeriods || [])])
  ).sort();
  if (!imported.length) {
    return {
      view: 'trend',
      source: 'indicator_outcome',
      has_data: false,
      message: 'No outcome periods synced yet',
      geo_level: geoLevel,
      metric: {
        code: indicatorCode,
        name: metricName,
        unit,
      },
      periods: [],
      primary: null,
      compare: null,
      up_avg: null,
      chart: null,
    };
  }

  let periodFrom =
    q.from_period || q.period_from || q.from || q.analytics_from || null;
  let periodTo = q.to_period || q.period_to || q.to || q.analytics_to || null;
  const monthsN = q.months != null && q.months !== '' ? Number(q.months) : null;

  // Prefer ending at latest API-synced month (e.g. July) so FE to_period=2026-06 still shows new data
  const apiMonths = await listApiSyncedPeriodLabels(geoLevel === 'block' ? 'block' : 'district');
  const latestApi = apiMonths.length ? apiMonths[apiMonths.length - 1] : null;
  const rangeEnd =
    latestApi && imported.includes(latestApi)
      ? latestApi
      : imported[imported.length - 1];

  if (monthsN && Number.isFinite(monthsN) && monthsN > 0) {
    const upTo = imported.filter((pl) => String(pl) <= String(rangeEnd));
    const slice = upTo.slice(-Math.min(monthsN, upTo.length));
    // If FE omitted from/to, use last N ending at latest API month
    if (!periodFrom) periodFrom = slice[0];
    if (!periodTo) periodTo = slice[slice.length - 1];
  }
  if (!periodFrom) periodFrom = imported[0];
  if (!periodTo) periodTo = rangeEnd;
  // Always include newly synced API months beyond FE's to_period (May–Jul live sync)
  if (latestApi && String(periodTo) < String(latestApi)) {
    periodTo = latestApi;
  }
  if (String(periodFrom) > String(periodTo)) {
    const tmp = periodFrom;
    periodFrom = periodTo;
    periodTo = tmp;
  }

  const allInRange = monthRange(periodFrom, periodTo);
  const periodLabels = allInRange.filter((pl) => imported.includes(pl));
  // Axis = months that exist in cache within range (skip holes)
  const axisLabels = periodLabels.length ? periodLabels : allInRange;

  const primaryName =
    q.area_name ||
    q.block ||
    q.block_name ||
    q.selected_block ||
    q.district ||
    q.district_name ||
    q.selected_district ||
    q.division ||
    null;
  const primaryId =
    q.area_id ||
    q.block_id ||
    q.block_lgd ||
    q.district_lgd ||
    q.lgd ||
    (geoLevel === 'district'
      ? q.district_id
      : geoLevel === 'block'
        ? q.block_id || q.area_id
        : q.div_code) ||
    null;

  let primary = await resolveArea({
    level: geoLevel,
    areaId: primaryId,
    areaName: primaryName,
    divCode: q.div_code || null,
    districtHint: q.district || q.dt_lgd || q.district_lgd || null,
  });
  // Block FE sometimes only sends area_id=LGD without level correctly — already handled.
  // If block resolve failed but name looks like a block, try once more with block param only.
  if (!primary && geoLevel === 'block' && (q.block || q.block_name || q.area_id)) {
    primary = await resolveArea({
      level: 'block',
      areaId: q.area_id || q.block_id || q.block_lgd,
      areaName: q.block || q.block_name || q.area_name,
      districtHint: q.district || q.dt_lgd || q.district_lgd || null,
    });
  }

  // Compare: at block level FE often picks a district (Ambedkar Nagar).
  // Block LGD and district LGD can collide (e.g. 121) — prefer name match.
  const compareId =
    q.compare_area_id || q.compare_id || q.compare_lgd || q.compare_with_id || null;
  const compareName =
    q.compare_name ||
    q.compare_with ||
    q.compare_district ||
    q.compare_block ||
    q.compare_division ||
    q.compare ||
    null;

  function namesRoughlyEqual(a, b) {
    const na = String(a || '')
      .toLowerCase()
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const nb = String(b || '')
      .toLowerCase()
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return na && nb && (na === nb || na.startsWith(nb) || nb.startsWith(na));
  }

  let compare = null;
  if (geoLevel === 'block' && (compareId || compareName)) {
    const asBlock = await resolveArea({
      level: 'block',
      areaId: compareId,
      areaName: compareName,
      districtHint: q.district || q.dt_lgd || null,
    });
    const asDistrict = await resolveArea({
      level: 'district',
      areaId: compareId,
      areaName: compareName,
    });
    if (compareName) {
      if (asDistrict && namesRoughlyEqual(asDistrict.name, compareName)) compare = asDistrict;
      else if (asBlock && namesRoughlyEqual(asBlock.name, compareName)) compare = asBlock;
      else compare = asDistrict || asBlock;
    } else {
      // id-only: prefer block when on block chart
      compare = asBlock || asDistrict;
    }
  } else {
    compare = await resolveArea({
      level: geoLevel,
      areaId: compareId,
      areaName: compareName,
      divCode: q.compare_div_code || null,
      districtHint: q.district || q.dt_lgd || null,
    });
  }

  const includeUp =
    q.compare_up_avg === undefined && q.up_avg === undefined
      ? true
      : !(
          q.compare_up_avg === '0' ||
          q.compare_up_avg === 'false' ||
          q.compare_up_avg === false ||
          q.up_avg === '0' ||
          q.up_avg === 'false' ||
          q.up_avg === false
        );

  const queryMonths = periodLabels.length ? periodLabels : imported;

  async function loadPool(level) {
    if (isComposite) return loadCompositeByPeriod(level, queryMonths);
    return loadIndicatorByPeriod({
      geoLevel: level,
      indicatorCode,
      periodLabels: queryMonths,
      isNegative: !!masterInd.is_negative,
    });
  }

  const primaryPoolLevel = primary?.level || geoLevel;
  const comparePoolLevel = compare?.level || geoLevel;
  const primaryPool = await loadPool(primaryPoolLevel);
  const comparePool =
    comparePoolLevel === primaryPoolLevel ? primaryPool : await loadPool(comparePoolLevel);

  // UP average always from district pool (state mean)
  const districtPool = await loadPool('district');

  let primaryPayload = null;
  if (primary) {
    const rows = pickSeriesForName(primaryPool, primary.match_name, primary.lgd_code, {
      blockLgd: primary.block_lgd,
    });
    primaryPayload = buildAreaSeries(axisLabels, rows, primary, unit);
  }

  let comparePayload = null;
  if (
    compare &&
    (!primary ||
      compare.match_name !== primary.match_name ||
      compare.level !== primary.level ||
      Number(compare.lgd_code) !== Number(primary.lgd_code))
  ) {
    const rows = pickSeriesForName(comparePool, compare.match_name, compare.lgd_code, {
      blockLgd: compare.block_lgd,
    });
    comparePayload = buildAreaSeries(axisLabels, rows, compare, unit);
  }

  const upPayload = includeUp ? buildUpAvgSeries(axisLabels, districtPool, unit) : null;

  // Plot values on the SAME scale as DISTRICT RANKING (index 0–1, percent 0–100, …)
  const plotValues = (payload) => (payload?.series || []).map((p) => p.display_value);
  const allPlotVals = [
    ...plotValues(primaryPayload),
    ...plotValues(comparePayload),
    ...plotValues(upPayload),
  ];
  const axis = chartAxisForUnit(unit, allPlotVals);
  // Dynamic label: composite vs selected indicator
  if (!isComposite) {
    axis.y_label = metricName;
  }

  const chartSeries = [];
  if (upPayload) {
    chartSeries.push({
      key: 'up',
      name: 'UP',
      role: 'up_average',
      style: 'dashed',
      color: '#212121',
      data: plotValues(upPayload),
      latest: upPayload.latest,
    });
  }
  if (primaryPayload) {
    chartSeries.push({
      key: 'primary',
      name: primaryPayload.name,
      role: 'primary',
      style: 'solid',
      color: '#f5c518',
      data: plotValues(primaryPayload),
      latest: primaryPayload.latest,
    });
  }
  if (comparePayload) {
    chartSeries.push({
      key: 'compare',
      name: comparePayload.name,
      role: 'compare',
      style: 'solid',
      color: '#e07a3d',
      data: plotValues(comparePayload),
      latest: comparePayload.latest,
    });
  }

  const compareOptions = await listCompareOptions(geoLevel, {
    districtLgd: primary?.district_lgd || q.dt_lgd || q.district_lgd || null,
    districtId: primary?.district_id || null,
  });
  const hasData = Boolean(
    (primaryPayload && primaryPayload.series.some((p) => p.value != null)) ||
      (comparePayload && comparePayload.series.some((p) => p.value != null)) ||
      (upPayload && upPayload.series.some((p) => p.value != null))
  );

  return {
    view: 'trend',
    source: 'indicator_outcome',
    has_data: hasData,
    message: hasData
      ? null
      : primary
        ? 'No outcome scores in this period range for the selected area'
        : 'Provide area_id (LGD) or area_name / district / block / division',
    geo_level: geoLevel,
    level: geoLevel,
    indicator_code: indicatorCode,
    metric: {
      code: indicatorCode,
      name: metricName,
      full_name: masterInd.name || metricName,
      label: String(metricName || '').toUpperCase(),
      unit,
      chart_unit: axis.chart_unit,
      is_composite: isComposite,
      is_negative: !!masterInd.is_negative,
    },
    period_from: periodFrom,
    period_to: periodTo,
    period_from_display: displayPeriod(periodFrom),
    period_to_display: displayPeriod(periodTo),
    periods: axisLabels.map((pl) => ({
      key: pl,
      label: displayPeriod(pl),
      short_label: shortPeriodLabel(pl),
      has_data: imported.includes(pl),
    })),
    available_months: imported,
    api_synced_months: apiMonths,
    missing_months: allInRange.filter((pl) => !imported.includes(pl)),
    primary: primaryPayload,
    compare: comparePayload,
    up_avg: upPayload,
    legend: [
      upPayload && {
        key: 'up',
        name: 'UP',
        style: 'dashed',
        color: '#212121',
        latest_value: upPayload.latest?.display_value ?? null,
      },
      primaryPayload && {
        key: 'primary',
        name: primaryPayload.name,
        style: 'solid',
        color: '#f5c518',
        latest_value: primaryPayload.latest?.display_value ?? null,
      },
      comparePayload && {
        key: 'compare',
        name: comparePayload.name,
        style: 'solid',
        color: '#e07a3d',
        latest_value: comparePayload.latest?.display_value ?? null,
      },
    ].filter(Boolean),
    chart: {
      x: axisLabels.map((pl) => shortPeriodLabel(pl)),
      periods: axisLabels,
      y_min: axis.y_min,
      y_max: axis.y_max,
      y_label: axis.y_label,
      y_unit: axis.chart_unit,
      tick_hint: axis.tick_hint,
      series: chartSeries,
    },
    compare_options: compareOptions,
    request: {
      level: geoLevel,
      from_period: periodFrom,
      to_period: periodTo,
      area_id: q.area_id || null,
      area_name: q.area_name || q.block || null,
      compare_area_id: q.compare_area_id || q.compare_id || null,
      compare_name: q.compare_name || q.compare_with || q.compare || null,
      indicator_code: indicatorCode,
    },
  };
}

module.exports = {
  getTrendDashboard,
  resolveArea,
};
