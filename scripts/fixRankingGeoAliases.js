/**
 * One-shot: rewrite ranking_value geo_name / district_name aliases to master spellings.
 */
require('dotenv').config();
const { query, pool } = require('../src/db/pool');
const { normalizeGeoName } = require('../src/ranking/rankingNameNormalize');

const PAIRS = [
  ['Bagpat', 'Baghpat'],
  ['Budaun', 'Badaun'],
  ['Unnav', 'Unnao'],
  ['Shrawasti', 'Shravasti'],
  ['Kanpur Division', 'Kanpur Nagar Division'],
  ['Alligarh Division', 'Aligarh Division'],
];

(async () => {
  let total = 0;
  for (const [from, to] of PAIRS) {
    const geo = await query(
      `
      UPDATE ranking_value
      SET geo_name = $2
      WHERE lower(trim(geo_name)) = lower(trim($1))
        AND geo_name IS DISTINCT FROM $2
      `,
      [from, to]
    );
    const dist = await query(
      `
      UPDATE ranking_value
      SET district_name = $2
      WHERE lower(trim(district_name)) = lower(trim($1))
        AND district_name IS DISTINCT FROM $2
      `,
      [from, to]
    );
    const n = (geo.rowCount || 0) + (dist.rowCount || 0);
    total += n;
    console.log(`${from} -> ${to}: geo=${geo.rowCount} district_name=${dist.rowCount}`);
  }

  // Sanity: remaining alias spellings
  const { rows } = await query(
    `
    SELECT DISTINCT geo_level, geo_name
    FROM ranking_value
    WHERE lower(geo_name) IN ('bagpat','budaun','unnav','shrawasti','kanpur division','alligarh division')
    ORDER BY 1,2
    `
  );
  console.log('remaining bad geo_name:', rows);
  console.log('total rows updated:', total);

  // Quick verify counts for problem divisions
  const checks = await query(
    `
    SELECT dv.name AS division, COUNT(DISTINCT v.geo_name)::int AS districts
    FROM ranking_value v
    JOIN ranking_indicator i ON i.id = v.indicator_id AND i.code = 'RANK_COMPOSITE'
    JOIN ranking_period p ON p.id = v.period_id AND p.label = '2026-01'
    JOIN district d ON lower(trim(d.name)) = lower(trim(v.geo_name))
    JOIN division dv ON dv.id = d.division_id
    WHERE v.geo_level = 'district'
      AND dv.name IN ('Meerut Division', 'Bareilly Division', 'Kanpur Nagar Division', 'Lucknow Division', 'Aligarh Division')
    GROUP BY dv.name
    ORDER BY dv.name
    `
  );
  console.log('districts per division (Jan composite):', checks.rows);

  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
