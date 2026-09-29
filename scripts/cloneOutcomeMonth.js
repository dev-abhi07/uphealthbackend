/**
 * Copy one outcome month to a range of months (same district + indicator values).
 * Default: copy 2026-05 → 2026-01 … 2026-10
 *
 * Usage:
 *   node scripts/cloneOutcomeMonth.js
 *   SOURCE_PERIOD=2026-05 FROM_MONTH=1 TO_MONTH=10 YEAR=2026 node scripts/cloneOutcomeMonth.js
 */
require('dotenv').config();
const { Pool } = require('pg');

function clean(v) {
  return String(v || '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

const source = clean(process.env.SOURCE_PERIOD || '2026-05');
const sm = source.match(/^(\d{4})-(\d{2})$/);
if (!sm) {
  console.error('SOURCE_PERIOD must be YYYY-MM');
  process.exit(1);
}
const srcYear = Number(sm[1]);
const srcMonth = Number(sm[2]);
const year = Number(process.env.YEAR || srcYear);
const fromMonth = Number(process.env.FROM_MONTH || 1);
const toMonth = Number(process.env.TO_MONTH || 10);

if (fromMonth < 1 || toMonth > 12 || fromMonth > toMonth) {
  console.error('Invalid FROM_MONTH / TO_MONTH');
  process.exit(1);
}

const pool = new Pool({
  host: clean(process.env.DB_HOST) || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: clean(process.env.DB_NAME),
  user: clean(process.env.DB_USER),
  password: clean(process.env.DB_PASSWORD),
});

async function cloneToMonth(client, targetMonth) {
  const label = `${year}-${String(targetMonth).padStart(2, '0')}`;

  // Never wipe the live source while copying from it
  if (targetMonth === srcMonth && year === srcYear) {
    return { period: label, districts: 0, values: 0, skipped: 'source' };
  }

  await client.query(
    `DELETE FROM indicator_outcome_district_value WHERE year = $1 AND month = $2`,
    [year, targetMonth]
  );
  await client.query(
    `DELETE FROM indicator_outcome_district WHERE year = $1 AND month = $2`,
    [year, targetMonth]
  );

  const insH = await client.query(
    `
    INSERT INTO indicator_outcome_district (
      external_id, district_name, district_lgd, month, year, period_label,
      index_outcome, rank_outcome, source, synced_at, created_at, updated_at
    )
    SELECT
      external_id, district_name, district_lgd,
      $3::int, $4::int, $5,
      index_outcome, rank_outcome,
      'manual', NOW(), NOW(), NOW()
    FROM indicator_outcome_district
    WHERE year = $1 AND month = $2
    `,
    [srcYear, srcMonth, targetMonth, year, label]
  );

  const insV = await client.query(
    `
    INSERT INTO indicator_outcome_district_value (
      year, month, period_label, district_lgd, indicator_code, value, synced_at
    )
    SELECT
      $3::int, $4::int, $5,
      district_lgd, indicator_code, value, NOW()
    FROM indicator_outcome_district_value
    WHERE year = $1 AND month = $2
    `,
    [srcYear, srcMonth, year, targetMonth, label]
  );

  await client.query(
    `
    INSERT INTO indicator_outcome_sync_log (
      geo_level, year, month, period_label, status, source, row_count
    ) VALUES ('district', $1, $2, $3, 'ok', 'clone', $4)
    `,
    [year, targetMonth, label, insH.rowCount]
  );

  return { period: label, districts: insH.rowCount, values: insV.rowCount };
}

(async () => {
  const check = await pool.query(
    `SELECT COUNT(*)::int AS n FROM indicator_outcome_district WHERE year = $1 AND month = $2`,
    [srcYear, srcMonth]
  );
  if (!check.rows[0].n) {
    console.error(`No source data for ${source}. Sync May first.`);
    process.exit(1);
  }
  console.log(`Source ${source}: ${check.rows[0].n} districts`);
  console.log(`Cloning → ${year}-${String(fromMonth).padStart(2, '0')} … ${year}-${String(toMonth).padStart(2, '0')}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const results = [];
    for (let m = fromMonth; m <= toMonth; m += 1) {
      results.push(await cloneToMonth(client, m));
    }
    await client.query('COMMIT');
    console.log(results);
    const periods = await pool.query(`
      SELECT year, month, period_label, COUNT(*)::int AS n
      FROM indicator_outcome_district
      GROUP BY 1, 2, 3
      ORDER BY 1, 2
    `);
    console.log('periods now:', periods.rows);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
