/**
 * Indicator code helpers — canonical codes are IND001–IND037.
 */

function normalizeIndicatorCode(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return null;
  const m = s.match(/^IND0*(\d{1,3})$/);
  if (m) return `IND${String(m[1]).padStart(3, '0')}`;
  return s;
}

function mapIndicatorApiRow(row) {
  if (!row) return null;
  return {
    id: row.id != null ? Number(row.id) : undefined,
    code: row.code,
    sno: row.sno != null ? Number(row.sno) : null,
    name: row.name,
    short_name: row.short_name || null,
    domain: row.domain,
    domain_label: row.domain_label || null,
    indicator_type: row.indicator_type || null,
    ranking_level: row.ranking_level || null,
    unit: row.unit,
    is_negative: !!row.is_negative,
    numerator: row.numerator_text || null,
    denominator: row.denominator_text || null,
    data_source: row.data_source_text || null,
    formula_text: row.formula_text || null,
    period_type: row.period_type || null,
    is_active: row.is_active !== false,
  };
}

module.exports = {
  normalizeIndicatorCode,
  mapIndicatorApiRow,
};
