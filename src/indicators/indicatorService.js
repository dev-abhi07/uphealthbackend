/**
 * Master indicator catalog for APIs (IND001–IND037 + definition fields).
 */
const { query } = require('../db/pool');
const { mapIndicatorApiRow, normalizeIndicatorCode } = require('./indicatorCodes');

const SELECT_COLS = `
  i.id,
  i.sno,
  i.code,
  i.name,
  i.short_name,
  i.domain,
  i.domain_label,
  i.indicator_type,
  i.ranking_level,
  i.formula_text,
  i.unit,
  i.is_negative,
  i.numerator_text,
  i.denominator_text,
  i.data_source_text,
  i.period_type,
  i.is_active,
  s.code AS primary_source_code,
  s.name AS primary_source_name
`;

async function listMasterIndicators({ activeOnly = true } = {}) {
  const { rows } = await query(
    `
    SELECT ${SELECT_COLS}
    FROM indicator i
    LEFT JOIN source_system s ON s.id = i.primary_source_id
    WHERE ($1::boolean = FALSE OR i.is_active = TRUE)
    ORDER BY i.sno NULLS LAST, i.code
    `,
    [activeOnly]
  );
  return rows.map((r) => ({
    ...mapIndicatorApiRow(r),
    primary_source_code: r.primary_source_code || null,
    primary_source_name: r.primary_source_name || null,
  }));
}

async function getMasterIndicator(codeOrAlias) {
  const code = normalizeIndicatorCode(codeOrAlias);
  const { rows } = await query(
    `
    SELECT ${SELECT_COLS}
    FROM indicator i
    LEFT JOIN source_system s ON s.id = i.primary_source_id
    WHERE upper(i.code) = $1
    LIMIT 1
    `,
    [code]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    ...mapIndicatorApiRow(r),
    primary_source_code: r.primary_source_code || null,
    primary_source_name: r.primary_source_name || null,
  };
}

module.exports = {
  listMasterIndicators,
  getMasterIndicator,
};
