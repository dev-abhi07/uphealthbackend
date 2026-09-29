const { pool, query } = require('../db/pool');

/**
 * Replace all district outcome rows for a year/month with the given API rows.
 * Always stores under the requested month/year/period_label (ignores row.month drift).
 */
async function upsertDistrictOutcomeRows(rows, { month, year, period_label, source = 'api' } = {}) {
  if (!rows.length) return { district_count: 0, value_count: 0 };

  const m = Number(month);
  const y = Number(year);
  const label = period_label || `${y}-${String(m).padStart(2, '0')}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `DELETE FROM indicator_outcome_district_value WHERE year = $1 AND month = $2`,
      [y, m]
    );
    await client.query(
      `DELETE FROM indicator_outcome_district WHERE year = $1 AND month = $2`,
      [y, m]
    );

    let valueCount = 0;
    // Prefer master district.name by LGD so ranking labels match map / Excel
    const { rows: masterRows } = await client.query(
      `SELECT lgd_code::text AS lgd, name FROM district WHERE is_active = TRUE`
    );
    const masterByLgd = new Map(masterRows.map((r) => [String(r.lgd), r.name]));

    for (const r of rows) {
      const lgd = Number(r.districtLgdCode);
      if (!Number.isFinite(lgd)) continue;
      const districtName = masterByLgd.get(String(lgd)) || r.districtName;

      await client.query(
        `
        INSERT INTO indicator_outcome_district (
          external_id, district_name, district_lgd, month, year, period_label,
          index_outcome, rank_outcome, source, synced_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
        `,
        [
          r.id != null ? Number(r.id) : null,
          districtName,
          lgd,
          m,
          y,
          label,
          r.indexOutcome,
          r.rankOutcome,
          source,
        ]
      );

      const inds = r.indicators || {};
      for (const [code, rawVal] of Object.entries(inds)) {
        const indCode = String(code).trim().toUpperCase();
        if (!/^IND\d{3}$/.test(indCode)) continue;
        const val = rawVal == null || rawVal === '' ? null : Number(rawVal);
        await client.query(
          `
          INSERT INTO indicator_outcome_district_value (
            year, month, period_label, district_lgd, indicator_code, value, synced_at
          ) VALUES ($1,$2,$3,$4,$5,$6,NOW())
          `,
          [y, m, label, lgd, indCode, Number.isFinite(val) ? val : null]
        );
        valueCount += 1;
      }
    }

    await client.query(
      `
      INSERT INTO indicator_outcome_sync_log (
        geo_level, year, month, period_label, status, source, row_count
      ) VALUES ('district', $1, $2, $3, 'ok', $4, $5)
      `,
      [y, m, label, source, rows.length]
    );

    await client.query('COMMIT');
    return { district_count: rows.length, value_count: valueCount };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}


async function logSyncFailure({ year, month, period_label, source, error_message }) {
  await query(
    `
    INSERT INTO indicator_outcome_sync_log (
      geo_level, year, month, period_label, status, source, error_message
    ) VALUES ('district', $1, $2, $3, 'error', $4, $5)
    `,
    [year, month, period_label, source || 'api', String(error_message || '').slice(0, 2000)]
  );
}

async function hasDistrictOutcomePeriod(year, month) {
  const { rows } = await query(
    `SELECT 1 FROM indicator_outcome_district WHERE year = $1 AND month = $2 LIMIT 1`,
    [year, month]
  );
  return rows.length > 0;
}

async function listOutcomePeriods() {
  const { rows } = await query(
    `
    SELECT year, month, period_label,
           COUNT(*)::int AS district_count,
           MAX(synced_at) AS synced_at
    FROM indicator_outcome_district
    GROUP BY year, month, period_label
    ORDER BY year DESC, month DESC
    `
  );
  return rows;
}

async function getDistrictHeaders({ year, month, districtLgd, divisionId } = {}) {
  const params = [year, month];
  let sql = `
    SELECT o.external_id, o.district_lgd, o.month, o.year, o.period_label,
           o.index_outcome, o.rank_outcome, o.source, o.synced_at, o.updated_at,
           COALESCE(d.name, o.district_name) AS district_name,
           o.district_name AS source_district_name,
           d.id AS district_id, d.lgd_code AS master_lgd_code,
           d.division_id, div.name AS division_name, div.code AS division_code
    FROM indicator_outcome_district o
    LEFT JOIN district d ON d.lgd_code::text = o.district_lgd::text
    LEFT JOIN division div ON div.id = d.division_id
    WHERE o.year = $1 AND o.month = $2
  `;
  if (districtLgd != null) {
    params.push(String(districtLgd));
    sql += ` AND o.district_lgd::text = $${params.length}`;
  }
  if (divisionId != null) {
    params.push(Number(divisionId));
    sql += ` AND d.division_id = $${params.length}`;
  }
  sql += ` ORDER BY o.rank_outcome NULLS LAST, COALESCE(d.name, o.district_name)`;
  const { rows } = await query(sql, params);
  return rows;
}

async function getDistrictValues({ year, month, indicatorCode, districtLgd, divisionId } = {}) {
  const params = [year, month];
  let sql = `
    SELECT v.*, o.district_name, o.rank_outcome, o.index_outcome,
           d.division_id, div.name AS division_name
    FROM indicator_outcome_district_value v
    JOIN indicator_outcome_district o
      ON o.year = v.year AND o.month = v.month AND o.district_lgd = v.district_lgd
    LEFT JOIN district d ON d.lgd_code = v.district_lgd::text
    LEFT JOIN division div ON div.id = d.division_id
    WHERE v.year = $1 AND v.month = $2
  `;
  if (indicatorCode) {
    params.push(String(indicatorCode).toUpperCase());
    sql += ` AND v.indicator_code = $${params.length}`;
  }
  if (districtLgd != null) {
    params.push(Number(districtLgd));
    sql += ` AND v.district_lgd = $${params.length}`;
  }
  if (divisionId != null) {
    params.push(Number(divisionId));
    sql += ` AND d.division_id = $${params.length}`;
  }
  sql += ` ORDER BY o.rank_outcome NULLS LAST, v.district_lgd`;
  const { rows } = await query(sql, params);
  return rows;
}

async function getIndicatorAverages({ year, month, divisionId, districtLgd } = {}) {
  const params = [year, month];
  let sql = `
    SELECT v.indicator_code,
           ROUND(AVG(v.value)::numeric, 4) AS avg_value,
           COUNT(*)::int AS n
    FROM indicator_outcome_district_value v
    LEFT JOIN district d ON d.lgd_code::text = v.district_lgd::text
    WHERE v.year = $1 AND v.month = $2 AND v.value IS NOT NULL
  `;
  if (divisionId != null) {
    params.push(Number(divisionId));
    sql += ` AND d.division_id = $${params.length}`;
  }
  if (districtLgd != null) {
    params.push(Number(districtLgd));
    sql += ` AND v.district_lgd = $${params.length}`;
  }
  sql += ` GROUP BY v.indicator_code ORDER BY v.indicator_code`;
  const { rows } = await query(sql, params);
  return rows;
}

/**
 * Statewide / scoped composite average from district index_outcome.
 */
async function getCompositeAverage({ year, month, divisionId, districtLgd } = {}) {
  const params = [year, month];
  let sql = `
    SELECT ROUND(AVG(o.index_outcome)::numeric, 4) AS avg_value,
           COUNT(*)::int AS n
    FROM indicator_outcome_district o
    LEFT JOIN district d ON d.lgd_code::text = o.district_lgd::text
    WHERE o.year = $1 AND o.month = $2 AND o.index_outcome IS NOT NULL
  `;
  if (divisionId != null) {
    params.push(Number(divisionId));
    sql += ` AND d.division_id = $${params.length}`;
  }
  if (districtLgd != null) {
    params.push(Number(districtLgd));
    sql += ` AND o.district_lgd = $${params.length}`;
  }
  const { rows } = await query(sql, params);
  return rows[0] || { avg_value: null, n: 0 };
}

module.exports = {
  upsertDistrictOutcomeRows,
  logSyncFailure,
  hasDistrictOutcomePeriod,
  listOutcomePeriods,
  getDistrictHeaders,
  getDistrictValues,
  getIndicatorAverages,
  getCompositeAverage,
};
