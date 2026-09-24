/**
 * Generate sample filled Excel files under sheets/xlsx/ (STATE level column layout)
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { buildTemplateWorkbook } = require('../src/upload/templateBuilder');

async function fillAndWrite(opts, fillFn, outName) {
  const { buffer, template, uploadLevel } = await buildTemplateWorkbook(opts);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerIdx = rows.findIndex((r) => {
    const a = String(r[0] || '').toLowerCase();
    return a === 'district' || a === 'block' || a.startsWith('facility');
  });
  const headers = rows[headerIdx];
  fillFn(rows, headerIdx, headers, template, uploadLevel);
  const outWb = XLSX.utils.book_new();
  const outWs = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(outWb, outWs, 'Upload');
  const outDir = path.join(__dirname, '..', 'sheets', 'xlsx');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, outName);
  XLSX.writeFile(outWb, outPath);
  console.log('Wrote', outPath, '| level=', uploadLevel, '| headers=', headers.slice(0, 4).join(', '));
}

async function main() {
  // Block sheet: Block | Block LGD | values (District hidden)
  await fillAndWrite(
    {
      indicatorCode: 'IND_ANC_1ST_TRIMESTER_PCT',
      period: '2026-05',
      level: 'block',
      sourceCode: 'ekavach',
      districtId: 49,
    },
    (rows, headerIdx, headers) => {
      const e4 = headers.findIndex((h) => String(h).includes('first trimester'));
      const e5 = headers.findIndex((h) => String(h).includes('registered for ANCs'));
      const blockLgd = headers.findIndex((h) => String(h).toLowerCase().includes('block lgd'));
      for (let i = headerIdx + 1; i < rows.length; i += 1) {
        if (String(rows[i][blockLgd]) === '1329') {
          rows[i][e4] = 80;
          rows[i][e5] = 100;
        }
      }
    },
    'EX_STATE_ANC_BLOCK_Lucknow_FILLED.xlsx'
  );

  // Facility sheet: Facility Name | HFR | values (District+Block hidden)
  await fillAndWrite(
    {
      indicatorCode: 'IND_CHC_FRU_CSECTION_PCT',
      period: '2026-05',
      level: 'facility',
      sourceCode: 'hmis',
      districtId: 1,
    },
    (rows, headerIdx, headers) => {
      const val = headers.findIndex((h) => String(h).toLowerCase().includes('c-section'));
      const fac = headers.findIndex((h) => String(h).toLowerCase().includes('facility'));
      for (let i = headerIdx + 1; i < rows.length; i += 1) {
        const name = String(rows[i][fac] || '');
        if (name === 'CHC Achhnera') rows[i][val] = 14;
        else if (name === 'CHC Bah') rows[i][val] = 12;
        else if (name.startsWith('CHC')) rows[i][val] = 3;
      }
    },
    'EX_STATE_CSECTION_FACILITY_Agra_FILLED.xlsx'
  );

  // District sheet: District | District LGD | values
  await fillAndWrite(
    {
      indicatorCode: 'IND_ANC_1ST_TRIMESTER_PCT',
      period: '2026-05',
      level: 'district',
      sourceCode: 'ekavach',
      divisionId: 3,
    },
    (rows, headerIdx, headers) => {
      const e4 = headers.findIndex((h) => String(h).includes('first trimester'));
      const e5 = headers.findIndex((h) => String(h).includes('registered for ANCs'));
      const distLgd = headers.findIndex((h) => String(h).toLowerCase().includes('district lgd'));
      for (let i = headerIdx + 1; i < rows.length; i += 1) {
        if (String(rows[i][distLgd]) === '162') {
          rows[i][e4] = 200;
          rows[i][e5] = 250;
        }
      }
    },
    'EX_STATE_ANC_DISTRICT_LucknowDiv_FILLED.xlsx'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
