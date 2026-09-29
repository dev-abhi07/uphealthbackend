/**
 * Keep only API-synced outcome months; delete manual clones / extra periods.
 *
 * Default keep: 2026-05, 2026-06, 2026-07 (May–Jul from OUTCOME_*_API_URL).
 *
 * Usage:
 *   node scripts/cleanupOutcomePeriods.js
 *   KEEP_PERIODS=2026-05,2026-06,2026-07 node scripts/cleanupOutcomePeriods.js
 *   DRY_RUN=1 node scripts/cleanupOutcomePeriods.js
 */
require('dotenv').config();
const { Pool } = require('pg');

function clean(v) {
  return String(v || '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

const dryRun = ['1', 'true', 'yes'].includes(
  String(process.env.DRY_RUN || '').toLowerCase()
);

const keepRaw = String(
  process.env.KEEP_PERIODS || process.env.KEEP_PERIOD || '2026-05,2026-06,2026-07'
);
const keepPeriods = [
  ...new Set(
    keepRaw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  ),
];

for (const pl of keepPeriods) {
  if (!/^\d{4}-\d{2}$/.test(pl)) {
    console.error(`Invalid period "${pl}" — use YYYY-MM`);
    process.exit(1);
  }
}

const p = new Pool({
  host: clean(process.env.DB_HOST) || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: clean(process.env.DB_NAME),
  user: clean(process.env.DB_USER),
  password: clean(process.env.DB_PASSWORD),
});

async function summarize(client, table) {
  const { rows } = await client.query(
    `
    SELECT period_label, source, COUNT(*)::int AS n
    FROM ${table}
    GROUP BY period_label, source
    ORDER BY period_label, source
    `
  );
  return rows;
}

async function deleteOutside(client, table, periodCol = 'period_label') {
  const { rowCount } = await client.query(
    `DELETE FROM ${table} WHERE NOT (${periodCol} = ANY($1::text[]))`,
    [keepPeriods]
  );
  return rowCount;
}

(async () => {
  const client = await p.connect();
  try {
    console.log(`Keep periods: ${keepPeriods.join(', ')}${dryRun ? ' (DRY RUN)' : ''}`);

    console.log('\n=== BEFORE ===');
    console.log('district', await summarize(client, 'indicator_outcome_district'));
    console.log('block', await summarize(client, 'indicator_outcome_block'));

    if (dryRun) {
      const distExtra = await client.query(
        `SELECT period_label, source, COUNT(*)::int AS n
         FROM indicator_outcome_district
         WHERE NOT (period_label = ANY($1::text[]))
         GROUP BY 1, 2 ORDER BY 1`,
        [keepPeriods]
      );
      const blockExtra = await client.query(
        `SELECT period_label, source, COUNT(*)::int AS n
         FROM indicator_outcome_block
         WHERE NOT (period_label = ANY($1::text[]))
         GROUP BY 1, 2 ORDER BY 1`,
        [keepPeriods]
      );
      console.log('\nWould delete district:', distExtra.rows);
      console.log('Would delete block:', blockExtra.rows);
      return;
    }

    await client.query('BEGIN');

    // Child value tables first
    const delDistVal = await deleteOutside(client, 'indicator_outcome_district_value');
    const delDist = await deleteOutside(client, 'indicator_outcome_district');
    const delBlockVal = await deleteOutside(client, 'indicator_outcome_block_value');
    const delBlock = await deleteOutside(client, 'indicator_outcome_block');

    let delLog = 0;
    try {
      delLog = await deleteOutside(client, 'indicator_outcome_sync_log');
    } catch (e) {
      console.warn('sync_log cleanup skipped:', e.message);
    }

    // Also drop any remaining non-api rows inside keep windows (safety)
    const scrubDist = await client.query(
      `DELETE FROM indicator_outcome_district
       WHERE period_label = ANY($1::text[]) AND source IS DISTINCT FROM 'api'`,
      [keepPeriods]
    );
    const scrubDistVal = await client.query(
      `
      DELETE FROM indicator_outcome_district_value v
      WHERE v.period_label = ANY($1::text[])
        AND NOT EXISTS (
          SELECT 1 FROM indicator_outcome_district o
          WHERE o.year = v.year AND o.month = v.month AND o.district_lgd = v.district_lgd
        )
      `,
      [keepPeriods]
    );
    const scrubBlock = await client.query(
      `DELETE FROM indicator_outcome_block
       WHERE period_label = ANY($1::text[]) AND source IS DISTINCT FROM 'api'`,
      [keepPeriods]
    );
    const scrubBlockVal = await client.query(
      `
      DELETE FROM indicator_outcome_block_value v
      WHERE v.period_label = ANY($1::text[])
        AND NOT EXISTS (
          SELECT 1 FROM indicator_outcome_block o
          WHERE o.year = v.year AND o.month = v.month AND o.block_lgd = v.block_lgd
        )
      `,
      [keepPeriods]
    );

    await client.query('COMMIT');

    console.log('\n=== DELETED ===');
    console.log({
      district_value: delDistVal,
      district: delDist,
      block_value: delBlockVal,
      block: delBlock,
      sync_log: delLog,
      scrub_non_api_district: scrubDist.rowCount,
      scrub_orphan_district_value: scrubDistVal.rowCount,
      scrub_non_api_block: scrubBlock.rowCount,
      scrub_orphan_block_value: scrubBlockVal.rowCount,
    });

    console.log('\n=== AFTER ===');
    console.log('district', await summarize(client, 'indicator_outcome_district'));
    console.log('block', await summarize(client, 'indicator_outcome_block'));
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
    await p.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
