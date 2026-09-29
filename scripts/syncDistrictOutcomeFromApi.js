/**
 * Sync district outcome from live API into indicator_outcome_* tables.
 * Usage: node scripts/syncDistrictOutcomeFromApi.js [month] [year]
 */
require('dotenv').config();

const month = Number(process.argv[2] || 6);
const year = Number(process.argv[3] || 2026);

(async () => {
  const { syncDistrictOutcome } = require('../src/outcome/outcomeDistrictService');
  const store = require('../src/outcome/outcomeDistrictStore');

  console.log('syncing', { month, year });
  const result = await syncDistrictOutcome({ month, year, force: true });
  console.log('sync_result', JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exit(1);
  }

  const has = await store.hasDistrictOutcomePeriod(year, month);
  const values = await store.getDistrictValues({ year, month, indicatorCode: 'IND001' });
  console.log('cached', { has, districts_for_IND001: values.length });
  if (values[0]) {
    console.log('sample_IND001', {
      district: values[0].district_name,
      value: values[0].value,
      rank: values[0].rank,
    });
  }

  const allInd = await store.getDistrictValues({ year, month });
  const codes = [...new Set(allInd.map((r) => r.indicator_code))].sort();
  console.log('indicator_codes_stored', codes.length, codes.slice(0, 10), '...');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
