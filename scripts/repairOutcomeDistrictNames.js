/**
 * Repair outcome district_name to match master district.name (by LGD).
 */
require('dotenv').config();
const { query, pool } = require('../src/db/pool');

(async () => {
  const before = await query(
    `
    SELECT o.district_lgd, o.district_name AS outcome_name, d.name AS master_name, COUNT(*)::int AS n
    FROM indicator_outcome_district o
    JOIN district d ON d.lgd_code::text = o.district_lgd::text
    WHERE o.district_name IS DISTINCT FROM d.name
    GROUP BY 1, 2, 3
    ORDER BY 1
    `
  );
  console.log('mismatches before', before.rows);

  const upd = await query(
    `
    UPDATE indicator_outcome_district o
    SET district_name = d.name,
        updated_at = NOW()
    FROM district d
    WHERE d.lgd_code::text = o.district_lgd::text
      AND o.district_name IS DISTINCT FROM d.name
    `
  );
  console.log('rows updated', upd.rowCount);

  const after = await query(
    `
    SELECT o.district_lgd, o.district_name AS outcome_name, d.name AS master_name
    FROM indicator_outcome_district o
    JOIN district d ON d.lgd_code::text = o.district_lgd::text
    WHERE o.district_name IS DISTINCT FROM d.name
    LIMIT 20
    `
  );
  console.log('mismatches after', after.rows);

  const top = await query(
    `
    SELECT rank_outcome, district_name, district_lgd, index_outcome
    FROM indicator_outcome_district
    WHERE year = 2026 AND month = 5
    ORDER BY rank_outcome
    LIMIT 5
    `
  );
  console.log('May top5', top.rows);

  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
