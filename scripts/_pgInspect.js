const { pool } = require('../src/db/pool');

async function main() {
  const t = await pool.query(`
    SELECT count(*)::int AS tables
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const big = await pool.query(`
    SELECT relname, n_live_tup::bigint AS rows
    FROM pg_stat_user_tables
    ORDER BY n_live_tup DESC NULLS LAST
    LIMIT 20
  `);
  const rels = await pool.query(`
    SELECT count(*)::int AS relations
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  `);
  const parts = await pool.query(`
    SELECT count(*)::int AS partitioned FROM pg_partitioned_table
  `);
  const idxs = await pool.query(`
    SELECT count(*)::int AS indexes
    FROM pg_indexes WHERE schemaname = 'public'
  `);

  console.log('public tables', t.rows[0]);
  console.log('public relations', rels.rows[0]);
  console.log('indexes', idxs.rows[0]);
  console.log('partitioned tables', parts.rows[0]);
  console.log('top by rows', big.rows);

  // Estimate lock budget
  const cfg = await pool.query(`
    SELECT
      current_setting('max_connections')::int AS max_connections,
      current_setting('max_locks_per_transaction')::int AS max_locks_per_transaction
  `);
  const maxConn = cfg.rows[0].max_connections;
  const maxLocks = cfg.rows[0].max_locks_per_transaction;
  console.log(
    'lock table capacity ~',
    maxConn * maxLocks,
    `(max_connections ${maxConn} * max_locks_per_transaction ${maxLocks})`,
  );

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
