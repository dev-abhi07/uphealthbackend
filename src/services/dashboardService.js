const { query } = require('../db/pool');

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function pickArgs(filters = {}) {
  return {
    geo_level: filters.geo_level || 'district',
    division_id: filters.division_id ? Number(filters.division_id) : null,
    district_id: filters.district_id ? Number(filters.district_id) : null,
    block_id: filters.block_id ? Number(filters.block_id) : null,
    period: filters.period || '2026-05',
    band_size: Number(filters.band_size) > 0 ? Number(filters.band_size) : 25,
    section: filters.section || filters.type || filters.domain || null,
  };
}

function mapIndicatorRow(r) {
  return {
    indicator_id: Number(r.indicator_id),
    sno: r.sno,
    code: r.code,
    name: r.name,
    domain: r.domain,
    indicator_type: r.indicator_type,
    unit: r.unit,
    is_negative: r.is_negative,
    weight: num(r.weight),
    formula_text: r.formula_text,
    geo_level: r.geo_level,
    division_id: r.division_id != null ? Number(r.division_id) : null,
    district_id: r.district_id != null ? Number(r.district_id) : null,
    block_id: r.block_id != null ? Number(r.block_id) : null,
    numerator: num(r.numerator),
    denominator: num(r.denominator),
    value: num(r.value),
    computed_at: r.computed_at,
    period_label: r.period_label,
  };
}

/**
 * BY INDICATORS — uses fn_dashboard_by_indicators
 */
async function getByIndicators(filters = {}) {
  const a = pickArgs(filters);
  const { rows } = await query(
    `SELECT * FROM fn_dashboard_by_indicators($1, $2, $3, $4, $5)`,
    [a.geo_level, a.division_id, a.district_id, a.block_id, a.period]
  );

  const indicators = rows.map(mapIndicatorRow);
  const composite = rows.length ? num(rows[0].overall_composite_score) : null;

  return {
    view: 'by_indicators',
    source: 'pgsql:fn_dashboard_by_indicators',
    period: a.period,
    geo_level: a.geo_level,
    filters: {
      division_id: a.division_id,
      district_id: a.district_id,
      block_id: a.block_id,
    },
    overall_composite_score: composite,
    count: indicators.length,
    indicators,
  };
}

/** Screenshot TYPE accordion order */
const TYPE_SECTIONS = [
  { key: 'coverage', label: 'COVERAGE', color: 'orange' },
  { key: 'quality', label: 'QUALITY', color: 'red' },
  { key: 'data_quality', label: 'DATA QUALITY', color: 'brown' },
];

/** Screenshot DOMAIN accordion order */
const DOMAIN_SECTIONS = [
  { key: 'ante_natal', label: 'ANTE NATAL', color: 'orange' },
  { key: 'delivery_care', label: 'DELIVERY CARE', color: 'brown' },
  { key: 'post_natal', label: 'POST NATAL CARE', color: 'grey' },
  { key: 'immunization', label: 'IMMUNIZATION', color: 'grey' },
  { key: 'family_planning', label: 'FAMILY PLANNING', color: 'grey' },
  { key: 'communicable_diseases', label: 'COMMUNICABLE DISEASES', color: 'coral' },
  { key: 'finance', label: 'FINANCE', color: 'grey' },
  { key: 'data_quality', label: 'DATA QUALITY', color: 'brown' },
];

function formatDisplayValue(value, unit) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  if (unit === 'percent') return `${Number(n.toFixed(2))}%`;
  if (unit === 'amount' || unit === 'rupees') return `Rs.${Number(n.toFixed(2))}`;
  if (unit === 'ratio' || unit === 'rate') return `${Number(n.toFixed(2))}`;
  return `${Number(n.toFixed(2))}`;
}

function mapAccordionIndicator(r) {
  const value = num(r.value);
  return {
    indicator_id: Number(r.indicator_id),
    sno: r.sno,
    code: r.code,
    name: r.name,
    domain: r.domain || null,
    indicator_type: r.indicator_type || null,
    unit: r.unit,
    is_negative: r.is_negative,
    value,
    display_value: formatDisplayValue(value, r.unit),
    numerator: num(r.numerator),
    denominator: num(r.denominator),
    formula_text: r.formula_text,
    info: r.formula_text || null,
  };
}

/**
 * BY TYPE — screenshot accordion (COVERAGE / QUALITY / DATA QUALITY)
 * Always returns all 3 sections (empty ones still listed with +)
 * Optional filters.section = coverage|quality|data_quality to expand one
 */
async function getByType(filters = {}) {
  const a = pickArgs(filters);
  const sectionFilter = filters.section || filters.type || null;

  const { rows } = await query(
    `SELECT * FROM fn_dashboard_by_type($1, $2, $3, $4, $5)`,
    [a.geo_level, a.division_id, a.district_id, a.block_id, a.period]
  );

  const byKey = new Map();
  let composite = null;

  for (const r of rows) {
    composite = num(r.overall_composite_score);
    const key = r.indicator_type || 'other';
    if (!byKey.has(key)) byKey.set(key, { group_score: num(r.group_score), indicators: [] });
    byKey.get(key).indicators.push(mapAccordionIndicator(r));
  }

  // if no rows, still get composite via fn
  if (composite === null) {
    const { rows: s } = await query(
      `SELECT fn_composite_score($1,$2,$3,$4,$5) AS score`,
      [a.geo_level, a.division_id, a.district_id, a.block_id, a.period]
    );
    composite = num(s[0]?.score);
  }

  let sections = TYPE_SECTIONS.map((def, idx) => {
    const found = byKey.get(def.key) || { group_score: null, indicators: [] };
    const expanded = sectionFilter ? sectionFilter === def.key : idx === 0;
    return {
      key: def.key,
      label: def.label,
      color: def.color,
      expandable: true,
      expanded,
      count: found.indicators.length,
      group_score: found.group_score,
      // accordion: when collapsed UI can hide indicators; API still sends list
      indicators: sectionFilter && sectionFilter !== def.key ? [] : found.indicators,
      has_data: found.indicators.length > 0,
    };
  });

  // if client asked one section only, return just that section fully loaded
  if (sectionFilter) {
    sections = sections
      .filter((s) => s.key === sectionFilter)
      .map((s) => {
        const found = byKey.get(s.key) || { group_score: null, indicators: [] };
        return { ...s, expanded: true, indicators: found.indicators, count: found.indicators.length };
      });
  }

  return {
    view: 'by_type',
    tab: 'BY TYPE',
    source: 'pgsql:fn_dashboard_by_type',
    period: a.period,
    geo_level: a.geo_level,
    filters: {
      division_id: a.division_id,
      district_id: a.district_id,
      block_id: a.block_id,
      section: sectionFilter,
    },
    overall_composite_score: composite,
    overall_composite_label: 'OVERALL COMPOSITE SCORE',
    sections,
  };
}

/**
 * BY DOMAIN — screenshot accordion (ANTE NATAL … DATA QUALITY)
 * Always returns all 8 domain bars; optional filters.section to expand one
 */
async function getByDomain(filters = {}) {
  const a = pickArgs(filters);
  const sectionFilter = filters.section || filters.domain || null;

  const { rows } = await query(
    `SELECT * FROM fn_dashboard_by_domain($1, $2, $3, $4, $5)`,
    [a.geo_level, a.division_id, a.district_id, a.block_id, a.period]
  );

  const byKey = new Map();
  let composite = null;

  for (const r of rows) {
    composite = num(r.overall_composite_score);
    const key = r.domain || 'other';
    if (!byKey.has(key)) byKey.set(key, { group_score: num(r.group_score), indicators: [] });
    byKey.get(key).indicators.push(mapAccordionIndicator({ ...r, domain: r.domain }));
  }

  if (composite === null) {
    const { rows: s } = await query(
      `SELECT fn_composite_score($1,$2,$3,$4,$5) AS score`,
      [a.geo_level, a.division_id, a.district_id, a.block_id, a.period]
    );
    composite = num(s[0]?.score);
  }

  let sections = DOMAIN_SECTIONS.map((def) => {
    const found = byKey.get(def.key) || { group_score: null, indicators: [] };
    const expanded = sectionFilter ? sectionFilter === def.key : false;
    return {
      key: def.key,
      label: def.label,
      color: def.color,
      expandable: true,
      expanded,
      count: found.indicators.length,
      group_score: found.group_score,
      // screenshot shows domains collapsed by default; still include indicators for app
      indicators: sectionFilter && sectionFilter !== def.key ? [] : found.indicators,
      has_data: found.indicators.length > 0,
    };
  });

  if (sectionFilter) {
    sections = sections
      .filter((s) => s.key === sectionFilter)
      .map((s) => {
        const found = byKey.get(s.key) || { group_score: null, indicators: [] };
        return { ...s, expanded: true, indicators: found.indicators, count: found.indicators.length };
      });
  }

  return {
    view: 'by_domain',
    tab: 'BY DOMAIN',
    source: 'pgsql:fn_dashboard_by_domain',
    period: a.period,
    geo_level: a.geo_level,
    filters: {
      division_id: a.division_id,
      district_id: a.district_id,
      block_id: a.block_id,
      section: sectionFilter,
    },
    overall_composite_score: composite,
    overall_composite_label: 'OVERALL COMPOSITE SCORE',
    sections,
  };
}

/**
 * PERFORMANCE — uses fn_district_performance
 */
async function getPerformance(filters = {}) {
  const a = pickArgs(filters);
  const { rows } = await query(
    `SELECT * FROM fn_district_performance($1, $2)`,
    [a.period, a.band_size]
  );

  const bands = {
    top: { label: `Top ${a.band_size} Districts`, color: 'green', count: 0, districts: [] },
    moderate: { label: `Moderate ${a.band_size} Districts`, color: 'orange', count: 0, districts: [] },
    bottom: { label: `Bottom ${a.band_size} Districts`, color: 'red', count: 0, districts: [] },
  };

  let totalRanked = 0;

  for (const r of rows) {
    totalRanked = Number(r.total_ranked) || totalRanked;
    const bandKey = r.band;
    if (!bands[bandKey]) continue;
    bands[bandKey].label = r.band_label;
    bands[bandKey].color = r.band_color;
    bands[bandKey].districts.push({
      district_id: Number(r.district_id),
      district_name: r.district_name,
      lgd_code: r.lgd_code,
      division_id: Number(r.division_id),
      division_name: r.division_name,
      indicator_count: Number(r.indicator_count),
      composite_score: num(r.composite_score),
      rank: Number(r.rank),
    });
  }

  bands.top.count = bands.top.districts.length;
  bands.moderate.count = bands.moderate.districts.length;
  bands.bottom.count = bands.bottom.districts.length;

  let districtScore = null;
  if (a.district_id) {
    const all = [...bands.top.districts, ...bands.moderate.districts, ...bands.bottom.districts];
    districtScore = all.find((d) => d.district_id === a.district_id)?.composite_score ?? null;
  }

  return {
    view: 'by_performance',
    source: 'pgsql:fn_district_performance',
    period: a.period,
    band_size: a.band_size,
    total_districts_ranked: totalRanked,
    overall_composite_score: districtScore,
    bands,
  };
}

/**
 * Overview — composite via fn_composite_score + counts via by-indicators
 */
async function getOverview(filters = {}) {
  const a = pickArgs(filters);
  const byInd = await getByIndicators(filters);
  const performance = await getPerformance({ period: a.period, band_size: a.band_size });

  const { rows: scoreRows } = await query(
    `SELECT fn_composite_score($1, $2, $3, $4, $5) AS score`,
    [a.geo_level, a.division_id, a.district_id, a.block_id, a.period]
  );

  return {
    view: 'overview',
    source: 'pgsql:fn_composite_score+fn_dashboard_by_indicators+fn_district_performance',
    period: a.period,
    geo_level: a.geo_level,
    filters: {
      division_id: a.division_id,
      district_id: a.district_id,
      block_id: a.block_id,
    },
    overall_composite_score: num(scoreRows[0]?.score) ?? byInd.overall_composite_score,
    indicator_count: byInd.count,
    performance_summary: {
      top_count: performance.bands.top.count,
      moderate_count: performance.bands.moderate.count,
      bottom_count: performance.bands.bottom.count,
      total_ranked: performance.total_districts_ranked,
    },
  };
}

async function resolvePeriodId(periodLabel) {
  const { rows } = await query(
    `SELECT id, label, start_date, end_date FROM time_period WHERE label = $1 LIMIT 1`,
    [periodLabel || '2026-05']
  );
  return rows[0] || null;
}

module.exports = {
  getByIndicators,
  getByType,
  getByDomain,
  getPerformance,
  getOverview,
  resolvePeriodId,
};
