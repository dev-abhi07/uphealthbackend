/**
 * Shared read helpers over indicator_outcome_* tables.
 * Division metrics are rolled up from district rows (AVG + re-rank).
 */
const { query } = require('../db/pool');
const { parsePeriodInput, displayMonth } = require('./outcomeConfig');
const store = require('./outcomeDistrictStore');

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function periodFromParts(year, month) {
  return {
    year: Number(year),
    month: Number(month),
    period_label: `${year}-${String(month).padStart(2, '0')}`,
    period_display: displayMonth(Number(month), Number(year)),
  };
}

async function listOutcomePeriodLabels() {
  const periods = await store.listOutcomePeriods();
  return periods.map((p) => p.period_label).sort();
}

async function resolveOutcomePeriod(period) {
  if (period) {
    const p = parsePeriodInput({ period });
    if (!p) return null;
    const has = await store.hasDistrictOutcomePeriod(p.year, p.month);
    if (!has) return null;
    return { ...p, label: p.period_label, display: p.period_display };
  }
  const periods = await store.listOutcomePeriods();
  if (!periods.length) return null;
  const latest = periods[0];
  const p = periodFromParts(latest.year, latest.month);
  return { ...p, label: p.period_label, display: p.period_display };
}

/**
 * Division composite rollup for one month.
 * score = AVG(index_outcome); rank recomputed DESC.
 */
async function getDivisionCompositeRows({ year, month, divisionId } = {}) {
  const params = [year, month];
  let sql = `
    SELECT div.id AS division_id,
           div.code AS division_code,
           div.name AS division_name,
           ROUND(AVG(o.index_outcome)::numeric, 8) AS index_outcome,
           COUNT(*)::int AS district_count
    FROM indicator_outcome_district o
    JOIN district d ON d.lgd_code::text = o.district_lgd::text
    JOIN division div ON div.id = d.division_id
    WHERE o.year = $1 AND o.month = $2
      AND o.index_outcome IS NOT NULL
  `;
  if (divisionId != null) {
    params.push(Number(divisionId));
    sql += ` AND div.id = $${params.length}`;
  }
  sql += `
    GROUP BY div.id, div.code, div.name
    ORDER BY AVG(o.index_outcome) DESC NULLS LAST, div.name
  `;
  const { rows } = await query(sql, params);
  return rows.map((r, idx) => ({
    ...r,
    index_outcome: num(r.index_outcome),
    rank_outcome: idx + 1,
  }));
}

/**
 * Division-level average for one indicator (IND###).
 */
async function getDivisionIndicatorRows({ year, month, indicatorCode, divisionId } = {}) {
  const params = [year, month, String(indicatorCode).toUpperCase()];
  let sql = `
    SELECT div.id AS division_id,
           div.code AS division_code,
           div.name AS division_name,
           ROUND(AVG(v.value)::numeric, 8) AS value,
           COUNT(*)::int AS district_count
    FROM indicator_outcome_district_value v
    JOIN district d ON d.lgd_code::text = v.district_lgd::text
    JOIN division div ON div.id = d.division_id
    WHERE v.year = $1 AND v.month = $2
      AND v.indicator_code = $3
      AND v.value IS NOT NULL
  `;
  if (divisionId != null) {
    params.push(Number(divisionId));
    sql += ` AND div.id = $${params.length}`;
  }
  sql += `
    GROUP BY div.id, div.code, div.name
    ORDER BY AVG(v.value) DESC NULLS LAST, div.name
  `;
  const { rows } = await query(sql, params);
  return rows.map((r) => ({
    ...r,
    value: num(r.value),
  }));
}

async function listBlockOutcomePeriodLabels() {
  const { rows } = await query(
    `
    SELECT DISTINCT period_label
    FROM indicator_outcome_block
    ORDER BY period_label
    `
  );
  return rows.map((r) => r.period_label);
}

/**
 * Composite scores shaped like legacy ranking_value rows for analytics/executive.
 * geoLevel: 'division' | 'district' | 'block'
 */
async function loadCompositeByPeriod(geoLevel, periodLabels) {
  if (!periodLabels || !periodLabels.length) return [];
  const level =
    geoLevel === 'division' ? 'division' : geoLevel === 'block' ? 'block' : 'district';

  if (level === 'block') {
    const { rows } = await query(
      `
      SELECT o.period_label AS period,
             COALESCE(b.name, o.block_name) AS name,
             o.index_outcome::float AS value,
             o.rank_outcome AS rank,
             o.block_lgd,
             o.district_lgd,
             COALESCE(d.name, o.district_name) AS district_name
      FROM indicator_outcome_block o
      LEFT JOIN block b ON b.lgd_code::text = o.block_lgd::text
      LEFT JOIN district d ON d.lgd_code::text = o.district_lgd::text
      WHERE o.period_label = ANY($1::text[])
        AND o.index_outcome IS NOT NULL
      ORDER BY o.period_label, o.rank_outcome NULLS LAST
      `,
      [periodLabels]
    );
    return rows.map((r) => ({
      period: r.period,
      name: r.name,
      value: num(r.value),
      rank: r.rank != null ? Number(r.rank) : null,
      block_lgd: r.block_lgd != null ? Number(r.block_lgd) : null,
      district_lgd: r.district_lgd != null ? Number(r.district_lgd) : null,
      district_name: r.district_name || null,
    }));
  }

  if (level === 'district') {
    const { rows } = await query(
      `
      SELECT o.period_label AS period,
             COALESCE(d.name, o.district_name) AS name,
             o.index_outcome::float AS value,
             o.rank_outcome AS rank,
             o.district_lgd
      FROM indicator_outcome_district o
      LEFT JOIN district d ON d.lgd_code::text = o.district_lgd::text
      WHERE o.period_label = ANY($1::text[])
        AND o.index_outcome IS NOT NULL
      ORDER BY o.period_label, o.rank_outcome NULLS LAST
      `,
      [periodLabels]
    );
    return rows.map((r) => ({
      period: r.period,
      name: r.name,
      value: num(r.value),
      rank: r.rank != null ? Number(r.rank) : null,
      district_lgd: r.district_lgd != null ? Number(r.district_lgd) : null,
    }));
  }

  const { rows } = await query(
    `
    SELECT o.period_label AS period,
           div.name AS name,
           ROUND(AVG(o.index_outcome)::numeric, 8)::float AS value,
           div.id AS division_id,
           div.code AS division_code
    FROM indicator_outcome_district o
    JOIN district d ON d.lgd_code::text = o.district_lgd::text
    JOIN division div ON div.id = d.division_id
    WHERE o.period_label = ANY($1::text[])
      AND o.index_outcome IS NOT NULL
    GROUP BY o.period_label, div.id, div.name, div.code
    ORDER BY o.period_label, AVG(o.index_outcome) DESC NULLS LAST
    `,
    [periodLabels]
  );

  // Re-rank within each period
  const byPeriod = new Map();
  for (const r of rows) {
    if (!byPeriod.has(r.period)) byPeriod.set(r.period, []);
    byPeriod.get(r.period).push(r);
  }
  const out = [];
  for (const [period, list] of byPeriod) {
    list.forEach((r, idx) => {
      out.push({
        period,
        name: r.name,
        value: num(r.value),
        rank: idx + 1,
        division_id: r.division_id != null ? Number(r.division_id) : null,
        division_code: r.division_code || null,
      });
    });
  }
  return out;
}

/**
 * Per-area indicator values across periods (district, division rollup, or block).
 */
async function loadIndicatorByPeriod({
  geoLevel,
  indicatorCode,
  periodLabels,
  isNegative = false,
} = {}) {
  if (!periodLabels || !periodLabels.length || !indicatorCode) return [];
  const code = String(indicatorCode).toUpperCase();
  const level =
    geoLevel === 'division' ? 'division' : geoLevel === 'block' ? 'block' : 'district';

  if (level === 'block') {
    const { rows } = await query(
      `
      SELECT v.period_label AS period,
             COALESCE(b.name, o.block_name) AS name,
             v.value::float AS value,
             v.block_lgd,
             v.district_lgd,
             COALESCE(d.name, o.district_name) AS district_name
      FROM indicator_outcome_block_value v
      JOIN indicator_outcome_block o
        ON o.year = v.year AND o.month = v.month AND o.block_lgd = v.block_lgd
      LEFT JOIN block b ON b.lgd_code::text = v.block_lgd::text
      LEFT JOIN district d ON d.lgd_code::text = v.district_lgd::text
      WHERE v.period_label = ANY($1::text[])
        AND v.indicator_code = $2
        AND v.value IS NOT NULL
      `,
      [periodLabels, code]
    );
    const byPeriod = new Map();
    for (const r of rows) {
      if (!byPeriod.has(r.period)) byPeriod.set(r.period, []);
      byPeriod.get(r.period).push(r);
    }
    const out = [];
    for (const [period, list] of byPeriod) {
      list.sort((a, b) => (isNegative ? a.value - b.value : b.value - a.value));
      list.forEach((r, idx) => {
        out.push({
          period,
          name: r.name,
          value: num(r.value),
          rank: idx + 1,
          block_lgd: r.block_lgd != null ? Number(r.block_lgd) : null,
          district_lgd: r.district_lgd != null ? Number(r.district_lgd) : null,
          district_name: r.district_name || null,
        });
      });
    }
    return out;
  }

  if (level === 'district') {
    const { rows } = await query(
      `
      SELECT v.period_label AS period,
             COALESCE(d.name, o.district_name) AS name,
             v.value::float AS value,
             v.district_lgd
      FROM indicator_outcome_district_value v
      JOIN indicator_outcome_district o
        ON o.year = v.year AND o.month = v.month AND o.district_lgd = v.district_lgd
      LEFT JOIN district d ON d.lgd_code::text = v.district_lgd::text
      WHERE v.period_label = ANY($1::text[])
        AND v.indicator_code = $2
        AND v.value IS NOT NULL
      `,
      [periodLabels, code]
    );
    const byPeriod = new Map();
    for (const r of rows) {
      if (!byPeriod.has(r.period)) byPeriod.set(r.period, []);
      byPeriod.get(r.period).push(r);
    }
    const out = [];
    for (const [period, list] of byPeriod) {
      list.sort((a, b) => (isNegative ? a.value - b.value : b.value - a.value));
      list.forEach((r, idx) => {
        out.push({
          period,
          name: r.name,
          value: num(r.value),
          rank: idx + 1,
          district_lgd: r.district_lgd != null ? Number(r.district_lgd) : null,
        });
      });
    }
    return out;
  }

  const { rows } = await query(
    `
    SELECT v.period_label AS period,
           div.name AS name,
           ROUND(AVG(v.value)::numeric, 8)::float AS value,
           div.id AS division_id
    FROM indicator_outcome_district_value v
    JOIN district d ON d.lgd_code::text = v.district_lgd::text
    JOIN division div ON div.id = d.division_id
    WHERE v.period_label = ANY($1::text[])
      AND v.indicator_code = $2
      AND v.value IS NOT NULL
    GROUP BY v.period_label, div.id, div.name
    `,
    [periodLabels, code]
  );
  const byPeriod = new Map();
  for (const r of rows) {
    if (!byPeriod.has(r.period)) byPeriod.set(r.period, []);
    byPeriod.get(r.period).push(r);
  }
  const out = [];
  for (const [period, list] of byPeriod) {
    list.sort((a, b) => (isNegative ? a.value - b.value : b.value - a.value));
    list.forEach((r, idx) => {
      out.push({
        period,
        name: r.name,
        value: num(r.value),
        rank: idx + 1,
        division_id: r.division_id != null ? Number(r.division_id) : null,
      });
    });
  }
  return out;
}

async function loadStatewideIndicatorAvgs(periodLabel) {
  const { rows } = await query(
    `
    SELECT i.code, i.short_name, i.name, i.unit, i.sno, i.is_negative,
           AVG(v.value::float) AS avg_val
    FROM indicator_outcome_district_value v
    JOIN indicator i ON i.code = v.indicator_code AND i.is_active = TRUE
    WHERE v.period_label = $1
      AND v.value IS NOT NULL
      AND i.code ~ '^IND\\d{3}$'
    GROUP BY i.id
    HAVING COUNT(v.id) > 0
    ORDER BY i.sno NULLS LAST, i.code
    `,
    [periodLabel]
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.short_name || r.name,
    full_name: r.name,
    unit: r.unit,
    value: num(r.avg_val) != null ? Number(Number(r.avg_val).toFixed(2)) : null,
    lower_is_better: !!r.is_negative,
    is_negative: !!r.is_negative,
  }));
}

/**
 * Resolve master indicator for outcome APIs (IND### or mapped RANK_*).
 */
async function resolveMasterIndicator(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c || c === 'RANK_COMPOSITE' || c === 'COMPOSITE' || c === 'INDEX_OUTCOME') {
    return {
      code: 'RANK_COMPOSITE',
      name: 'Overall composite score',
      short_name: 'Overall composite score',
      unit: 'index',
      is_composite: true,
      is_negative: false,
      domain: null,
      domain_label: null,
      indicator_type: null,
      numerator_text: null,
      denominator_text: null,
      data_source_text: null,
      formula_text: null,
      weight: null,
      sno: 0,
      id: null,
    };
  }
  const { rows } = await query(
    `
    SELECT i.id, i.sno, i.code, i.name, i.short_name, i.unit, i.domain, i.domain_label,
           i.indicator_type, i.numerator_text, i.denominator_text, i.data_source_text,
           i.formula_text, i.is_negative, i.weight
    FROM indicator i
    WHERE upper(i.code) = $1 AND i.is_active = TRUE
    LIMIT 1
    `,
    [c]
  );
  if (rows[0]) return { ...rows[0], is_composite: false };

  const { rows: mapped } = await query(
    `
    SELECT i.id, i.sno, i.code, i.name, i.short_name, i.unit, i.domain, i.domain_label,
           i.indicator_type, i.numerator_text, i.denominator_text, i.data_source_text,
           i.formula_text, i.is_negative, i.weight
    FROM ranking_indicator ri
    JOIN indicator i ON i.id = ri.master_indicator_id
    WHERE upper(ri.code) = $1 AND i.is_active = TRUE
    LIMIT 1
    `,
    [c]
  );
  return mapped[0] ? { ...mapped[0], is_composite: false } : null;
}

module.exports = {
  num,
  listOutcomePeriodLabels,
  listBlockOutcomePeriodLabels,
  resolveOutcomePeriod,
  getDivisionCompositeRows,
  getDivisionIndicatorRows,
  loadCompositeByPeriod,
  loadIndicatorByPeriod,
  loadStatewideIndicatorAvgs,
  resolveMasterIndicator,
};
