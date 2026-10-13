const { pool, query } = require('../db/pool');

/**
 * Replace all block outcome rows for a year/month with the given API rows.
 */
async function upsertBlockOutcomeRows(rows, { month, year, period_label, source = 'api' } = {}) {
  if (!rows.length) return { block_count: 0, value_count: 0 };

  const m = Number(month);
  const y = Number(year);
  const label = period_label || `${y}-${String(m).padStart(2, '0')}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `DELETE FROM indicator_outcome_block_value WHERE year = $1 AND month = $2`,
      [y, m]
    );
    await client.query(
      `DELETE FROM indicator_outcome_block WHERE year = $1 AND month = $2`,
      [y, m]
    );

    const { rows: masterDistricts } = await client.query(
      `SELECT lgd_code::text AS lgd, name FROM district WHERE is_active = TRUE`
    );
    const districtByLgd = new Map(masterDistricts.map((r) => [String(r.lgd), r.name]));

    const { rows: masterBlocks } = await client.query(
      `SELECT lgd_code::text AS lgd, name FROM block WHERE is_active = TRUE`
    );
    const blockByLgd = new Map(masterBlocks.map((r) => [String(r.lgd), r.name]));

    let valueCount = 0;
    for (const r of rows) {
      const blockLgd = Number(r.blockLgdCode);
      if (!Number.isFinite(blockLgd)) continue;
      const districtLgd =
        r.districtLgdCode != null && Number.isFinite(Number(r.districtLgdCode))
          ? Number(r.districtLgdCode)
          : null;
      const blockName = blockByLgd.get(String(blockLgd)) || r.blockName;
      const districtName =
        (districtLgd != null ? districtByLgd.get(String(districtLgd)) : null) ||
        r.districtName ||
        '';

      await client.query(
        `
        INSERT INTO indicator_outcome_block (
          external_id, district_name, district_lgd, block_name, block_lgd,
          month, year, period_label, index_outcome, rank_outcome, source, synced_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
        `,
        [
          r.id != null ? Number(r.id) : null,
          districtName || 'Unknown',
          districtLgd != null ? districtLgd : 0,
          blockName,
          blockLgd,
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
          INSERT INTO indicator_outcome_block_value (
            year, month, period_label, block_lgd, district_lgd, indicator_code, value, synced_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
          `,
          [
            y,
            m,
            label,
            blockLgd,
            districtLgd,
            indCode,
            Number.isFinite(val) ? val : null,
          ]
        );
        valueCount += 1;
      }
    }

    await client.query(
      `
      INSERT INTO indicator_outcome_sync_log (
        geo_level, year, month, period_label, status, source, row_count
      ) VALUES ('block', $1, $2, $3, 'ok', $4, $5)
      `,
      [y, m, label, source, rows.length]
    );

    await client.query('COMMIT');
    return { block_count: rows.length, value_count: valueCount };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function logBlockSyncFailure({ year, month, period_label, source, error_message }) {
  await query(
    `
    INSERT INTO indicator_outcome_sync_log (
      geo_level, year, month, period_label, status, source, error_message
    ) VALUES ('block', $1, $2, $3, 'error', $4, $5)
    `,
    [year, month, period_label, source || 'api', String(error_message || '').slice(0, 2000)]
  );
}

async function hasBlockOutcomePeriod(year, month) {
  const { rows } = await query(
    `SELECT 1 FROM indicator_outcome_block WHERE year = $1 AND month = $2 LIMIT 1`,
    [year, month]
  );
  return rows.length > 0;
}

async function listBlockOutcomePeriods() {
  const { rows } = await query(
    `
    SELECT year, month, period_label,
           COUNT(*)::int AS block_count,
           MAX(synced_at) AS synced_at
    FROM indicator_outcome_block
    GROUP BY year, month, period_label
    ORDER BY year DESC, month DESC
    `
  );
  return rows;
}

async function getBlockHeaders({ year, month, districtLgd, blockLgd } = {}) {
  const params = [year, month];
  let sql = `
    SELECT o.external_id, o.district_lgd, o.block_lgd, o.month, o.year, o.period_label,
           o.index_outcome, o.rank_outcome, o.source, o.synced_at, o.updated_at,
           COALESCE(b.name, o.block_name) AS block_name,
           COALESCE(d.name, o.district_name) AS district_name,
           o.block_name AS source_block_name,
           o.district_name AS source_district_name,
           b.id AS block_id, d.id AS district_id, d.division_id,
           div.name AS division_name, div.code AS division_code
    FROM indicator_outcome_block o
    LEFT JOIN block b ON b.lgd_code::text = o.block_lgd::text
    LEFT JOIN district d ON d.lgd_code::text = o.district_lgd::text
    LEFT JOIN division div ON div.id = d.division_id
    WHERE o.year = $1 AND o.month = $2
  `;
  if (districtLgd != null) {
    params.push(String(districtLgd));
    sql += ` AND o.district_lgd::text = $${params.length}`;
  }
  if (blockLgd != null) {
    params.push(String(blockLgd));
    sql += ` AND o.block_lgd::text = $${params.length}`;
  }
  sql += ` ORDER BY o.rank_outcome NULLS LAST, COALESCE(b.name, o.block_name)`;
  const { rows } = await query(sql, params);
  return rows;
}

async function getBlockValues({ year, month, indicatorCode, districtLgd, blockLgd } = {}) {
  const params = [year, month];
  let sql = `
    SELECT v.*, o.block_name, o.district_name, o.rank_outcome, o.index_outcome,
           o.district_lgd AS header_district_lgd
    FROM indicator_outcome_block_value v
    JOIN indicator_outcome_block o
      ON o.year = v.year AND o.month = v.month AND o.block_lgd = v.block_lgd
    WHERE v.year = $1 AND v.month = $2
  `;
  if (indicatorCode) {
    params.push(String(indicatorCode).toUpperCase());
    sql += ` AND v.indicator_code = $${params.length}`;
  }
  if (districtLgd != null) {
    params.push(Number(districtLgd));
    sql += ` AND COALESCE(v.district_lgd, o.district_lgd) = $${params.length}`;
  }
  if (blockLgd != null) {
    params.push(Number(blockLgd));
    sql += ` AND v.block_lgd = $${params.length}`;
  }
  sql += ` ORDER BY o.rank_outcome NULLS LAST, v.block_lgd`;
  const { rows } = await query(sql, params);
  return rows;
}

async function getBlockIndicatorAverages({ year, month, districtLgd, blockLgd } = {}) {
  const params = [year, month];
  let sql = `
    SELECT v.indicator_code,
           ROUND(AVG(v.value)::numeric, 4) AS avg_value,
           COUNT(*)::int AS n
    FROM indicator_outcome_block_value v
    WHERE v.year = $1 AND v.month = $2 AND v.value IS NOT NULL
  `;
  if (blockLgd != null) {
    params.push(Number(blockLgd));
    sql += ` AND v.block_lgd = $${params.length}`;
  } else if (districtLgd != null) {
    params.push(Number(districtLgd));
    sql += ` AND v.district_lgd = $${params.length}`;
  }
  sql += ` GROUP BY v.indicator_code ORDER BY v.indicator_code`;
  const { rows } = await query(sql, params);
  return rows;
}

async function getBlockCompositeAverage({ year, month, districtLgd, blockLgd } = {}) {
  const params = [year, month];
  let sql = `
    SELECT ROUND(AVG(o.index_outcome)::numeric, 4) AS avg_value,
           COUNT(*)::int AS n
    FROM indicator_outcome_block o
    WHERE o.year = $1 AND o.month = $2 AND o.index_outcome IS NOT NULL
  `;
  if (districtLgd != null) {
    params.push(Number(districtLgd));
    sql += ` AND o.district_lgd = $${params.length}`;
  }
  if (blockLgd != null) {
    params.push(Number(blockLgd));
    sql += ` AND o.block_lgd = $${params.length}`;
  }
  const { rows } = await query(sql, params);
  return rows[0] || { avg_value: null, n: 0 };
}

module.exports = {
  upsertBlockOutcomeRows,
  logBlockSyncFailure,
  hasBlockOutcomePeriod,
  listBlockOutcomePeriods,
  getBlockHeaders,
  getBlockValues,
  getBlockIndicatorAverages,
  getBlockCompositeAverage,
};
