/**
 * Seed indicator_outcome_district from Ind_value_rank Excel (District sheet).
 *
 * Usage:
 *   node scripts/importOutcomeDistrictExcel.js [path.xlsx] [month] [year]
 * Default: data/Ind_value_rank_2.0.xlsx or Downloads copy, month=5 year=2026
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');

const defaultPaths = [
  path.join(__dirname, '..', 'data', 'Ind_value_rank_2.0.xlsx'),
  'c:/Users/QuaereNode01/Downloads/Ind_value_rank_2.0.xlsx',
];

async function ensureSchema(pool) {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'database', '024_indicator_outcome_district.sql'),
    'utf8'
  );
  await pool.query(sql);
}

function loadDistrictRows(filePath, month, year) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets.District || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  return rows.map((r, idx) => {
    const indicators = {};
    for (const [k, v] of Object.entries(r)) {
      if (/^IND\d{3}$/i.test(k)) indicators[k.toUpperCase()] = v;
    }
    return {
      id: idx + 1,
      districtName: r.District,
      districtLgdCode: r.DistrictLGDcode ?? r.DistrictLGDCode,
      month,
      year,
      indexOutcome: r.index_outcome ?? r.indexOutcome,
      rankOutcome: r.rank_outcome ?? r.rankOutcome,
      indicators,
    };
  });
}

async function main() {
  const fileArg = process.argv[2];
  const month = Number(process.argv[3] || 5);
  const year = Number(process.argv[4] || 2026);
  const filePath =
    fileArg ||
    defaultPaths.find((p) => fs.existsSync(p));
  if (!filePath) {
    console.error('Excel file not found. Pass path as first arg.');
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await ensureSchema(pool);
  const rows = loadDistrictRows(filePath, month, year);
  console.log(`Loaded ${rows.length} districts from ${filePath} → ${year}-${String(month).padStart(2, '0')}`);

  // use service upsert
  const { ingestDistrictOutcomeJson } = require('../src/outcome/outcomeDistrictService');
  // temporarily need tables; service uses app pool
  await pool.end();

  const result = await ingestDistrictOutcomeJson(rows, { month, year, source: 'excel' });
  console.log(result);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
