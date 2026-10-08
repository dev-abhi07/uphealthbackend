/**
 * HMIS-style dashboard APIs — reads ONLY indicator_outcome_* tables.
 * Division metrics are rolled up from district rows.
 * Legacy kpi_value / fn_dashboard_* are not used.
 */
const { query } = require('../db/pool');
const { parsePeriodInput } = require('../outcome/outcomeConfig');
const store = require('../outcome/outcomeDistrictStore');
const {
  resolveOutcomePeriod,
  getDivisionCompositeRows,
  resolveMasterIndicator,
  num,
} = require('../outcome/outcomeRankingQueries');
const { resolveExcelDomainKey } = require('../ranking/rankingRegistry');

function pickArgs(filters = {}) {
  return {
    geo_level: filters.geo_level || 'district',
    division_id: filters.division_id ? Number(filters.division_id) : null,
    district_id: filters.district_id ? Number(filters.district_id) : null,
    block_id: filters.block_id ? Number(filters.block_id) : null,
    period: filters.period || null,
    band_size: Number(filters.band_size) > 0 ? Number(filters.band_size) : 25,
    section: filters.section || filters.type || filters.domain || null,
  };
}

async function resolveDistrictLgd(districtId) {
  if (districtId == null) return null;
  const { rows } = await query(
    `SELECT lgd_code FROM district WHERE id = $1 LIMIT 1`,
    [Number(districtId)]
  );
  return rows[0] ? Number(rows[0].lgd_code) : null;
}

async function resolveScope(filters) {
  const a = pickArgs(filters);
  const periodRow = await resolveOutcomePeriod(a.period);
  if (!periodRow) {
    return { a, periodRow: null, districtLgd: null };
  }
  const districtLgd = await resolveDistrictLgd(a.district_id);
  return { a, periodRow, districtLgd };
}

/**
 * Indicators: keep decimals when |value| < 10; whole number at 10+.
 * e.g. 9.45 → "9.45", 45.67 → "46", 0.51 → "0.51"
 */
function formatDisplayNumber(n) {
  if (Math.abs(n) < 10) return Number(n.toFixed(2)).toString();
  return String(Math.round(n));
}

function formatDisplayValue(value, unit) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  const formatted = formatDisplayNumber(n);
  if (unit === 'percent') return `${formatted}%`;
  if (unit === 'amount' || unit === 'rupees') return `Rs.${formatted}`;
  if (unit === 'index') return Math.abs(n) < 10 ? Number(n.toFixed(4)) : Math.round(n);
  if (unit === 'ratio' || unit === 'rate') return formatted;
  return formatted;
}

async function loadIndicatorValuesForScope({ year, month, divisionId, districtLgd }) {
  const avgs = await store.getIndicatorAverages({
    year,
    month,
    divisionId: districtLgd != null ? null : divisionId,
    districtLgd,
  });
  const avgMap = new Map(avgs.map((r) => [r.indicator_code, num(r.avg_value)]));

  const { rows: master } = await query(
    `
    SELECT id, sno, code, name, short_name, unit, domain, domain_label, indicator_type,
           is_negative, weight, formula_text, numerator_text, denominator_text
    FROM indicator
    WHERE is_active = TRUE AND code ~ '^IND\\d{3}$'
    ORDER BY sno NULLS LAST, code
    `
  );

  return master.map((i) => {
    const value = avgMap.has(i.code) ? avgMap.get(i.code) : null;
    const excel = resolveExcelDomainKey(i.domain_label, i.domain);
    return {
      indicator_id: Number(i.id),
      sno: i.sno,
      code: i.code,
      name: i.short_name || i.name,
      full_name: i.name,
      domain: excel.key,
      domain_label: excel.label,
      domain_slug: i.domain || null,
      indicator_type: i.indicator_type,
      unit: i.unit,
      is_negative: !!i.is_negative,
      weight: num(i.weight),
      formula_text: i.formula_text,
      numerator: null,
      denominator: null,
      value,
      display_value: formatDisplayValue(value, i.unit),
      period_label: `${year}-${String(month).padStart(2, '0')}`,
    };
  });
}

async function overallCompositeForScope({ year, month, divisionId, districtLgd }) {
  const row = await store.getCompositeAverage({ year, month, divisionId, districtLgd });
  return num(row.avg_value);
}

/** Screenshot TYPE accordion order */
const TYPE_SECTIONS = [
  { key: 'coverage', label: 'COVERAGE', color: 'orange' },
  { key: 'quality', label: 'QUALITY', color: 'red' },
  { key: 'data_quality', label: 'DATA QUALITY', color: 'brown' },
];

/** Screenshot DOMAIN accordion — Excel Domain column (Ind_definition). */
const DOMAIN_SECTIONS = [
  { key: 'maternal_health', label: 'Maternal Health', color: 'orange' },
  { key: 'community_outreach', label: 'Community outreach', color: 'brown' },
  { key: 'health_system_strengthening', label: 'Health system strengthening', color: 'grey' },
  { key: 'child_health', label: 'Child Health', color: 'grey' },
  { key: 'immunization', label: 'Immunization', color: 'grey' },
  { key: 'national_program', label: 'National Program', color: 'coral' },
  { key: 'ayushman_bharat_digital_mission', label: 'Ayushman Bharat Digital Mission', color: 'blue' },
];

function mapAccordionIndicator(r) {
  return {
    indicator_id: r.indicator_id,
    sno: r.sno,
    code: r.code,
    name: r.name,
    domain: r.domain || null,
    domain_label: r.domain_label || null,
    indicator_type: r.indicator_type || null,
    unit: r.unit,
    is_negative: r.is_negative,
    value: r.value,
    display_value: r.display_value,
    numerator: r.numerator,
    denominator: r.denominator,
    formula_text: r.formula_text,
    info: r.formula_text || null,
  };
}

function groupScore(indicators) {
  const vals = indicators.map((i) => i.value).filter((v) => v != null);
  if (!vals.length) return null;
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4));
}

async function getByIndicators(filters = {}) {
  const { a, periodRow, districtLgd } = await resolveScope(filters);
  if (!periodRow) {
    return {
      view: 'by_indicators',
      source: 'indicator_outcome',
      has_data: false,
      message: 'No outcome data for this period',
      period: a.period,
      geo_level: a.geo_level,
      overall_composite_score: null,
      count: 0,
      indicators: [],
    };
  }

  if (a.geo_level === 'block' || a.block_id) {
    return {
      view: 'by_indicators',
      source: 'indicator_outcome',
      has_data: false,
      message: 'Block-level outcome data is not available',
      period: periodRow.label,
      geo_level: 'block',
      overall_composite_score: null,
      count: 0,
      indicators: [],
    };
  }

  const indicators = await loadIndicatorValuesForScope({
    year: periodRow.year,
    month: periodRow.month,
    divisionId: a.division_id,
    districtLgd,
  });
  const composite = await overallCompositeForScope({
    year: periodRow.year,
    month: periodRow.month,
    divisionId: a.division_id,
    districtLgd,
  });

  return {
    view: 'by_indicators',
    source: 'indicator_outcome',
    has_data: indicators.some((i) => i.value != null),
    period: periodRow.label,
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

async function getByType(filters = {}) {
  const byInd = await getByIndicators(filters);
  const sectionFilter = filters.section || filters.type || null;
  const byKey = new Map();
  for (const ind of byInd.indicators || []) {
    const key = ind.indicator_type || 'other';
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(ind);
  }

  let sections = TYPE_SECTIONS.map((def, idx) => {
    const list = byKey.get(def.key) || [];
    const expanded = sectionFilter ? sectionFilter === def.key : idx === 0;
    return {
      key: def.key,
      label: def.label,
      color: def.color,
      expandable: true,
      expanded,
      count: list.length,
      group_score: groupScore(list),
      indicators:
        sectionFilter && sectionFilter !== def.key
          ? []
          : list.map(mapAccordionIndicator),
      has_data: list.length > 0,
    };
  });

  if (sectionFilter) {
    sections = sections
      .filter((s) => s.key === sectionFilter)
      .map((s) => {
        const list = byKey.get(s.key) || [];
        return {
          ...s,
          expanded: true,
          indicators: list.map(mapAccordionIndicator),
          count: list.length,
        };
      });
  }

  return {
    view: 'by_type',
    tab: 'BY TYPE',
    source: 'indicator_outcome',
    has_data: byInd.has_data,
    period: byInd.period,
    geo_level: byInd.geo_level,
    filters: {
      division_id: byInd.filters?.division_id ?? null,
      district_id: byInd.filters?.district_id ?? null,
      block_id: byInd.filters?.block_id ?? null,
      section: sectionFilter,
    },
    overall_composite_score: byInd.overall_composite_score,
    overall_composite_label: 'OVERALL COMPOSITE SCORE',
    sections,
  };
}

async function getByDomain(filters = {}) {
  const byInd = await getByIndicators(filters);
  const sectionFilter = filters.section || filters.domain || null;
  const byKey = new Map();
  for (const ind of byInd.indicators || []) {
    const key = ind.domain || 'other';
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(ind);
  }

  let sections = DOMAIN_SECTIONS.map((def) => {
    const list = byKey.get(def.key) || [];
    const expanded = sectionFilter ? sectionFilter === def.key : false;
    return {
      key: def.key,
      label: def.label,
      color: def.color,
      expandable: true,
      expanded,
      count: list.length,
      group_score: groupScore(list),
      indicators:
        sectionFilter && sectionFilter !== def.key
          ? []
          : list.map(mapAccordionIndicator),
      has_data: list.length > 0,
    };
  });

  if (sectionFilter) {
    sections = sections
      .filter((s) => s.key === sectionFilter)
      .map((s) => {
        const list = byKey.get(s.key) || [];
        return {
          ...s,
          expanded: true,
          indicators: list.map(mapAccordionIndicator),
          count: list.length,
        };
      });
  }

  return {
    view: 'by_domain',
    tab: 'BY DOMAIN',
    source: 'indicator_outcome',
    has_data: byInd.has_data,
    period: byInd.period,
    geo_level: byInd.geo_level,
    filters: {
      division_id: byInd.filters?.division_id ?? null,
      district_id: byInd.filters?.district_id ?? null,
      block_id: byInd.filters?.block_id ?? null,
      section: sectionFilter,
    },
    overall_composite_score: byInd.overall_composite_score,
    overall_composite_label: 'OVERALL COMPOSITE SCORE',
    sections,
  };
}

async function getPerformance(filters = {}) {
  const a = pickArgs(filters);
  const periodRow = await resolveOutcomePeriod(a.period);
  if (!periodRow) {
    return {
      view: 'by_performance',
      source: 'indicator_outcome',
      has_data: false,
      message: 'No outcome data for this period',
      period: a.period,
      band_size: a.band_size,
      total_districts_ranked: 0,
      overall_composite_score: null,
      bands: {
        top: { label: `Top ${a.band_size} Districts`, color: 'green', count: 0, districts: [] },
        moderate: { label: 'Moderate', color: 'orange', count: 0, districts: [] },
        bottom: { label: `Bottom ${a.band_size} Districts`, color: 'red', count: 0, districts: [] },
      },
    };
  }

  const headers = await store.getDistrictHeaders({
    year: periodRow.year,
    month: periodRow.month,
    divisionId: a.division_id,
  });

  const ranked = [...headers]
    .filter((h) => h.index_outcome != null)
    .sort((x, y) => {
      const rx = x.rank_outcome != null ? Number(x.rank_outcome) : 9999;
      const ry = y.rank_outcome != null ? Number(y.rank_outcome) : 9999;
      if (rx !== ry) return rx - ry;
      return Number(y.index_outcome) - Number(x.index_outcome);
    });

  const total = ranked.length;
  const topN = Math.min(a.band_size, Math.max(1, Math.ceil(total / 3)));
  const bands = {
    top: {
      label: `Top ${topN} Districts`,
      color: 'green',
      count: 0,
      districts: [],
    },
    moderate: {
      label: 'Moderate',
      color: 'orange',
      count: 0,
      districts: [],
    },
    bottom: {
      label: `Bottom ${topN} Districts`,
      color: 'red',
      count: 0,
      districts: [],
    },
  };

  ranked.forEach((h, idx) => {
    const rank = h.rank_outcome != null ? Number(h.rank_outcome) : idx + 1;
    let band = 'moderate';
    if (rank <= topN) band = 'top';
    else if (rank > total - topN) band = 'bottom';
    const row = {
      district_id: h.district_id != null ? Number(h.district_id) : null,
      district_name: h.district_name,
      lgd_code: h.district_lgd != null ? String(h.district_lgd) : null,
      division_id: h.division_id != null ? Number(h.division_id) : null,
      division_name: h.division_name || null,
      indicator_count: null,
      composite_score: num(h.index_outcome),
      rank,
    };
    bands[band].districts.push(row);
    bands[band].count += 1;
  });

  let districtScore = null;
  if (a.district_id) {
    const all = [...bands.top.districts, ...bands.moderate.districts, ...bands.bottom.districts];
    districtScore = all.find((d) => d.district_id === a.district_id)?.composite_score ?? null;
  }

  return {
    view: 'by_performance',
    source: 'indicator_outcome',
    has_data: total > 0,
    period: periodRow.label,
    band_size: topN,
    total_districts_ranked: total,
    overall_composite_score: districtScore,
    bands,
  };
}

async function getOverview(filters = {}) {
  const byInd = await getByIndicators(filters);
  const performance = await getPerformance(filters);

  return {
    view: 'overview',
    source: 'indicator_outcome',
    has_data: byInd.has_data,
    period: byInd.period,
    geo_level: byInd.geo_level,
    filters: byInd.filters,
    overall_composite_score: byInd.overall_composite_score,
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
  const p = parsePeriodInput({ period: periodLabel });
  if (!p) return null;
  const has = await store.hasDistrictOutcomePeriod(p.year, p.month);
  if (!has) return null;
  return {
    id: null,
    label: p.period_label,
    start_date: null,
    end_date: null,
  };
}

module.exports = {
  getByIndicators,
  getByType,
  getByDomain,
  getPerformance,
  getOverview,
  resolvePeriodId,
  // exported for tests / reuse
  resolveMasterIndicator,
  getDivisionCompositeRows,
};
