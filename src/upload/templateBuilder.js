const ExcelJS = require('exceljs');
const {
  getTemplate,
  geoHeadersForLevel,
  LEVEL_META,
  isValidSourceCode,
  resolveAllowedLevels,
} = require('./templateRegistry');
const { query } = require('../db/pool');

/** Sheet protect password — users cannot edit locked (pre-filled) cells */
const SHEET_PROTECT_PASSWORD = 'UPHealth#Readonly';

async function fetchFacilityRows({ districtId, divisionId } = {}) {
  const params = [];
  const where = ['f.is_active = TRUE'];
  if (districtId) {
    params.push(districtId);
    where.push(`f.district_id = $${params.length}`);
  } else if (divisionId) {
    params.push(divisionId);
    where.push(`f.division_id = $${params.length}`);
  }

  // All active facilities statewide (no CHC/DH name filter).
  // Prefer real HFR from facility_code_master; fallback facility_code.
  // DISTINCT ON (f.id) avoids duplicate rows when fcm has multiple name matches.
  const { rows } = await query(
    `
    SELECT DISTINCT ON (f.id)
      f.name AS facility_name,
      COALESCE(NULLIF(fcm.hfr_code, ''), NULLIF(f.facility_code, ''), '') AS hfr_code,
      d.id AS district_id,
      d.lgd_code AS district_lgd,
      b.id AS block_id,
      b.lgd_code AS block_lgd
    FROM facility f
    LEFT JOIN facility_code_master fcm
      ON LOWER(fcm.facility_name) = LOWER(f.name)
    LEFT JOIN district d ON d.id = f.district_id
    LEFT JOIN block b ON b.id = f.block_id
    WHERE ${where.join(' AND ')}
    ORDER BY f.id, d.name NULLS LAST, b.name NULLS LAST, f.name,
             CASE WHEN fcm.hfr_code IS NOT NULL AND fcm.hfr_code <> '' THEN 0 ELSE 1 END
    `,
    params
  );
  // Stable display order after DISTINCT ON
  rows.sort((a, b) => {
    const da = a.district_lgd || '';
    const db = b.district_lgd || '';
    if (da !== db) return String(da).localeCompare(String(db));
    const na = a.facility_name || '';
    const nb = b.facility_name || '';
    return na.localeCompare(nb);
  });
  return rows;
}

async function fetchBlockRows({ districtId, divisionId }) {
  const params = [];
  const where = ['TRUE'];
  if (districtId) {
    params.push(districtId);
    where.push(`b.district_id = $${params.length}`);
  } else if (divisionId) {
    params.push(divisionId);
    where.push(`d.division_id = $${params.length}`);
  }

  const { rows } = await query(
    `
    SELECT
      b.name AS block_name,
      b.lgd_code AS block_lgd,
      d.id AS district_id,
      d.lgd_code AS district_lgd
    FROM block b
    JOIN district d ON d.id = b.district_id
    WHERE ${where.join(' AND ')}
    ORDER BY d.name, b.name
    `,
    params
  );
  return rows;
}

async function fetchDistrictRows({ districtId, divisionId }) {
  const params = [];
  const where = ['TRUE'];
  if (districtId) {
    params.push(districtId);
    where.push(`d.id = $${params.length}`);
  } else if (divisionId) {
    params.push(divisionId);
    where.push(`d.division_id = $${params.length}`);
  }

  const { rows } = await query(
    `
    SELECT d.name AS district_name, d.lgd_code AS district_lgd, d.id AS district_id
    FROM district d
    WHERE ${where.join(' AND ')}
    ORDER BY d.name
    `,
    params
  );
  return rows;
}

async function resolveIndicatorDbId(code) {
  const { rows } = await query(
    `SELECT id FROM indicator WHERE code = $1 AND is_active = TRUE LIMIT 1`,
    [code]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

function normalizeLevel(level) {
  if (level == null || level === '') return null;
  const raw = String(level).trim().toLowerCase();
  if (['district', 'd', 'dist'].includes(raw)) return 'district';
  if (['block', 'b'].includes(raw)) return 'block';
  if (['facility', 'f', 'fac'].includes(raw)) return 'facility';
  if (raw.includes('facility')) return 'facility';
  if (raw.includes('block')) return 'block';
  if (raw.includes('district')) return 'district';
  return raw;
}

function styleLocked(cell) {
  cell.protection = { locked: true };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF2F2F2' },
  };
  cell.border = THIN_BORDER;
}

function styleUnlocked(cell) {
  cell.protection = { locked: false };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFFFCC' },
  };
  cell.border = THIN_BORDER;
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  cell.numFmt = '0.##';
}

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FF9E9E9E' } },
  left: { style: 'thin', color: { argb: 'FF9E9E9E' } },
  bottom: { style: 'thin', color: { argb: 'FF9E9E9E' } },
  right: { style: 'thin', color: { argb: 'FF9E9E9E' } },
};

const VALUE_LEFT_BORDER = {
  top: { style: 'thin', color: { argb: 'FF9E9E9E' } },
  left: { style: 'medium', color: { argb: 'FF1565C0' } },
  bottom: { style: 'thin', color: { argb: 'FF9E9E9E' } },
  right: { style: 'thin', color: { argb: 'FF9E9E9E' } },
};

/**
 * Build Excel for STATE upload workflow.
 * Always statewide: no district_id / division_id scope.
 * - facility → all facilities (every district)
 * - block → all blocks
 * - district → all districts
 * - Meta: Name / Data Source / Period / Upload Level (no Indicator ID/Code)
 * - Geo locked; value cells editable with clear borders
 */
async function buildTemplateWorkbook({
  indicatorCode,
  period,
  level,
  sourceCode,
}) {
  const template = getTemplate(indicatorCode);
  if (!template) {
    const err = new Error(`Unknown template/indicator: ${indicatorCode}`);
    err.status = 404;
    throw err;
  }

  let uploadLevel = normalizeLevel(level) || template.defaultLevel;
  let levelFallback = false;
  const allowed = resolveAllowedLevels(template);
  if (!allowed.includes(uploadLevel)) {
    uploadLevel = template.defaultLevel;
    levelFallback = true;
  }

  if (sourceCode) {
    if (!isValidSourceCode(template, sourceCode)) {
      const err = new Error(
        `Source "${sourceCode}" not valid for ${indicatorCode}. Allowed: ${template.dataSources.join('+')}`
      );
      err.status = 400;
      throw err;
    }
  }

  const indicatorDbId = await resolveIndicatorDbId(template.code);
  const geoHeaders = geoHeadersForLevel(uploadLevel);
  const valueHeaders = template.valueColumns.map((c) => c.header);
  // Geo first, then editable values (no Indicator ID column)
  const headers = [...geoHeaders, ...valueHeaders];
  const levelMeta = LEVEL_META[uploadLevel];
  const geoColCount = geoHeaders.length;
  const valueStartCol = geoColCount; // 0-based index of first value col
  const totalCols = headers.length;
  const facilityNameCol = uploadLevel === 'facility' ? 1 : null; // 1-based

  // Always full-state rows (ignore district/division filters)
  let geoRows = [];
  if (uploadLevel === 'facility') {
    geoRows = await fetchFacilityRows({});
  } else if (uploadLevel === 'block') {
    geoRows = await fetchBlockRows({});
  } else {
    geoRows = await fetchDistrictRows({});
  }

  const sourceLabel = template.dataSourceLabel;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'UP Health Dashboard';
  const sheet = workbook.addWorksheet('Upload', {
    views: [{ state: 'frozen', ySplit: 5 }], // freeze meta + header
  });

  // Meta rows (locked) — Name only (no Indicator ID / Indicator Code)
  const metaRows = [
    ['Name', template.name],
    ['Data Source', sourceLabel],
    ['Period', period || ''],
    ['Upload Level', uploadLevel],
  ];

  metaRows.forEach((pair, idx) => {
    const row = sheet.getRow(idx + 1);
    row.getCell(1).value = pair[0];
    row.getCell(2).value = pair[1];
    styleLocked(row.getCell(1));
    styleLocked(row.getCell(2));
    row.getCell(1).font = { bold: true };
    if (idx === 0) {
      row.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
      row.height = 36;
    }
  });

  const headerRowNum = metaRows.length + 1;
  const headerRow = sheet.getRow(headerRowNum);
  headerRow.height = 40;
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    styleLocked(cell);
    if (i === valueStartCol) {
      cell.border = VALUE_LEFT_BORDER;
    }
  });

  // Column styles: locked geo vs unlocked value (with borders for clear separation)
  for (let c = 1; c <= geoColCount; c += 1) {
    const col = sheet.getColumn(c);
    col.protection = { locked: true };
    const isFacilityName = facilityNameCol === c;
    col.style = {
      protection: { locked: true },
      fill: {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF2F2F2' },
      },
      border: THIN_BORDER,
      alignment: isFacilityName
        ? { wrapText: true, vertical: 'middle' }
        : { vertical: 'middle' },
    };
  }
  for (let c = valueStartCol + 1; c <= totalCols; c += 1) {
    const col = sheet.getColumn(c);
    col.protection = { locked: false };
    col.style = {
      protection: { locked: false },
      fill: {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFFCC' },
      },
      border: c === valueStartCol + 1 ? VALUE_LEFT_BORDER : THIN_BORDER,
      alignment: { horizontal: 'center', vertical: 'middle' },
      numFmt: '0.##',
    };
  }

  const emptyValues = new Array(valueHeaders.length).fill(null);

  // Bulk add rows — column styles unlock value cols
  for (const g of geoRows) {
    let geoVals;
    if (uploadLevel === 'facility') {
      geoVals = [g.facility_name || '', g.hfr_code || ''];
    } else if (uploadLevel === 'block') {
      geoVals = [g.block_name || '', g.block_lgd || ''];
    } else {
      geoVals = [g.district_name || '', g.district_lgd || ''];
    }
    sheet.addRow([...geoVals, ...emptyValues]);
  }

  // Column widths — Facility Name wider for wrap
  headers.forEach((h, i) => {
    const col = sheet.getColumn(i + 1);
    if (facilityNameCol === i + 1) {
      col.width = 42;
    } else if (i >= valueStartCol) {
      col.width = Math.min(Math.max(String(h).length + 2, 16), 36);
    } else {
      col.width = Math.min(Math.max(String(h).length + 2, 14), 28);
    }
  });

  // Header + first data row: ensure Facility Name wrap + value borders visible
  if (geoRows.length > 0) {
    const firstData = sheet.getRow(headerRowNum + 1);
    if (facilityNameCol) {
      firstData.getCell(facilityNameCol).alignment = {
        wrapText: true,
        vertical: 'middle',
      };
    }
    for (let c = valueStartCol + 1; c <= totalCols; c += 1) {
      const cell = firstData.getCell(c);
      cell.border = c === valueStartCol + 1 ? VALUE_LEFT_BORDER : THIN_BORDER;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFFCC' },
      };
    }
  }

  await sheet.protect(SHEET_PROTECT_PASSWORD, {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    insertHyperlinks: false,
    deleteColumns: false,
    deleteRows: false,
    sort: false,
    autoFilter: false,
    pivotTables: false,
  });

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  return {
    template,
    uploadLevel,
    levelFallback,
    requestedLevel: normalizeLevel(level),
    indicatorId: indicatorDbId,
    hiddenColumns: levelMeta.hidden_columns,
    visibleColumns: [...levelMeta.visible_columns],
    rowCount: geoRows.length,
    buffer,
    filename: `${template.code}_${uploadLevel}_${period || 'period'}_state.xlsx`,
  };
}

module.exports = {
  buildTemplateWorkbook,
  geoHeadersForLevel,
  normalizeLevel,
  fetchFacilityRows,
  fetchBlockRows,
  fetchDistrictRows,
  SHEET_PROTECT_PASSWORD,
};
