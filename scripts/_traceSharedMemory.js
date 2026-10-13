/**
 * Trace "out of shared memory" against local Postgres + ranking services.
 */
const { pool, query } = require('../src/db/pool');
const rankingExecutiveSummaryService = require('../src/ranking/rankingExecutiveSummaryService');
const {
  loadCompositeByPeriod,
  loadIndicatorByPeriod,
  listOutcomePeriodLabels,
} = require('../src/outcome/outcomeRankingQueries');

const origQuery = pool.query.bind(pool);
let qn = 0;
const recent = [];

pool.query = async function tracedQuery(text, params) {
  const id = ++qn;
  const sql = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  const started = Date.now();
  try {
    const res = await origQuery(text, params);
    recent.push({ id, ms: Date.now() - started, ok: true, sql });
    return res;
  } catch (err) {
    recent.push({ id, ms: Date.now() - started, ok: false, sql, err: err.message });
    console.error('\n[QUERY FAIL]', id, err.message);
    console.error(sql);
    throw err;
  }
};

async function showPgSettings() {
  const { rows } = await origQuery(`
    SELECT name, setting, unit, short_desc
    FROM pg_settings
    WHERE name IN (
      'shared_buffers',
      'max_locks_per_transaction',
      'max_connections',
      'work_mem',
      'max_pred_locks_per_transaction',
      'dynamic_shared_memory_type'
    )
    ORDER BY name
  `);
  console.log('\n=== Postgres settings ===');
  for (const r of rows) {
    console.log(`${r.name}=${r.setting}${r.unit ? r.unit : ''}`);
  }

  const locks = await origQuery(`
    SELECT count(*)::int AS lock_count,
           count(*) FILTER (WHERE granted) AS granted
    FROM pg_locks
  `);
  console.log('pg_locks rows:', locks.rows[0]);

  const conns = await origQuery(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE state = 'active') AS active
    FROM pg_stat_activity
    WHERE datname = current_database()
  `);
  console.log('connections:', conns.rows[0]);
}

async function runStep(name, fn) {
  console.log(`\n>>> ${name}`);
  const before = qn;
  try {
    const out = await fn();
    console.log(`OK (${qn - before} queries)`);
    return out;
  } catch (err) {
    console.error(`FAIL: ${err.message}`);
    console.error('Last queries:');
    recent.slice(-8).forEach((q) => {
      console.error(`  #${q.id} ${q.ok ? 'ok' : 'ERR'} ${q.ms}ms ${q.sql}`);
    });
    return null;
  }
}

async function main() {
  await showPgSettings();

  const labels = await listOutcomePeriodLabels();
  console.log('\noutcome periods:', labels.slice(0, 8), '... total', labels.length);
  const period = labels[0] || '2026-07';
  const loadLabels = labels.filter((l) => l <= period).slice(-6);

  await runStep('loadCompositeByPeriod(division)', () =>
    loadCompositeByPeriod('division', loadLabels),
  );
  await runStep('loadCompositeByPeriod(district)', () =>
    loadCompositeByPeriod('district', loadLabels),
  );
  await runStep('getExecutiveSummary(division)', () =>
    rankingExecutiveSummaryService.getExecutiveSummary({
      period,
      level: 'division',
    }),
  );
  await runStep('getExecutiveSummary(district)', () =>
    rankingExecutiveSummaryService.getExecutiveSummary({
      period,
      level: 'district',
    }),
  );

  // Stress: parallel executive + composites (mimics multi-tab)
  await runStep('parallel x6 executive+composite', async () => {
    await Promise.all([
      rankingExecutiveSummaryService.getExecutiveSummary({ period, level: 'division' }),
      rankingExecutiveSummaryService.getExecutiveSummary({ period, level: 'district' }),
      loadCompositeByPeriod('district', loadLabels),
      loadCompositeByPeriod('division', loadLabels),
      loadCompositeByPeriod('district', loadLabels),
      loadCompositeByPeriod('block', loadLabels.slice(-2)),
    ]);
  });

  console.log('\nDone. Total queries:', qn);
  await pool.end();
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
