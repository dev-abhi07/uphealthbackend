const XLSX = require('xlsx');
const { resolveTemplateByIndicatorName, getTemplate } = require('./templateRegistry');

function cellStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function normHeader(h) {
  return cellStr(h).toLowerCase().replace(/\s+/g, ' ');
}

function parseNumber(v) {
  const s = cellStr(v);
  if (s === '') return null;
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function sheetCell(sheet, r0, c0) {
  const addr = XLSX.utils.encode_cell({ r: r0, c: c0 });
  const cell = sheet[addr];
  if (!cell) return '';
  if (cell.w != null && cell.w !== '') return cell.w;
  if (cell.v === null || cell.v === undefined) return '';
  return cell.v;
}

function rowVals(sheet, r0, colCount) {
  const out = [];
  for (let c = 0; c < colCount; c += 1) out.push(sheetCell(sheet, r0, c));
  return out;
}

function isDataHeaderRow(row) {
  const a = cellStr(row[0]).toLowerCase();
  const b = cellStr(row[1]).toLowerCase();
  if (a === 'indicator id') {
    return (
      b === 'district' ||
      b === 'block' ||
      b.includes('facility') ||
      b.includes('district') ||
      b.includes('block')
    );
  }
  return (
    a === 'district' ||
    a === 'block' ||
    a === 'facility name' ||
    a.startsWith('facility')
  );
}

function detectGrainFromHeaders(headers) {
  const lower = headers.map((h) => normHeader(h));
  const hasFacility =
    lower.some((h) => h.includes('facility')) || lower.some((h) => h.includes('hfr'));
  const hasBlock = lower.some((h) => h === 'block' || h.includes('block lgd'));
  const hasDistrict = lower.some((h) => h === 'district' || h.includes('district lgd'));

  if (hasFacility && !hasDistrict && !hasBlock) return 'facility';
  if (hasBlock && !hasDistrict && !hasFacility) return 'block';
  if (hasDistrict && !hasBlock && !hasFacility) return 'district';
  if (hasFacility) return 'facility';
  if (hasBlock) return 'block';
  return 'district';
}

/**
 * Fast STATE upload parse — sparse cell reads.
 * Skips empty value rows without building full row objects (critical for ~33k facility sheets).
 */
function parseUploadWorkbook(buffer, { indicatorCode, level } = {}) {
  const t0 = Date.now();
  const wb = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
    raw: false,
    dense: false,
  });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const maxCol = Math.min(range.e.c + 1, 40);
  const maxScan = Math.min(range.e.r, 30);

  let headerRowIdx = -1;
  for (let r = 0; r <= maxScan; r += 1) {
    const row = rowVals(sheet, r, Math.max(maxCol, 4));
    const a = cellStr(row[0]).toLowerCase();
    if (a === '# data') {
      headerRowIdx = r + 1;
      break;
    }
    if (isDataHeaderRow(row)) {
      headerRowIdx = r;
      break;
    }
  }

  const meta = {};
  const scanEnd = headerRowIdx > 0 ? headerRowIdx : Math.min(maxScan, 12);
  for (let i = 0; i < scanEnd; i += 1) {
    const key = cellStr(sheetCell(sheet, i, 0));
    const val = cellStr(sheetCell(sheet, i, 1));
    if (!key || key.startsWith('#')) continue;
    const k = key.toLowerCase();
    if (k.startsWith('name')) meta.name = val;
    else if (k === 'indicator id' || k === 'indicator_id') meta.indicatorId = val;
    else if (k === 'indicator code' || k.includes('indicator code')) meta.indicatorCode = val;
    else if (k.includes('data source')) meta.dataSource = val;
    else if (k.startsWith('period')) meta.period = val;
    else if (k.includes('upload level') || k === 'level') meta.uploadLevel = val.toLowerCase();
    else if (k.includes('calculation level')) meta.calculationLevel = val;
    else if (k.includes('template grain')) meta.grain = val;
  }

  if (headerRowIdx < 0) {
    const err = new Error(
      'Could not find header row (expected District / Block / Facility Name)'
    );
    err.status = 400;
    throw err;
  }

  const headers = rowVals(sheet, headerRowIdx, maxCol).map((h) => cellStr(h));
  // trim trailing empties
  while (headers.length && headers[headers.length - 1] === '') headers.pop();

  const template =
    (indicatorCode && getTemplate(indicatorCode)) ||
    (meta.indicatorCode && getTemplate(meta.indicatorCode)) ||
    resolveTemplateByIndicatorName(meta.name);

  if (!template) {
    const err = new Error(
      `Unknown indicator in Excel (Name / Indicator Code): "${meta.name || meta.indicatorCode || ''}". Pass indicator_code.`
    );
    err.status = 400;
    throw err;
  }

  const grain =
    (level && String(level).toLowerCase()) ||
    meta.uploadLevel ||
    detectGrainFromHeaders(headers) ||
    template.defaultLevel;

  const geoHeaders = {
    district: headers.findIndex((h) => normHeader(h) === 'district'),
    districtLgd: headers.findIndex((h) => normHeader(h).includes('district lgd')),
    block: headers.findIndex((h) => normHeader(h) === 'block'),
    blockLgd: headers.findIndex((h) => normHeader(h).includes('block lgd')),
    facility: headers.findIndex((h) => normHeader(h).includes('facility')),
    hfr: headers.findIndex((h) => normHeader(h).includes('hfr')),
  };

  if (grain === 'district' && geoHeaders.districtLgd < 0 && geoHeaders.district < 0) {
    const err = new Error('District-level sheet must include District / District LGD code');
    err.status = 400;
    throw err;
  }
  if (grain === 'block' && geoHeaders.blockLgd < 0 && geoHeaders.block < 0) {
    const err = new Error('Block-level sheet must include Block / Block LGD code');
    err.status = 400;
    throw err;
  }
  if (grain === 'facility' && geoHeaders.hfr < 0 && geoHeaders.facility < 0) {
    const err = new Error('Facility-level sheet must include Facility Name / HFR Code');
    err.status = 400;
    throw err;
  }

  const valueMaps = template.valueColumns.map((col) => {
    const want = normHeader(col.header);
    const idx = headers.findIndex((h) => normHeader(h) === want);
    return { ...col, colIndex: idx };
  });

  const missingCols = valueMaps.filter((c) => c.colIndex < 0).map((c) => c.header);
  if (missingCols.length) {
    const err = new Error(`Missing value column(s): ${missingCols.join(' | ')}`);
    err.status = 400;
    throw err;
  }

  const valueColIndexes = valueMaps.map((vm) => vm.colIndex);
  const dataRows = [];
  let scanned = 0;

  // Clamp inflated !ref (duplicate ExcelJS/join rows) to last non-empty geo cell
  let lastRow = range.e.r;
  const geoCol =
    geoHeaders.facility >= 0
      ? geoHeaders.facility
      : geoHeaders.block >= 0
        ? geoHeaders.block
        : geoHeaders.district >= 0
          ? geoHeaders.district
          : 0;
  while (lastRow > headerRowIdx && cellStr(sheetCell(sheet, lastRow, geoCol)) === '') {
    lastRow -= 1;
  }

  for (let r = headerRowIdx + 1; r <= lastRow; r += 1) {
    scanned += 1;

    // Fast empty check: only value columns
    let hasAnyValue = false;
    const rawVals = [];
    for (let vi = 0; vi < valueColIndexes.length; vi += 1) {
      const raw = sheetCell(sheet, r, valueColIndexes[vi]);
      rawVals.push(raw);
      if (cellStr(raw) !== '') hasAnyValue = true;
    }
    if (!hasAnyValue) continue;

    const values = {};
    for (let vi = 0; vi < valueMaps.length; vi += 1) {
      const vm = valueMaps[vi];
      const n = parseNumber(rawVals[vi]);
      if (n !== null) {
        if (Number.isNaN(n)) {
          values[vm.deCode] = { error: `Invalid number in "${vm.header}"` };
        } else {
          values[vm.deCode] = { value: n };
        }
      }
    }

    const districtLgd =
      geoHeaders.districtLgd >= 0 ? cellStr(sheetCell(sheet, r, geoHeaders.districtLgd)) : '';
    const districtName =
      geoHeaders.district >= 0 ? cellStr(sheetCell(sheet, r, geoHeaders.district)) : '';
    const blockLgd =
      geoHeaders.blockLgd >= 0 ? cellStr(sheetCell(sheet, r, geoHeaders.blockLgd)) : '';
    const blockName =
      geoHeaders.block >= 0 ? cellStr(sheetCell(sheet, r, geoHeaders.block)) : '';
    const facilityName =
      geoHeaders.facility >= 0 ? cellStr(sheetCell(sheet, r, geoHeaders.facility)) : '';
    const hfrCode = geoHeaders.hfr >= 0 ? cellStr(sheetCell(sheet, r, geoHeaders.hfr)) : '';

    if (!(districtLgd || districtName || blockLgd || blockName || facilityName || hfrCode)) {
      continue;
    }

    dataRows.push({
      excelRow: r + 1,
      districtName,
      districtLgd,
      blockName,
      blockLgd,
      facilityName,
      hfrCode,
      values,
      hasAnyValue: true,
    });
  }

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(
      `[upload-parse] ${template.code} grain=${grain} scanned=${scanned} filled=${dataRows.length} ${Date.now() - t0}ms`
    );
  }

  return {
    sheetName,
    meta: {
      name: meta.name || template.name,
      indicatorId: meta.indicatorId || null,
      indicatorCode: meta.indicatorCode || template.code,
      dataSource: meta.dataSource || template.dataSourceLabel,
      period: meta.period || null,
      calculationLevel: meta.calculationLevel || template.calculationLevel,
      grain,
      uploadLevel: grain,
    },
    template: { ...template, grain },
    headers,
    dataRows,
  };
}

module.exports = {
  parseUploadWorkbook,
  parseNumber,
  cellStr,
  detectGrainFromHeaders,
};
