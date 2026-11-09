/**
 * Idempotent schema patches for deploy / ops.
 * Safe to re-run (IF NOT EXISTS / DROP IF EXISTS).
 *
 * Usage (on server, from API repo root):
 *   node scripts/applyPendingSchema.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db/pool');

const PATCHES = [
  '030_user_activity_log.sql',
  '031_user_activity_api_hit.sql',
  '032_user_session.sql',
  '033_outcome_period_label_indexes.sql',
];

async function main() {
  const dbDir = path.join(__dirname, '../database');
  for (const file of PATCHES) {
    const full = path.join(dbDir, file);
    if (!fs.existsSync(full)) {
      console.warn(`skip missing ${file}`);
      continue;
    }
    const sql = fs.readFileSync(full, 'utf8');
    process.stdout.write(`apply ${file} ... `);
    await pool.query(sql);
    console.log('ok');
  }

  const check = await pool.query(`
    SELECT
      to_regclass('public.user_activity_log') AS user_activity_log,
      to_regclass('public.user_session') AS user_session
  `);
  console.log('tables:', check.rows[0]);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
