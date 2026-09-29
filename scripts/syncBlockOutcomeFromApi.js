/**
 * Sync block outcome from live API into indicator_outcome_block* tables.
 * Usage: node scripts/syncBlockOutcomeFromApi.js [month] [year]
 */
require('dotenv').config();

const month = Number(process.argv[2] || 7);
const year = Number(process.argv[3] || 2026);

(async () => {
  const { syncBlockOutcome } = require('../src/outcome/outcomeBlockService');
  const store = require('../src/outcome/outcomeBlockStore');

  console.log('syncing block outcome', { month, year });
  const result = await syncBlockOutcome({ month, year, force: true });
  console.log('sync_result', JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exit(1);
  }

  const has = await store.hasBlockOutcomePeriod(year, month);
  const headers = await store.getBlockHeaders({ year, month });
  console.log('cached', {
    has,
    blocks: headers.length,
    top: headers.slice(0, 3).map((h) => ({
      rank: h.rank_outcome,
      block: h.block_name,
      district: h.district_name,
      score: h.index_outcome,
    })),
  });
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
