require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db/pool');

(async () => {
  const sqlPath = path.join(__dirname, '../database/030_user_activity_log.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(
    `SELECT to_regclass('public.user_activity_log') AS table_name`
  );
  console.log('ok', rows[0]);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
