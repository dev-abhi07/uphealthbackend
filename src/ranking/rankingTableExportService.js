/**
 * Table View Excel export — same indicators + values as the frontend Table View.
 * Sources:
 *   - indicator list: `indicator` (IND###) + RANK_COMPOSITE  (same as indicator_options)
 *   - values: outcome tables via loadCompositeByPeriod / loadIndicatorByPeriod
 * Columns/sheets match the legacy client export layout.
 */
const ExcelJS = require('exceljs');
const { query } = require('../db/pool');
const {
  resolveUserGeoScope,
  filterRankingsByScope,
  namesMatch,
} = require('../services/geoScopeService');
const {
  resolveOutcomePeriod,
  loadCompositeByPeriod,
  loadIndicatorByPeriod,
  resolveMasterIndicator,
} = require('../outcome/outcomeRankingQueries');
const {
  storeExportFile,
  takeExportFile,
  removeExportFile,
} = require('./rankingTableExportFileStore');

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
  return (
    !c ||
    c === 'RANK_COMPOSITE' ||
    c === 'COMPOSITE' ||
    c === '1' ||
    c === 'INDEX_OUTCOME'
  );
}

function sanitizeSheetName(name, fallback = 'Sheet') {
  const cleaned = String(name || fallback)
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || fallback;
}

/**
 * Same list the Table View dropdown uses (deep-dive indicator_options):
 * Overall composite + active IND### ordered by sno.
 * Includes ranking_level so block export can skip district-only indicators.
 */
async function listFrontendIndicators() {
  const { rows } = await query(
    `
    SELECT code, short_name, name, unit, is_negative, sno, ranking_level
    FROM indicator
    WHERE is_active = TRUE AND code ~ '^IND\\d{3}$'
    ORDER BY sno NULLS LAST, code
    `
  );
  return [
    {
      id: 'RANK_COMPOSITE',
      name: 'Overall composite score',
      unit: 'index',
      rankingLevel: 'both',
      isComposite: true,
      isNegative: false,
    },
    ...rows.map((r) => ({
      id: r.code,
      // Full name for Excel (do not use shortened short_name)
      name: r.name || r.short_name || r.code,
      unit: String(r.unit || '').trim().toLowerCase(),
      rankingLevel: String(r.ranking_level || 'district')
        .trim()
        .toLowerCase(),
      isComposite: false,
      isNegative: Boolean(r.is_negative),
    })),
  ];
}

/** Block-level export: only composite + indicators with ranking_level both/block/facility. */
function isIndicatorAvailableAtGeoLevel(indicator, geoLevel) {
  if (!indicator) return false;
  if (indicator.isComposite || isCompositeCode(indicator.id)) return true;
  const level = String(geoLevel || '')
    .trim()
    .toLowerCase();
  if (level !== 'block') return true;
  const rl = String(indicator.rankingLevel || '')
    .trim()
    .toLowerCase();
  return rl === 'both' || rl === 'block' || rl === 'facility';
}

/**
 * Resolve export sheet list to match what the UI would export.
 * - Composite / multi → full frontend indicator list (filtered by geo level)
 * - Single indicator → resolve IND### (or mapped RANK_* → master IND)
 * - Block export skips district-only indicators
 */
async function listExportIndicators(indicatorId, multi, geoLevel = 'district') {
  const wantMulti =
    multi === true ||
    multi === 1 ||
    multi === '1' ||
    multi === 'true' ||
    isCompositeCode(indicatorId);

  const all = await listFrontendIndicators();
  const forGeo = all.filter((ind) =>
    isIndicatorAvailableAtGeoLevel(ind, geoLevel)
  );

  if (wantMulti) return forGeo;

  const raw = String(indicatorId || '').trim();
  const hit = forGeo.find(
    (item) => String(item.id).toUpperCase() === raw.toUpperCase()
  );
  if (hit) return [hit];

  // Selected indicator exists but is not available at this geo level (e.g. district-only on block)
  const existsElsewhere = all.find(
    (item) => String(item.id).toUpperCase() === raw.toUpperCase()
  );
  if (existsElsewhere && String(geoLevel).toLowerCase() === 'block') {
    return [];
  }

  // Legacy RANK_* or alternate code → master indicator (same as deep-dive)
  const master = await resolveMasterIndicator(raw);
  if (master?.is_composite) {
    return [
      {
        id: 'RANK_COMPOSITE',
        name: 'Overall composite score',
        unit: 'index',
        rankingLevel: 'both',
        isComposite: true,
        isNegative: false,
      },
    ];
  }
  if (master?.code) {
    const mapped = {
      id: master.code,
      name: master.name || master.short_name || master.code,
      unit: String(master.unit || '').trim().toLowerCase(),
      rankingLevel: String(master.ranking_level || 'district')
        .trim()
        .toLowerCase(),
      isComposite: false,
      isNegative: Boolean(master.is_negative),
    };
    return isIndicatorAvailableAtGeoLevel(mapped, geoLevel) ? [mapped] : [];
  }

  const fallback = {
    id: raw || 'RANK_COMPOSITE',
    name: raw || 'Indicator',
    unit: '',
    rankingLevel: 'district',
    isComposite: isCompositeCode(raw),
    isNegative: false,
  };
  return isIndicatorAvailableAtGeoLevel(fallback, geoLevel) ? [fallback] : [];
}

function isPercentUnit(unit) {
  const u = String(unit || '')
    .trim()
    .toLowerCase();
  return u === 'percent' || u === '%' || u === 'pct' || u === 'percentage';
}

/**
 * Export scores with 4–5 digits after the decimal (not 2dp UI rounding).
 * For percent only: 0 and 100 → no decimal places.
 */
function formatExportScore(value, unit = '') {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;

  const n = Number(text);
  if (!Number.isFinite(n)) return null;

  const percent = isPercentUnit(unit);

  // Percent only: 0 and 100 → whole number (no .00000)
  if (percent) {
    if (n === 0) return '0';
    if (n === 100) return '100';
  }

  // Build from DB fractional part when present, clamp to 5dp, keep at least 4 when needed.
  const match = text.match(/^(-?\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (match && !match[3]) {
    const intPart = match[1];
    let frac = match[2] || '';
    if (frac.length > 5) frac = frac.slice(0, 5);
    // No real fraction → whole number (0/100 already handled above for percent)
    if (!frac || /^0+$/.test(frac)) return String(Number(intPart));
    if (frac.length < 4) frac = frac.padEnd(4, '0');
    return `${intPart}.${frac}`;
  }

  // Scientific / odd forms → fixed 5 decimals, trim only a trailing 5th zero
  const fixed5 = n.toFixed(5);
  if (fixed5.endsWith('0')) {
    return n.toFixed(4);
  }
  return fixed5;
}

/** @deprecated alias — scores go through formatExportScore */
function rawDbScore(value, unit = '') {
  return formatExportScore(value, unit);
}

function exportScoreKeyForIndicator(indicator) {
  if (
    indicator?.isComposite ||
    isCompositeCode(indicator?.id) ||
    /overall composite/i.test(String(indicator?.name || ''))
  ) {
    return 'composite_index';
  }
  return 'perc_point';
}

function formatDivisionExportName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  return /division$/i.test(raw) ? raw : `${raw} Division`;
}

function geoKeyForExportLevel(level) {
  if (level === 'division') return 'division';
  if (level === 'block') return 'block';
  return 'district';
}

function geoRankSheetName(level) {
  if (level === 'division') return 'Division Ranks';
  if (level === 'block') return 'Block Ranks';
  return 'District Ranks';
}

function scoreFromExportRow(row) {
  if (row?.perc_point != null && row.perc_point !== '') return row.perc_point;
  if (row?.composite_index != null && row.composite_index !== '') {
    return row.composite_index;
  }
  return null;
}

function formatGeoRankLabel(name, level, value) {
  const display = value != null && value !== '' ? String(value) : '—';
  const raw = String(name || '').trim();
  if (!raw) return `(${display})`;
  if (level === 'division') {
    const base = /division$/i.test(raw) ? raw : `${raw} Division`;
    return `${base}(${display})`;
  }
  return `${raw}(${display})`;
}

/**
 * Load values from the same outcome source as Table View (not legacy ranking_value).
 * Score text is re-read as ::text so Excel keeps full DB precision (no float/2dp).
 */
async function loadValuesForIndicator({ geoLevel, indicator, periodLabel }) {
  const code = String(indicator?.id || '').toUpperCase();
  const isComposite = Boolean(indicator?.isComposite) || isCompositeCode(code);
  const isNegative = Boolean(indicator?.isNegative);

  const rows = isComposite
    ? await loadCompositeByPeriod(geoLevel, [periodLabel])
    : await loadIndicatorByPeriod({
        geoLevel,
        indicatorCode: code,
        periodLabels: [periodLabel],
        isNegative,
      });

  const shaped = (rows || [])
    .filter((r) => String(r.period || '') === String(periodLabel))
    .map((r) => ({
      geo_name: r.name,
      district_name: r.district_name || (geoLevel === 'district' ? r.name : ''),
      value: r.value,
      value_text: null,
      rank: r.rank,
      district_lgd: r.district_lgd,
      block_lgd: r.block_lgd,
    }));

  // Overlay exact numeric text from DB (avoids ::float rounding in shared loaders).
  const textMap = await loadExactValueTextMap({
    geoLevel,
    periodLabel,
    indicatorCode: isComposite ? null : code,
    isComposite,
  });
  if (textMap.size) {
    for (const row of shaped) {
      const key = exactValueKey(geoLevel, row);
      if (textMap.has(key)) row.value_text = textMap.get(key);
    }
  }

  return shaped;
}

function exactValueKey(geoLevel, row) {
  if (geoLevel === 'block') {
    return `b:${row.block_lgd || ''}:${String(row.geo_name || '').toLowerCase()}`;
  }
  if (geoLevel === 'division') {
    return `div:${String(row.geo_name || '').toLowerCase()}`;
  }
  return `d:${row.district_lgd || ''}:${String(row.geo_name || '').toLowerCase()}`;
}

async function loadExactValueTextMap({
  geoLevel,
  periodLabel,
  indicatorCode,
  isComposite,
}) {
  const map = new Map();
  try {
    if (isComposite && geoLevel === 'district') {
      const { rows } = await query(
        `
        SELECT o.district_lgd,
               COALESCE(d.name, o.district_name) AS name,
               o.index_outcome::text AS value_text
        FROM indicator_outcome_district o
        LEFT JOIN district d ON d.lgd_code::text = o.district_lgd::text
        WHERE o.period_label = $1 AND o.index_outcome IS NOT NULL
        `,
        [periodLabel]
      );
      rows.forEach((r) => {
        map.set(
          `d:${r.district_lgd || ''}:${String(r.name || '').toLowerCase()}`,
          r.value_text
        );
      });
      return map;
    }

    if (isComposite && geoLevel === 'block') {
      const { rows } = await query(
        `
        SELECT o.block_lgd,
               COALESCE(b.name, o.block_name) AS name,
               o.index_outcome::text AS value_text
        FROM indicator_outcome_block o
        LEFT JOIN block b ON b.lgd_code::text = o.block_lgd::text
        WHERE o.period_label = $1 AND o.index_outcome IS NOT NULL
        `,
        [periodLabel]
      );
      rows.forEach((r) => {
        map.set(
          `b:${r.block_lgd || ''}:${String(r.name || '').toLowerCase()}`,
          r.value_text
        );
      });
      return map;
    }

    if (isComposite && geoLevel === 'division') {
      const { rows } = await query(
        `
        SELECT div.name AS name,
               AVG(o.index_outcome)::text AS value_text
        FROM indicator_outcome_district o
        JOIN district d ON d.lgd_code::text = o.district_lgd::text
        JOIN division div ON div.id = d.division_id
        WHERE o.period_label = $1 AND o.index_outcome IS NOT NULL
        GROUP BY div.id, div.name
        `,
        [periodLabel]
      );
      rows.forEach((r) => {
        map.set(`div:${String(r.name || '').toLowerCase()}`, r.value_text);
      });
      return map;
    }

    if (!isComposite && indicatorCode && geoLevel === 'district') {
      const { rows } = await query(
        `
        SELECT v.district_lgd,
               COALESCE(d.name, o.district_name) AS name,
               v.value::text AS value_text
        FROM indicator_outcome_district_value v
        JOIN indicator_outcome_district o
          ON o.year = v.year AND o.month = v.month AND o.district_lgd = v.district_lgd
        LEFT JOIN district d ON d.lgd_code::text = v.district_lgd::text
        WHERE v.period_label = $1
          AND v.indicator_code = $2
          AND v.value IS NOT NULL
        `,
        [periodLabel, indicatorCode]
      );
      rows.forEach((r) => {
        map.set(
          `d:${r.district_lgd || ''}:${String(r.name || '').toLowerCase()}`,
          r.value_text
        );
      });
      return map;
    }

    if (!isComposite && indicatorCode && geoLevel === 'block') {
      const { rows } = await query(
        `
        SELECT v.block_lgd,
               COALESCE(b.name, o.block_name) AS name,
               v.value::text AS value_text
        FROM indicator_outcome_block_value v
        JOIN indicator_outcome_block o
          ON o.year = v.year AND o.month = v.month AND o.block_lgd = v.block_lgd
        LEFT JOIN block b ON b.lgd_code::text = v.block_lgd::text
        WHERE v.period_label = $1
          AND v.indicator_code = $2
          AND v.value IS NOT NULL
        `,
        [periodLabel, indicatorCode]
      );
      rows.forEach((r) => {
        map.set(
          `b:${r.block_lgd || ''}:${String(r.name || '').toLowerCase()}`,
          r.value_text
        );
      });
      return map;
    }

    if (!isComposite && indicatorCode && geoLevel === 'division') {
      const { rows } = await query(
        `
        SELECT div.name AS name,
               AVG(v.value)::text AS value_text
        FROM indicator_outcome_district_value v
        JOIN district d ON d.lgd_code::text = v.district_lgd::text
        JOIN division div ON div.id = d.division_id
        WHERE v.period_label = $1
          AND v.indicator_code = $2
          AND v.value IS NOT NULL
        GROUP BY div.id, div.name
        `,
        [periodLabel, indicatorCode]
      );
      rows.forEach((r) => {
        map.set(`div:${String(r.name || '').toLowerCase()}`, r.value_text);
      });
      return map;
    }
  } catch (err) {
    console.warn('Exact value text overlay skipped:', err.message);
  }
  return map;
}

/**
 * Match legacy frontend export columns:
 * - division: division, indicator, month, scoreKey, rank
 * - district: district, indicator, month, scoreKey, rank
 * - block:    block, indicator, month, scoreKey, rank, district
 */
function buildIndicatorSheet(rows, geoLevel, monthLabel, indicator) {
  const scoreKey = exportScoreKeyForIndicator(indicator);
  const indicatorLabel = indicator?.name || indicator?.id || 'Indicator';
  const geoKey = geoKeyForExportLevel(geoLevel);

  const headers =
    geoLevel === 'division'
      ? ['division', 'indicator', 'month', scoreKey, 'rank']
      : geoLevel === 'block'
        ? ['block', 'indicator', 'month', scoreKey, 'rank', 'district']
        : ['district', 'indicator', 'month', scoreKey, 'rank'];

  const out = (rows || []).map((r, i) => {
    const name = String(r.geo_name || '').trim();
    const score = rawDbScore(
      r.value_text != null ? r.value_text : r.value,
      indicator?.unit
    );
    const rank = r.rank != null && r.rank !== '' ? Number(r.rank) : i + 1;
    const base = {
      indicator: indicatorLabel,
      month: monthLabel,
      [scoreKey]: score,
      rank,
    };

    if (geoLevel === 'division') {
      base.division = formatDivisionExportName(name);
    } else if (geoLevel === 'block') {
      base.block = name;
      base.district = String(r.district_name || '').trim();
    } else {
      base.district = name;
    }
    return base;
  });

  out.sort((a, b) => (Number(a.rank) || 999) - (Number(b.rank) || 999));
  return { headers, rows: out };
}

function buildGeoRankMatrixSheetFromExportSheets(sheets, level) {
  const geoKey = geoKeyForExportLevel(level);
  const rankName = geoRankSheetName(level);
  const indicatorSheets = (sheets || []).filter(
    (sheet) => sheet?.name && sheet.name !== rankName
  );
  if (!indicatorSheets.length) {
    return { name: rankName, headers: [], rows: [] };
  }

  // Ascending rank (1 first) — same order as indicator sheets
  const columns = indicatorSheets.map((sheet) => ({
    name: sheet.fullName || sheet.name,
    rows: [...(sheet.rows || [])].sort(
      (a, b) => (Number(a.rank) || 999) - (Number(b.rank) || 999)
    ),
  }));

  const rowCount = Math.max(...columns.map((col) => col.rows.length), 0);
  const headers = columns.flatMap(({ name }) => [name, `rank_${name}`]);

  const rows = Array.from({ length: rowCount }, (_, rowIndex) => {
    const row = {};
    columns.forEach(({ name, rows: colRows }) => {
      const item = colRows[rowIndex];
      row[name] = item
        ? formatGeoRankLabel(item[geoKey], level, scoreFromExportRow(item))
        : '';
      row[`rank_${name}`] =
        item?.rank != null && item.rank !== '' ? Number(item.rank) : '';
    });
    return row;
  });

  return { name: rankName, headers, rows };
}

function appendGeoRankMatrixSheet(sheets, level) {
  const rankSheet = buildGeoRankMatrixSheetFromExportSheets(sheets, level);
  if (!rankSheet.headers.length || !rankSheet.rows.length) return sheets;
  return [...sheets, rankSheet];
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

  const periodRow = await resolveOutcomePeriod(period);
  if (!periodRow) {
    const err = new Error('No ranking period found');
    err.status = 404;
    throw err;
  }

  const periodLabel = periodRow.label;
  const monthLabel = formatExportMonth(periodLabel);
  const indicators = await listExportIndicators(indicatorId, multi, geoLevel);
  if (!indicators.length) {
    const err = new Error(
      geoLevel === 'block'
        ? 'No block-level indicators available for this export'
        : 'No indicators available for this export'
    );
    err.status = 404;
    throw err;
  }
  const scope = user ? await resolveUserGeoScope(user) : null;

  const sheets = [];
  for (const ind of indicators) {
    let rows = await loadValuesForIndicator({
      geoLevel,
      indicator: ind,
      periodLabel,
    });
    rows = applyScopeToValueRows(rows, scope, geoLevel);

    const payload = buildIndicatorSheet(rows, geoLevel, monthLabel, ind);
    const fullName = String(ind.name || ind.id || 'Indicator').trim();
    sheets.push({
      // Excel tab title max 31 chars; full name kept on rows + rank matrix via fullName
      name: sanitizeSheetName(fullName, ind.id),
      fullName,
      headers: payload.headers,
      rows: payload.rows,
    });
  }

  const withRankSheet = appendGeoRankMatrixSheet(sheets, geoLevel);

  return {
    period: periodLabel,
    level: geoLevel,
    indicator_id: String(indicatorId || 'RANK_COMPOSITE'),
    multi: indicators.length > 1,
    sheet_count: withRankSheet.length,
    sheets: withRankSheet,
  };
}

function buildDefaultFilename({ level, period, indicatorId, multi }) {
  const levelSlug =
    level === 'division' ? 'Divisions' : level === 'block' ? 'Blocks' : 'Districts';
  const periodSlug = String(period || 'period').replace(/[^\w\-]+/g, '_');
  const fileTag =
    multi || isCompositeCode(indicatorId)
      ? 'All-Indicators'
      : String(indicatorId || 'indicator').replace(/[^\w\-]+/g, '_');
  return `UP-${levelSlug}-${fileTag}-${periodSlug}.xlsx`;
}

async function workbookToXlsxBuffer(workbook) {
  const sheets = (workbook?.sheets || []).filter(
    (s) => s?.headers?.length || s?.rows?.length
  );
  if (!sheets.length) {
    const err = new Error('No rows to export');
    err.status = 404;
    throw err;
  }

  const xlsx = new ExcelJS.Workbook();
  xlsx.creator = 'UP Health Dashboard';
  xlsx.created = new Date();

  const used = new Set();
  for (let i = 0; i < sheets.length; i += 1) {
    const sheet = sheets[i];
    let name = sanitizeSheetName(sheet.name, `Sheet${i + 1}`);
    let unique = name;
    let n = 2;
    while (used.has(unique.toLowerCase())) {
      const suffix = ` (${n})`;
      unique = `${name.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
      n += 1;
    }
    used.add(unique.toLowerCase());

    const ws = xlsx.addWorksheet(unique);
    const headers = sheet.headers?.length
      ? sheet.headers
      : Object.keys(sheet.rows?.[0] || {});
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };

    const scoreCols = new Set(
      headers.filter(
        (h) => h === 'composite_index' || h === 'perc_point' || h === 'monthly'
      )
    );

    for (const row of sheet.rows || []) {
      const values = headers.map((key) => {
        const raw = row?.[key];
        if (raw == null || raw === '') return '';
        // Scores as text so Excel shows full 4–5 decimal digits
        if (scoreCols.has(key)) return String(raw);
        return raw;
      });
      const excelRow = ws.addRow(values);
      headers.forEach((key, colIndex) => {
        if (!scoreCols.has(key)) return;
        const cell = excelRow.getCell(colIndex + 1);
        cell.numFmt = '@'; // text — preserves decimal digits
      });
    }

    headers.forEach((key, colIndex) => {
      let max = String(key).length;
      const sample = Math.min((sheet.rows || []).length, 40);
      for (let r = 0; r < sample; r += 1) {
        const len = String(sheet.rows[r]?.[key] ?? '').length;
        if (len > max) max = len;
      }
      ws.getColumn(colIndex + 1).width = Math.min(Math.max(max + 2, 10), 40);
    });
  }

  return Buffer.from(await xlsx.xlsx.writeBuffer());
}

async function createTableExportDownload(opts = {}) {
  const workbook = await getTableExportWorkbook(opts);
  const buffer = await workbookToXlsxBuffer(workbook);
  const filename =
    opts.filename ||
    buildDefaultFilename({
      level: workbook.level,
      period: workbook.period,
      indicatorId: workbook.indicator_id,
      multi: workbook.multi,
    });

  const stored = storeExportFile({
    buffer,
    filename,
    userId: opts.user?.sub || opts.user?.id || null,
  });

  return {
    job_id: stored.jobId,
    status: 'ready',
    filename: stored.filename,
    expires_at: new Date(stored.expiresAt).toISOString(),
    expires_in_sec: stored.expiresInSec,
    period: workbook.period,
    level: workbook.level,
    indicator_id: workbook.indicator_id,
    sheet_count: workbook.sheet_count,
    download_path: `health-ranking/table/export/download/${stored.jobId}`,
  };
}

module.exports = {
  getTableExportWorkbook,
  createTableExportDownload,
  workbookToXlsxBuffer,
  takeExportFile,
  removeExportFile,
  formatExportMonth,
  namesMatch,
};
