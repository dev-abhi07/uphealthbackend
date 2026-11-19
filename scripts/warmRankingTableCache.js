#!/usr/bin/env node
/**
 * Warm Redis table left-panel (hierarchy_only) keys for every indicator.
 *
 * Usage:
 *   node -r dotenv/config scripts/warmRankingTableCache.js
 *   node -r dotenv/config scripts/warmRankingTableCache.js --period=2026-09
 */
require('dotenv').config();

const { getRedis } = require('../src/cache/redisClient');
const { warmTableHierarchyCache } = require('../src/cache/warmRankingTableCache');

async function main() {
  if (process.env.REDIS_ENABLED !== 'false') {
    getRedis();
  }

  const periodArg = process.argv.find((a) => a.startsWith('--period='));
  const period = periodArg ? periodArg.split('=')[1] : undefined;

  const result = await warmTableHierarchyCache({
    period,
    reason: 'cli',
    concurrency: 2,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
