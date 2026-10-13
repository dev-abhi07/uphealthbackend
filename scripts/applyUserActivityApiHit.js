require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db/pool');

(async () => {
  const sqlPath = path.join(__dirname, '../database/031_user_activity_api_hit.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  console.log('ok: api_hit event_type allowed');
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
