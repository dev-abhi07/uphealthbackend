const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: 20,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
});

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    // Surface SQL for intermittent Postgres faults (e.g. "out of shared memory")
    const sql = String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    console.error('[pg:query-failed]', err.code || '', err.message);
    console.error('[pg:sql]', sql);
    if (params && params.length) {
      console.error('[pg:params]', JSON.stringify(params).slice(0, 300));
    }
    throw err;
  }
}

module.exports = { pool, query };
