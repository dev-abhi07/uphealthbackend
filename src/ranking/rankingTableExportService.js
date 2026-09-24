/**
 * Table View Excel export — GET /api/health-ranking/table/export
 * Returns sheets matching frontend fetchTableExportWorkbook expectations.
 */
const { query } = require('../db/pool');
const {
  resolveUserGeoScope,
  filterRankingsByScope,
  namesMatch,
} = require('../services/geoScopeService');

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatExportMonth(period) {
  const match = String(period || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return String(period || '');
  const month = MONTH_SHORT[Number(match[2]) - 1] || match[2];
  return `${month} ${match[1]}`;
}

function isCompositeCode(code) {
  const c = String(code || '').trim().toUpperCase();
  return !c || c === 'RANK_COMPOSITE' || c === 'COMPOSITE' || c === '1';
}

function sanitizeSheetName(name, fallback = 'Sheet') {
  const cleaned = String(name || fallback)
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || fallback;
}

async function resolvePeriod(period) {
  const label = String(period || '').trim();
  if (label) {
    const { rows } = await query(
      `SELECT id, label FROM ranking_period WHERE label = $1 LIMIT 1`,
      [label]
    );
    if (rows[0]) return rows[0];
  }
  const { rows } = await query(
    `SELECT id, label FROM ranking_period ORDER BY label DESC LIMIT 1`
  );
  return rows[0] || null;
}

async function listExportIndicators(indicatorId, multi) {
  const wantMulti =
    multi === true ||
    multi === 1 ||
    multi === '1' ||
    multi === 'true' ||
    isCompositeCode(indicatorId);

  if (!wantMulti && indicatorId && !isCompositeCode(indicatorId)) {
    const { rows } = await query(
      `
      SELECT code, name, is_composite
      FROM ranking_indicator
      WHERE is_active = TRUE AND UPPER(code) = UPPER($1)
      LIMIT 1
      `,
      [String(indicatorId)]
    );
    if (rows[0]) {
      return [{ id: rows[0].code, name: rows[0].name || rows[0].code }];
    }
    return [{ id: String(indicatorId), name: String(indicatorId) }];
  }

  const { rows } = await query(
    `
    SELECT code, name, is_composite
    FROM ranking_indicator
    WHERE is_active = TRUE
    ORDER BY
      CASE WHEN code = 'RANK_COMPOSITE' THEN 0 ELSE 1 END,
      id ASC
    `
  );
  if (!rows.length) {
    return [{ id: 'RANK_COMPOSITE', name: 'Overall composite score' }];
  }
  return rows.map((r) => ({ id: r.code, name: r.name || r.code }));
}

async function loadValuesForIndicator({ periodId, geoLevel, indicatorCode }) {
  const { rows } = await query(
    `
    SELECT
      v.geo_name,
      v.district_name,
      v.value,
      v.rank
    FROM ranking_value v
    JOIN ranking_indicator i ON i.id = v.indicator_id
    WHERE v.period_id = $1
      AND v.geo_level = $2
      AND UPPER(i.code) = UPPER($3)
    ORDER BY
      CASE WHEN v.rank IS NULL THEN 1 ELSE 0 END,
      v.rank ASC NULLS LAST,
      v.geo_name ASC
    `,
    [periodId, geoLevel, indicatorCode]
  );
  return rows;
}

function buildDivisionSheet(rows, monthLabel) {
  const headers = ['division', 'composite_index', 'rank', 'month'];
  const sorted = [...rows].sort(
    (a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)
  );
  const out = sorted.map((r, i) => {
    const name = String(r.geo_name || '');
    return {
      division: /division$/i.test(name) ? name : `${name} Division`,
      composite_index: r.value != null ? Number(r.value) : null,
      rank: r.rank != null ? Number(r.rank) : i + 1,
      month: monthLabel,
    };
  });
  return { headers, rows: out };
}

function buildDistrictSheet(rows, monthLabel) {
  const headers = ['district', 'rank', 'month', 'composite_index'];
  const sorted = [...rows].sort(
    (a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)
  );
  const out = sorted.map((r, i) => ({
    district: r.geo_name,
    rank: r.rank != null ? Number(r.rank) : i + 1,
    month: monthLabel,
    composite_index: r.value != null ? Number(r.value) : null,
  }));
  return { headers, rows: out };
}

function buildBlockSheet(rows, monthLabel) {
  const headers = ['block', 'composite_index', 'rank', 'month', 'district'];
  const sorted = [...rows].sort(
    (a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)
  );
  const out = sorted.map((r, i) => ({
    block: r.geo_name,
    composite_index: r.value != null ? Number(r.value) : null,
    rank: r.rank != null ? Number(r.rank) : i + 1,
    month: monthLabel,
    district: r.district_name || '',
  }));
  return { headers, rows: out };
}

function applyScopeToValueRows(rows, scope, geoLevel) {
  if (!scope || scope.isStateAdmin || scope.unrestricted) return rows;
  const fakeRankings = (rows || []).map((r) => ({
    name: r.geo_name,
    area_name: r.geo_name,
    district_name: r.district_name,
    districtName: r.district_name,
  }));
  const filtered = filterRankingsByScope(fakeRankings, scope, geoLevel);
  const allowed = new Set(
    filtered.map((r) => String(r.name || r.area_name || '').toLowerCase())
  );
  return (rows || []).filter((r) =>
    allowed.has(String(r.geo_name || '').toLowerCase())
  );
}

/**
 * @param {object} opts
 * @param {string} opts.period
 * @param {string} opts.indicatorId
 * @param {string} opts.level division|district|block
 * @param {string|boolean|number} opts.multi
 * @param {object} [opts.user] JWT payload
 */
async function getTableExportWorkbook({
  period,
  indicatorId = 'RANK_COMPOSITE',
  level = 'district',
  multi = '0',
  user = null,
} = {}) {
  const geoLevel = ['division', 'district', 'block'].includes(
    String(level || '').toLowerCase()
  )
    ? String(level).toLowerCase()
    : 'district';

  const periodRow = await resolvePeriod(period);
  if (!periodRow) {
    const err = new Error('No ranking period found');
    err.status = 404;
    throw err;
  }

  const monthLabel = formatExportMonth(periodRow.label);
  const indicators = await listExportIndicators(indicatorId, multi);
  const scope = user ? await resolveUserGeoScope(user) : null;

  const sheets = [];
  for (const ind of indicators) {
    let rows = await loadValuesForIndicator({
      periodId: periodRow.id,
      geoLevel,
      indicatorCode: ind.id,
    });
    rows = applyScopeToValueRows(rows, scope, geoLevel);

    let payload;
    if (geoLevel === 'division') {
      payload = buildDivisionSheet(rows, monthLabel);
    } else if (geoLevel === 'block') {
      payload = buildBlockSheet(rows, monthLabel);
    } else {
      payload = buildDistrictSheet(rows, monthLabel);
    }

    sheets.push({
      name: sanitizeSheetName(ind.name, ind.id),
      headers: payload.headers,
      rows: payload.rows,
    });
  }

  return {
    period: periodRow.label,
    level: geoLevel,
    indicator_id: String(indicatorId || 'RANK_COMPOSITE'),
    multi: indicators.length > 1,
    sheet_count: sheets.length,
    sheets,
  };
}

module.exports = {
  getTableExportWorkbook,
  formatExportMonth,
  namesMatch,
};
