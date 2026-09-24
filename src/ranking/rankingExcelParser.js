const XLSX = require('xlsx');
const { matchIndicatorCode, parseMonthLabel } = require('./rankingRegistry');
const { normalizeGeoName } = require('./rankingNameNormalize');

function cellStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function detectGeoLevel(headers) {
  const h = headers.map((x) => x.toLowerCase());
  if (h.includes('block')) return 'block';
  if (h.includes('division')) return 'division';
  if (h.includes('district')) return 'district';
  return null;
}

function colIndex(headers, name) {
  const want = name.toLowerCase();
  return headers.findIndex((h) => h.toLowerCase() === want);
}

function parseRankingWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false });
  const sheets = [];
  let geoLevel = null;
  let monthMeta = { label: null, display: null };

  for (const sheetName of wb.SheetNames) {
    if (/low_best_performing/i.test(sheetName)) continue;
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (!rows.length) continue;
    const headers = (rows[0] || []).map((h) => cellStr(h));
    const level = detectGeoLevel(headers);
    if (!level) continue;
    if (!geoLevel) geoLevel = level;

    const code = matchIndicatorCode(sheetName, '');
    const isComposite = code === 'RANK_COMPOSITE' || sheetName.toLowerCase().includes('composite');

    const idx = {
      division: colIndex(headers, 'division'),
      district: colIndex(headers, 'district'),
      block: colIndex(headers, 'block'),
      indicator: colIndex(headers, 'indicator'),
      perc: colIndex(headers, 'perc_point'),
      composite: colIndex(headers, 'composite_index'),
      rank: colIndex(headers, 'rank'),
      month: colIndex(headers, 'month'),
    };

    const dataRows = [];
    for (let i = 1; i < rows.length; i += 1) {
      const r = rows[i] || [];
      const geoNameRaw =
        level === 'division'
          ? cellStr(r[idx.division])
          : level === 'block'
            ? cellStr(r[idx.block])
            : cellStr(r[idx.district]);
      if (!geoNameRaw) continue;
      const geoName = level === 'block' ? geoNameRaw : normalizeGeoName(geoNameRaw);
      const indicatorName = idx.indicator >= 0 ? cellStr(r[idx.indicator]) : sheetName;
      const monthRaw = idx.month >= 0 ? cellStr(r[idx.month]) : '';
      if (monthRaw && !monthMeta.label) monthMeta = parseMonthLabel(monthRaw);
      const value = isComposite ? num(r[idx.composite]) : num(r[idx.perc] >= 0 ? r[idx.perc] : r[idx.composite]);
      const rank = idx.rank >= 0 ? num(r[idx.rank]) : null;
      const districtRaw =
        level === 'block' && idx.district >= 0 ? cellStr(r[idx.district]) : null;
      dataRows.push({
        geoName,
        districtName: districtRaw ? normalizeGeoName(districtRaw) : null,
        indicatorName,
        value,
        rank: rank != null ? Math.round(rank) : null,
        month: monthRaw,
      });
    }

    const resolvedCode =
      matchIndicatorCode(sheetName, dataRows[0] ? dataRows[0].indicatorName : '') || code;
    if (!resolvedCode || !dataRows.length) continue;

    sheets.push({
      sheetName,
      code: resolvedCode,
      isComposite: resolvedCode === 'RANK_COMPOSITE',
      rows: dataRows,
    });
  }

  if (!geoLevel) {
    const err = new Error(
      'Could not detect geo level. Expected columns: division OR district OR block'
    );
    err.status = 400;
    throw err;
  }
  if (!sheets.length) {
    const err = new Error('No ranking sheets found (composite / indicator tabs)');
    err.status = 400;
    throw err;
  }

  return {
    geoLevel,
    periodLabel: monthMeta.label,
    periodDisplay: monthMeta.display,
    sheets,
  };
}

module.exports = { parseRankingWorkbook };
