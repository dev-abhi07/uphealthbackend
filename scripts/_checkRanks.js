require('dotenv').config();
const { query } = require('../src/db/pool');

(async () => {
  const r = await query(`
    SELECT district_name, district_lgd, index_outcome::float AS score, rank_outcome
    FROM indicator_outcome_district
    WHERE year = 2026 AND month = 5
      AND (
        lower(district_name) IN ('pilibhit','pratapgarh','shamli','barabanki','rampur','lucknow')
        OR rank_outcome BETWEEN 1 AND 10
        OR rank_outcome BETWEEN 14 AND 20
      )
    ORDER BY rank_outcome NULLS LAST, score DESC
  `);
  console.log(r.rows);

  const dups = await query(`
    SELECT rank_outcome, COUNT(*)::int AS n,
           array_agg(district_name ORDER BY district_name) AS names
    FROM indicator_outcome_district
    WHERE year = 2026 AND month = 5
    GROUP BY rank_outcome
    HAVING COUNT(*) > 1
  `);
  console.log('dup ranks', dups.rows);

  const prat = await query(`
    SELECT district_name, district_lgd, index_outcome::float, rank_outcome
    FROM indicator_outcome_district
    WHERE year = 2026 AND month = 5 AND lower(district_name) LIKE '%pratap%'
  `);
  console.log('pratapgarh', prat.rows);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
