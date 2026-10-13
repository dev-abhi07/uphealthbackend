/**
 * Quick check: date-only `to=YYYY-MM-DD` excludes that whole day when cast to timestamptz midnight.
 */
require('dotenv').config();
const { query, pool } = require('../src/db/pool');

(async () => {
  const a = await query(
    'SELECT COUNT(*)::int AS c, MIN(created_at) AS mn, MAX(created_at) AS mx FROM user_activity_log'
  );
  console.log('all', a.rows[0]);

  const b = await query(
    `SELECT COUNT(*)::int AS c FROM user_activity_log
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
    ['2026-09-01', '2026-09-30']
  );
  console.log('bad to midnight', b.rows[0]);

  const c = await query(
    `SELECT COUNT(*)::int AS c FROM user_activity_log
     WHERE created_at >= $1::date
       AND created_at < ($2::date + INTERVAL '1 day')`,
    ['2026-09-01', '2026-09-30']
  );
  console.log('good inclusive day', c.rows[0]);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
