/**
 * Rename district spelling Badaun → Budaun across masters and caches.
 */
require('dotenv').config();
const { pool, query } = require('../src/db/pool');

async function run(label, sql, params = []) {
  try {
    const r = await query(sql, params);
    console.log(label, 'rows=', r.rowCount);
    return r.rowCount || 0;
  } catch (e) {
    console.log(label, 'SKIP', e.message);
    return 0;
  }
}

(async () => {
  await run(
    'district',
    `UPDATE district SET name = 'Budaun' WHERE lower(trim(name)) = 'badaun'`
  );
  await run(
    'outcome_district',
    `UPDATE indicator_outcome_district
     SET district_name = 'Budaun', updated_at = NOW()
     WHERE lower(trim(district_name)) = 'badaun'`
  );
  await run(
    'ranking_geo',
    `UPDATE ranking_value SET geo_name = 'Budaun'
     WHERE lower(trim(geo_name)) = 'badaun'`
  );
  await run(
    'ranking_district_name',
    `UPDATE ranking_value SET district_name = 'Budaun'
     WHERE lower(trim(district_name)) = 'badaun'`
  );
  await run(
    'facility',
    `UPDATE facility
     SET name = replace(name, 'Badaun', 'Budaun'), updated_at = NOW()
     WHERE name LIKE '%Badaun%' AND name NOT LIKE '%Badaunadeeh%'`
  );
  await run(
    'facility_code_master',
    `UPDATE facility_code_master
     SET facility_name = replace(facility_name, 'Badaun', 'Budaun'), updated_at = NOW()
     WHERE facility_name LIKE '%Badaun%' AND facility_name NOT LIKE '%Badaunadeeh%'`
  );
  await run(
    'block',
    `UPDATE block SET name = replace(name, 'Badaun', 'Budaun')
     WHERE name LIKE '%Badaun%' AND name NOT LIKE '%Badaunadeeh%'`
  );

  const d = await query(
    `SELECT id, lgd_code, name FROM district WHERE lower(name) LIKE '%daun%' ORDER BY name`
  );
  console.log('districts:', d.rows);

  try {
    const o = await query(
      `SELECT DISTINCT district_name FROM indicator_outcome_district
       WHERE lower(district_name) LIKE '%daun%' ORDER BY 1`
    );
    console.log('outcome names:', o.rows);
  } catch (e) {
    console.log('outcome names SKIP', e.message);
  }

  try {
    const r = await query(
      `SELECT DISTINCT geo_name FROM ranking_value
       WHERE lower(geo_name) LIKE '%daun%' ORDER BY 1`
    );
    console.log('ranking geo_name:', r.rows);
  } catch (e) {
    console.log('ranking geo SKIP', e.message);
  }

  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
