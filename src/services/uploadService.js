const { pool, query } = require('../db/pool');
const { parseUploadWorkbook } = require('../upload/excelParser');
const { getTemplate } = require('../upload/templateRegistry');

function makeBatchNo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `UP${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${Math.floor(Math.random() * 900 + 100)}`;
}

async function resolvePeriod(periodLabel, client) {
  const q = client || { query };
  const { rows } = await q.query(
    `SELECT id, label FROM time_period WHERE label = $1 LIMIT 1`,
    [periodLabel]
  );
  if (!rows[0]) {
    const err = new Error(`Unknown period: ${periodLabel}. Create time_period first.`);
    err.status = 400;
    throw err;
  }
  return rows[0];
}

function ymFromDateStr(dateStr) {
  const s = String(dateStr || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s.slice(0, 7); // YYYY-MM
}

function labelFromDateRange(fromDate, toDate) {
  const fromYm = ymFromDateStr(fromDate);
  const toYm = ymFromDateStr(toDate);
  if (!fromYm || !toYm) return null;
  return fromYm === toYm ? fromYm : `${fromYm}_to_${toYm}`;
}

/**
 * Resolve period for download/upload from either:
 *   - period=2026-05
 *   - from_date=2026-06-01&to_date=2026-07-31
 * Creates time_period row if missing (so upload can publish later).
 */
async function resolvePeriodInput({ period, fromDate, toDate }, client) {
  const q = client || { query };
  const explicit = period != null ? String(period).trim() : '';
  if (explicit) {
    return resolvePeriod(explicit, q);
  }

  const from = fromDate != null ? String(fromDate).trim().slice(0, 10) : '';
  const to = toDate != null ? String(toDate).trim().slice(0, 10) : '';
  if (!from || !to) {
    const err = new Error(
      'period is required (e.g. 2026-05), or pass from_date and to_date (e.g. 2026-06-01 & 2026-07-31)'
    );
    err.status = 400;
    throw err;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const err = new Error('from_date / to_date must be YYYY-MM-DD');
    err.status = 400;
    throw err;
  }
  if (from > to) {
    const err = new Error('from_date must be on or before to_date');
    err.status = 400;
    throw err;
  }

  // Exact date-range match
  const exact = await q.query(
    `
    SELECT id, label FROM time_period
    WHERE start_date::date = $1::date AND end_date::date = $2::date
    ORDER BY id
    LIMIT 1
    `,
    [from, to]
  );
  if (exact.rows[0]) return exact.rows[0];

  const label = labelFromDateRange(from, to);
  const byLabel = await q.query(
    `SELECT id, label FROM time_period WHERE label = $1 LIMIT 1`,
    [label]
  );
  if (byLabel.rows[0]) return byLabel.rows[0];

  const periodType = from.slice(0, 7) === to.slice(0, 7) ? 'monthly' : 'cumulative';
  const inserted = await q.query(
    `
    INSERT INTO time_period (period_type, label, start_date, end_date, is_active)
    VALUES ($1, $2, $3::date, $4::date, TRUE)
    ON CONFLICT (period_type, label) DO UPDATE
      SET start_date = EXCLUDED.start_date,
          end_date = EXCLUDED.end_date,
          is_active = TRUE
    RETURNING id, label
    `,
    [periodType, label, from, to]
  );
  return inserted.rows[0];
}

async function loadDeMap(deCodes, client) {
  const q = client || { query };
  const { rows } = await q.query(
    `SELECT id, code, source_id FROM data_element WHERE code = ANY($1::text[])`,
    [deCodes]
  );
  const map = {};
  for (const r of rows) map[r.code] = r;
  return map;
}

async function resolveDistrictByLgd(lgd, client) {
  const { rows } = await client.query(
    `SELECT id, name, lgd_code, division_id FROM district WHERE lgd_code::text = $1 LIMIT 1`,
    [String(lgd)]
  );
  return rows[0] || null;
}

async function resolveBlockByLgd(lgd, districtId, client) {
  if (districtId) {
    const { rows } = await client.query(
      `
      SELECT b.id, b.name, b.lgd_code, b.district_id, d.division_id
      FROM block b
      JOIN district d ON d.id = b.district_id
      WHERE b.lgd_code::text = $1 AND b.district_id = $2
      LIMIT 1
      `,
      [String(lgd), districtId]
    );
    return rows[0] || null;
  }
  const { rows } = await client.query(
    `
    SELECT b.id, b.name, b.lgd_code, b.district_id, d.division_id
    FROM block b
    JOIN district d ON d.id = b.district_id
    WHERE b.lgd_code::text = $1
    LIMIT 1
    `,
    [String(lgd)]
  );
  return rows[0] || null;
}

async function resolveFacilityByHfr(hfr, districtId, blockId, facilityName, client) {
  if (hfr) {
    const code = String(hfr).trim();
    // 1) Real HFR via facility_code_master
    {
      const params = [code];
      let sql = `
        SELECT f.id, f.name, f.block_id, f.district_id, f.division_id, fcm.hfr_code
        FROM facility_code_master fcm
        JOIN facility f
          ON LOWER(f.name) = LOWER(fcm.facility_name)
        WHERE UPPER(fcm.hfr_code) = UPPER($1)
      `;
      if (districtId) {
        params.push(districtId);
        sql += ` AND f.district_id = $${params.length}`;
      }
      if (blockId) {
        params.push(blockId);
        sql += ` AND f.block_id = $${params.length}`;
      }
      sql += ' ORDER BY f.id LIMIT 1';
      const { rows } = await client.query(sql, params);
      if (rows[0]) return rows[0];
    }

    // 2) Template may have facility.facility_code in HFR column
    {
      const params = [code];
      let sql = `
        SELECT f.id, f.name, f.block_id, f.district_id, f.division_id, f.facility_code AS hfr_code
        FROM facility f
        WHERE UPPER(f.facility_code) = UPPER($1)
      `;
      if (districtId) {
        params.push(districtId);
        sql += ` AND f.district_id = $${params.length}`;
      }
      if (blockId) {
        params.push(blockId);
        sql += ` AND f.block_id = $${params.length}`;
      }
      sql += ' ORDER BY f.id LIMIT 1';
      const { rows } = await client.query(sql, params);
      if (rows[0]) return rows[0];
    }
  }

  if (facilityName) {
    const params = [facilityName];
    let sql = `
      SELECT id, name, block_id, district_id, division_id
      FROM facility
      WHERE LOWER(name) = LOWER($1)
    `;
    if (districtId) {
      params.push(districtId);
      sql += ` AND district_id = $${params.length}`;
    }
    if (blockId) {
      params.push(blockId);
      sql += ` AND block_id = $${params.length}`;
    }
    sql += ' LIMIT 1';
    const { rows } = await client.query(sql, params);
    return rows[0] || null;
  }
  return null;
}

/** One-shot facility lookup map for filled upload rows */
async function preloadFacilityLookup(rows, client) {
  const codes = [
    ...new Set(
      rows
        .map((r) => (r.hfrCode ? String(r.hfrCode).trim().toUpperCase() : ''))
        .filter(Boolean)
    ),
  ];
  const names = [
    ...new Set(
      rows
        .map((r) => (r.facilityName ? String(r.facilityName).trim().toLowerCase() : ''))
        .filter(Boolean)
    ),
  ];
  if (!codes.length && !names.length) {
    return { byCode: new Map(), byName: new Map() };
  }

  const { rows: facRows } = await client.query(
    `
    SELECT
      f.id, f.name, f.block_id, f.district_id, f.division_id,
      UPPER(NULLIF(fcm.hfr_code, '')) AS hfr_code,
      UPPER(NULLIF(f.facility_code, '')) AS facility_code
    FROM facility f
    LEFT JOIN facility_code_master fcm
      ON LOWER(fcm.facility_name) = LOWER(f.name)
    WHERE (
        cardinality($1::text[]) > 0
        AND (
          UPPER(COALESCE(fcm.hfr_code, '')) = ANY($1::text[])
          OR UPPER(COALESCE(f.facility_code, '')) = ANY($1::text[])
        )
      )
      OR (
        cardinality($2::text[]) > 0
        AND LOWER(f.name) = ANY($2::text[])
      )
    `,
    [codes, names]
  );

  const byCode = new Map();
  const byName = new Map();
  for (const f of facRows) {
    if (f.hfr_code) byCode.set(f.hfr_code, f);
    if (f.facility_code) byCode.set(f.facility_code, f);
    byName.set(String(f.name).toLowerCase(), f);
  }
  return { byCode, byName };
}

async function preloadDistrictMap(client) {
  const { rows } = await client.query(
    `SELECT id, name, lgd_code, division_id FROM district`
  );
  const byId = new Map();
  const byLgd = new Map();
  for (const d of rows) {
    byId.set(Number(d.id), d);
    if (d.lgd_code != null) byLgd.set(String(d.lgd_code), d);
  }
  return { byId, byLgd };
}

async function preloadBlockMap(lgds, client) {
  if (!lgds.length) return new Map();
  const { rows } = await client.query(
    `
    SELECT b.id, b.name, b.lgd_code, b.district_id, d.division_id
    FROM block b
    JOIN district d ON d.id = b.district_id
    WHERE b.lgd_code::text = ANY($1::text[])
    `,
    [lgds.map(String)]
  );
  const byLgd = new Map();
  for (const b of rows) byLgd.set(String(b.lgd_code), b);
  return byLgd;
}

async function bulkInsertUploadRows(client, batchId, indicatorId, staging) {
  const chunkSize = 300;
  for (let i = 0; i < staging.length; i += chunkSize) {
    const part = staging.slice(i, i + chunkSize);
    const params = [];
    const values = [];
    let p = 1;
    for (const s of part) {
      values.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++}::jsonb)`
      );
      params.push(
        batchId,
        s.row_no,
        indicatorId,
        s.data_element_id,
        s.geo_level,
        s.division_id,
        s.district_id,
        s.block_id,
        s.facility_id,
        s.external_geo_code,
        s.column_key,
        s.value_num,
        s.validation_status,
        s.validation_errors ? JSON.stringify(s.validation_errors) : null
      );
    }
    await client.query(
      `
      INSERT INTO upload_row (
        batch_id, row_no, indicator_id, data_element_id, geo_level,
        division_id, district_id, block_id, facility_id,
        external_geo_code, column_key, value_num, validation_status, validation_errors
      ) VALUES ${values.join(',')}
      `,
      params
    );
  }
}

async function bulkInsertFacts(client, staging, timePeriodId, batchIdTag) {
  const ok = staging.filter((s) => s.validation_status === 'ok' && s.value_num !== null);
  let factCount = 0;
  const chunkSize = 300;
  for (let i = 0; i < ok.length; i += chunkSize) {
    const part = ok.slice(i, i + chunkSize);
    const params = [];
    const values = [];
    let p = 1;
    for (const s of part) {
      values.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`
      );
      params.push(
        s.data_element_id,
        s.source_id,
        s.geo_level,
        s.division_id,
        s.district_id,
        s.block_id,
        s.facility_id,
        timePeriodId,
        s.value_num,
        batchIdTag
      );
    }
    await client.query(
      `
      INSERT INTO fact_component_value (
        data_element_id, source_id, geo_level, division_id, district_id,
        block_id, facility_id, time_period_id, value_num, batch_id
      ) VALUES ${values.join(',')}
      `,
      params
    );
    factCount += part.length;
  }
  return factCount;
}

function isStateAdmin(user) {
  return (user.roles || []).includes('state_admin');
}

function userMayAccessDistrict(user, districtId) {
  if (isStateAdmin(user)) return true;
  const geo = user.geo || [];
  return geo.some((g) => Number(g.district_id) === Number(districtId));
}

/**
 * Recompute KPI rows for supported indicators from fact_component_value.
 */
async function recomputeKpi(client, {
  indicatorCode,
  indicatorId,
  timePeriodId,
  districtId,
  divisionId,
  grain,
}) {
  // wipe existing kpi for this indicator+district+period (block+district)
  await client.query(
    `
    DELETE FROM kpi_value
    WHERE indicator_id = $1
      AND time_period_id = $2
      AND district_id = $3
    `,
    [indicatorId, timePeriodId, districtId]
  );

  if (indicatorCode === 'IND_ANC_1ST_TRIMESTER_PCT') {
    await client.query(
      `
      WITH nums AS (
        SELECT block_id, SUM(value_num) AS n
        FROM fact_component_value f
        JOIN data_element d ON d.id = f.data_element_id AND d.code = 'E4'
        WHERE f.district_id = $1::bigint AND f.time_period_id = $2::bigint AND f.geo_level = 'block'
        GROUP BY block_id
      ),
      dens AS (
        SELECT block_id, SUM(value_num) AS d
        FROM fact_component_value f
        JOIN data_element d ON d.id = f.data_element_id AND d.code = 'E5'
        WHERE f.district_id = $1::bigint AND f.time_period_id = $2::bigint AND f.geo_level = 'block'
        GROUP BY block_id
      ),
      blocks AS (
        SELECT COALESCE(n.block_id, dens.block_id) AS block_id,
               COALESCE(n.n, 0) AS numerator,
               COALESCE(dens.d, 0) AS denominator
        FROM nums n
        FULL OUTER JOIN dens ON dens.block_id = n.block_id
        WHERE COALESCE(dens.d, 0) > 0
      )
      INSERT INTO kpi_value (indicator_id, geo_level, division_id, district_id, block_id, time_period_id, numerator, denominator, value)
      SELECT $3::bigint, 'block', $4::bigint, $1::bigint, block_id, $2::bigint, numerator, denominator,
             ROUND((numerator / denominator) * 100, 2)
      FROM blocks
      UNION ALL
      SELECT $3::bigint, 'district', $4::bigint, $1::bigint, NULL, $2::bigint, SUM(numerator), SUM(denominator),
             ROUND((SUM(numerator) / NULLIF(SUM(denominator), 0)) * 100, 2)
      FROM blocks
      `,
      [districtId, timePeriodId, indicatorId, divisionId]
    );
    return;
  }

  if (indicatorCode === 'IND_INSTITUTIONAL_DELIVERY_PCT') {
    await client.query(
      `
      WITH e8 AS (
        SELECT block_id, SUM(value_num) AS v FROM fact_component_value f
        JOIN data_element d ON d.id = f.data_element_id AND d.code = 'E8'
        WHERE f.district_id=$1::bigint AND f.time_period_id=$2::bigint AND f.geo_level='block' GROUP BY block_id
      ),
      e9 AS (
        SELECT block_id, SUM(value_num) AS v FROM fact_component_value f
        JOIN data_element d ON d.id = f.data_element_id AND d.code = 'E9'
        WHERE f.district_id=$1::bigint AND f.time_period_id=$2::bigint AND f.geo_level='block' GROUP BY block_id
      ),
      e10 AS (
        SELECT block_id, SUM(value_num) AS v FROM fact_component_value f
        JOIN data_element d ON d.id = f.data_element_id AND d.code = 'E10'
        WHERE f.district_id=$1::bigint AND f.time_period_id=$2::bigint AND f.geo_level='block' GROUP BY block_id
      ),
      blocks AS (
        SELECT COALESCE(e8.block_id, e9.block_id, e10.block_id) AS block_id,
               COALESCE(e8.v,0) + COALESCE(e9.v,0) AS numerator,
               COALESCE(e10.v,0) AS denominator
        FROM e8
        FULL JOIN e9 ON e9.block_id = e8.block_id
        FULL JOIN e10 ON e10.block_id = COALESCE(e8.block_id, e9.block_id)
        WHERE COALESCE(e10.v,0) > 0
      )
      INSERT INTO kpi_value (indicator_id, geo_level, division_id, district_id, block_id, time_period_id, numerator, denominator, value)
      SELECT $3::bigint,'block',$4::bigint,$1::bigint,block_id,$2::bigint,numerator,denominator, ROUND((numerator/denominator)*100,2) FROM blocks
      UNION ALL
      SELECT $3::bigint,'district',$4::bigint,$1::bigint,NULL,$2::bigint,SUM(numerator),SUM(denominator),
             ROUND((SUM(numerator)/NULLIF(SUM(denominator),0))*100,2) FROM blocks
      `,
      [districtId, timePeriodId, indicatorId, divisionId]
    );
    return;
  }

  if (indicatorCode === 'IND_ANC_4PLUS_PCT') {
    await client.query(
      `
      WITH a AS (
        SELECT block_id, SUM(value_num) AS v FROM fact_component_value f
        JOIN data_element d ON d.id=f.data_element_id AND d.code='E6'
        WHERE f.district_id=$1::bigint AND f.time_period_id=$2::bigint AND f.geo_level='block' GROUP BY block_id
      ),
      b AS (
        SELECT block_id, SUM(value_num) AS v FROM fact_component_value f
        JOIN data_element d ON d.id=f.data_element_id AND d.code='E_HB4_TEST'
        WHERE f.district_id=$1::bigint AND f.time_period_id=$2::bigint AND f.geo_level='block' GROUP BY block_id
      ),
      ela AS (
        SELECT block_id, SUM(value_num) AS v FROM fact_component_value f
        JOIN data_element d ON d.id=f.data_element_id AND d.code='E_ELA_PW'
        WHERE f.district_id=$1::bigint AND f.time_period_id=$2::bigint AND f.geo_level='block' GROUP BY block_id
      ),
      blocks AS (
        SELECT COALESCE(a.block_id,b.block_id,ela.block_id) AS block_id,
               COALESCE(a.v,0) AS a1,
               COALESCE(b.v,0) AS b1,
               COALESCE(ela.v,0) AS ela
        FROM a
        FULL JOIN b ON b.block_id=a.block_id
        FULL JOIN ela ON ela.block_id=COALESCE(a.block_id,b.block_id)
        WHERE COALESCE(ela.v,0) > 0
      )
      INSERT INTO kpi_value (indicator_id, geo_level, division_id, district_id, block_id, time_period_id, numerator, denominator, value)
      SELECT $3::bigint,'block',$4::bigint,$1::bigint,block_id,$2::bigint,
             (a1+b1), (2*(ela/12.0)),
             ROUND((((a1/(ela/12.0)) + (b1/(ela/12.0))) / 2.0) * 100, 2)
      FROM blocks
      `,
      [districtId, timePeriodId, indicatorId, divisionId]
    );
    await client.query(
      `
      WITH a AS (
        SELECT COALESCE(SUM(value_num),0) AS v FROM fact_component_value f
        JOIN data_element d ON d.id=f.data_element_id AND d.code='E6'
        WHERE f.district_id=$1::bigint AND f.time_period_id=$2::bigint AND f.geo_level='block'
      ),
      b AS (
        SELECT COALESCE(SUM(value_num),0) AS v FROM fact_component_value f
        JOIN data_element d ON d.id=f.data_element_id AND d.code='E_HB4_TEST'
        WHERE f.district_id=$1::bigint AND f.time_period_id=$2::bigint AND f.geo_level='block'
      ),
      ela AS (
        SELECT COALESCE(SUM(value_num),0) AS v FROM fact_component_value f
        JOIN data_element d ON d.id=f.data_element_id AND d.code='E_ELA_PW'
        WHERE f.district_id=$1::bigint AND f.time_period_id=$2::bigint AND f.geo_level='block'
      )
      INSERT INTO kpi_value (indicator_id, geo_level, division_id, district_id, block_id, time_period_id, numerator, denominator, value)
      SELECT $3::bigint,'district',$4::bigint,$1::bigint,NULL,$2::bigint,
             (a.v+b.v), (2*(ela.v/12.0)),
             ROUND((((a.v/(ela.v/12.0)) + (b.v/(ela.v/12.0))) / 2.0) * 100, 2)
      FROM a, b, ela
      WHERE ela.v > 0
      `,
      [districtId, timePeriodId, indicatorId, divisionId]
    );
    return;
  }

  if (indicatorCode === 'IND_CHC_FRU_CSECTION_PCT') {
    await client.query(
      `
      WITH fru AS (
        SELECT facility_id
        FROM fact_component_value f
        JOIN data_element d ON d.id=f.data_element_id AND d.code='DE_UPKSK_FRU_D'
        WHERE f.district_id=$1::bigint AND f.time_period_id=$2::bigint AND f.geo_level='facility' AND f.value_num >= 1
      ),
      csec AS (
        SELECT facility_id, SUM(value_num) AS v
        FROM fact_component_value f
        JOIN data_element d ON d.id=f.data_element_id AND d.code='DE_V65_CSECTION'
        WHERE f.district_id=$1::bigint AND f.time_period_id=$2::bigint AND f.geo_level='facility'
        GROUP BY facility_id
      ),
      designated AS (
        SELECT facility_id FROM fru
        UNION
        SELECT facility_id FROM csec WHERE NOT EXISTS (SELECT 1 FROM fru)
      ),
      calc AS (
        SELECT
          (SELECT COUNT(*) FROM designated) AS den,
          (SELECT COUNT(*) FROM designated d
            JOIN csec c ON c.facility_id = d.facility_id AND c.v >= 10) AS num
      )
      INSERT INTO kpi_value (indicator_id, geo_level, division_id, district_id, block_id, time_period_id, numerator, denominator, value)
      SELECT $3::bigint,'district',$4::bigint,$1::bigint,NULL,$2::bigint, num::numeric, den::numeric,
             CASE WHEN den>0 THEN ROUND((num::numeric/den)*100,2) ELSE NULL END
      FROM calc
      WHERE den > 0
      `,
      [districtId, timePeriodId, indicatorId, divisionId]
    );
  }
}

async function processUpload({
  buffer,
  originalname,
  user,
  indicatorCode,
  period,
  fromDate,
  toDate,
  level,
  publish = true,
}) {
  if (!isStateAdmin(user)) {
    const err = new Error(
      'State upload workflow is only available for state_admin (not DU/BU/FU)'
    );
    err.status = 403;
    throw err;
  }

  const parsed = parseUploadWorkbook(buffer, { indicatorCode, level });
  const template = parsed.template;
  const grain = template.grain || parsed.meta.grain || 'district';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tp = await resolvePeriodInput(
      {
        period: period || parsed.meta.period,
        fromDate,
        toDate,
      },
      client
    );
    const periodLabel = tp.label;
    const { rows: indRows } = await client.query(
      `SELECT id, code FROM indicator WHERE code = $1`,
      [template.code]
    );
    if (!indRows[0]) {
      const err = new Error(`Indicator not found in DB: ${template.code}`);
      err.status = 400;
      throw err;
    }
    const indicator = indRows[0];

    const deMap = await loadDeMap(
      template.valueColumns.map((c) => c.deCode),
      client
    );
    for (const c of template.valueColumns) {
      if (!deMap[c.deCode]) {
        const err = new Error(`Data element missing in DB: ${c.deCode}`);
        err.status = 500;
        throw err;
      }
    }

    const filledRows = parsed.dataRows.filter((r) => r.hasAnyValue);
    if (!filledRows.length) {
      const err = new Error(
        'No data values found in Excel. Fill yellow value columns and upload again.'
      );
      err.status = 400;
      throw err;
    }

    const batchNo = makeBatchNo();
    const { rows: batchRows } = await client.query(
      `
      INSERT INTO upload_batch (
        batch_no, indicator_id, uploaded_by, upload_geo_level,
        time_period_id, source_file_name, status, meta_json, submitted_at
      ) VALUES ($1,$2,$3,$4,$5,$6,'submitted',$7,NOW())
      RETURNING *
      `,
      [
        batchNo,
        indicator.id,
        user.sub ? Number(user.sub) : null,
        grain,
        tp.id,
        originalname || null,
        JSON.stringify(parsed.meta),
      ]
    );
    const batch = batchRows[0];

    let errorCount = 0;
    let okCount = 0;
    const staging = [];
    let primaryDistrictId = null;
    let primaryDivisionId = null;

    const workRows = parsed.dataRows.filter((r) => r.hasAnyValue);
    const districtMap = await preloadDistrictMap(client);
    let facilityLookup = { byCode: new Map(), byName: new Map() };
    let blockByLgd = new Map();

    if (grain === 'facility') {
      facilityLookup = await preloadFacilityLookup(workRows, client);
    } else if (grain === 'block') {
      blockByLgd = await preloadBlockMap(
        workRows.map((r) => r.blockLgd).filter(Boolean),
        client
      );
    }

    for (const row of workRows) {
      const errors = [];
      let district = null;
      let block = null;
      let facility = null;

      if (grain === 'district') {
        if (!row.districtLgd && !row.districtName) {
          errors.push('District LGD code required');
        } else {
          district = row.districtLgd
            ? districtMap.byLgd.get(String(row.districtLgd)) || null
            : null;
          if (!district) errors.push(`Unknown District LGD: ${row.districtLgd || row.districtName}`);
        }
      } else if (grain === 'block') {
        if (!row.blockLgd && !row.blockName) {
          errors.push('Block LGD code required');
        } else {
          block = row.blockLgd ? blockByLgd.get(String(row.blockLgd)) || null : null;
          if (!block) {
            errors.push(`Unknown Block LGD: ${row.blockLgd || row.blockName}`);
          } else {
            district = districtMap.byId.get(Number(block.district_id)) || null;
          }
        }
      } else if (grain === 'facility') {
        if (!row.hfrCode && !row.facilityName) {
          errors.push('HFR Code or Facility Name required');
        } else {
          const codeKey = row.hfrCode ? String(row.hfrCode).trim().toUpperCase() : '';
          const nameKey = row.facilityName ? String(row.facilityName).trim().toLowerCase() : '';
          facility =
            (codeKey && facilityLookup.byCode.get(codeKey)) ||
            (nameKey && facilityLookup.byName.get(nameKey)) ||
            null;
          if (!facility) {
            errors.push(`Facility not found for HFR ${row.hfrCode || row.facilityName}`);
          } else {
            district = facility.district_id
              ? districtMap.byId.get(Number(facility.district_id)) || null
              : null;
            block = facility.block_id
              ? { id: facility.block_id, district_id: facility.district_id }
              : null;
          }
        }
      }

      if (district) {
        primaryDistrictId = primaryDistrictId || district.id;
        primaryDivisionId = primaryDivisionId || district.division_id;
      }

      for (const cell of Object.values(row.values || {})) {
        if (cell && cell.error) errors.push(cell.error);
      }

      const status = errors.length ? 'error' : 'ok';
      if (status === 'error') errorCount += 1;
      if (status === 'ok') okCount += 1;

      for (const col of template.valueColumns) {
        const cell = row.values[col.deCode];
        if (!cell || cell.value === undefined) continue;
        staging.push({
          row_no: row.excelRow,
          data_element_id: deMap[col.deCode].id,
          source_id: deMap[col.deCode].source_id,
          geo_level: grain,
          division_id: district ? district.division_id : facility ? facility.division_id : null,
          district_id: district ? district.id : facility ? facility.district_id : null,
          block_id: block ? block.id : facility ? facility.block_id : null,
          facility_id: facility ? facility.id : null,
          external_geo_code: row.hfrCode || row.blockLgd || row.districtLgd,
          column_key: col.header,
          value_num: cell.error ? null : cell.value,
          validation_status: status === 'error' ? 'error' : 'ok',
          validation_errors: errors.length ? errors : null,
        });
      }

      if (errors.length && Object.keys(row.values || {}).length === 0) {
        staging.push({
          row_no: row.excelRow,
          data_element_id: deMap[template.valueColumns[0].deCode].id,
          source_id: deMap[template.valueColumns[0].deCode].source_id,
          geo_level: grain,
          division_id: district ? district.division_id : null,
          district_id: district ? district.id : null,
          block_id: block ? block.id : null,
          facility_id: facility ? facility.id : null,
          external_geo_code: row.hfrCode || row.blockLgd || row.districtLgd,
          column_key: template.valueColumns[0].header,
          value_num: null,
          validation_status: 'error',
          validation_errors: errors,
        });
      }
    }

    await bulkInsertUploadRows(client, batch.id, indicator.id, staging);

    let factCount = 0;
    let finalStatus = errorCount > 0 ? 'validation_failed' : 'approved';

    if (publish && errorCount === 0 && okCount > 0) {
      const batchIdTag = `UPLOAD_${batchNo}`;
      const deIds = template.valueColumns.map((c) => deMap[c.deCode].id);
      const districtIdsForDelete = [
        ...new Set(
          staging
            .filter((s) => s.validation_status === 'ok' && s.district_id)
            .map((s) => s.district_id)
        ),
      ];
      if (districtIdsForDelete.length) {
        await client.query(
          `
          UPDATE upload_row ur
          SET published_fact_id = NULL
          WHERE ur.published_fact_id IN (
            SELECT f.id
            FROM fact_component_value f
            WHERE f.district_id = ANY($1::bigint[])
              AND f.time_period_id = $2
              AND f.data_element_id = ANY($3::bigint[])
              AND f.geo_level = $4
          )
          `,
          [districtIdsForDelete, tp.id, deIds, grain]
        );
        await client.query(
          `
          DELETE FROM fact_component_value
          WHERE district_id = ANY($1::bigint[])
            AND time_period_id = $2
            AND data_element_id = ANY($3::bigint[])
            AND geo_level = $4
          `,
          [districtIdsForDelete, tp.id, deIds, grain]
        );
      }

      factCount = await bulkInsertFacts(client, staging, tp.id, batchIdTag);

      const districtIds = [
        ...new Set(
          staging
            .filter((s) => s.validation_status === 'ok' && s.district_id)
            .map((s) => s.district_id)
        ),
      ];

      for (const distId of districtIds) {
        const sample = staging.find((s) => s.district_id === distId);
        await recomputeKpi(client, {
          indicatorCode: template.code,
          indicatorId: indicator.id,
          timePeriodId: tp.id,
          districtId: distId,
          divisionId: sample?.division_id || primaryDivisionId,
          grain,
        });
      }

      finalStatus = 'published';
    } else if (errorCount === 0 && okCount > 0) {
      finalStatus = 'approved';
    }

    await client.query(
      `
      UPDATE upload_batch SET
        status = $2::text,
        row_count = $3::int,
        error_count = $4::int,
        fact_count = $5::int,
        district_id = $6::bigint,
        division_id = $7::bigint,
        published_at = CASE WHEN $2::text = 'published' THEN NOW() ELSE NULL END,
        updated_at = NOW()
      WHERE id = $1::bigint
      `,
      [
        batch.id,
        finalStatus,
        staging.length,
        errorCount,
        factCount,
        primaryDistrictId,
        primaryDivisionId,
      ]
    );

    await client.query('COMMIT');

    const { rows: errSample } = await query(
      `
      SELECT row_no, external_geo_code, validation_errors
      FROM upload_row
      WHERE batch_id = $1 AND validation_status = 'error'
      ORDER BY row_no
      LIMIT 20
      `,
      [batch.id]
    );

    return {
      batch_id: batch.id,
      batch_no: batchNo,
      indicator_code: template.code,
      period: periodLabel,
      grain,
      status: finalStatus,
      rows_staged: staging.length,
      rows_ok: okCount,
      error_count: errorCount,
      fact_count: factCount,
      errors: errSample,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getBatch(batchId) {
  const { rows } = await query(`SELECT * FROM upload_batch WHERE id = $1`, [batchId]);
  if (!rows[0]) {
    const err = new Error('Batch not found');
    err.status = 404;
    throw err;
  }
  const { rows: rowStats } = await query(
    `
    SELECT validation_status, COUNT(*)::int AS cnt
    FROM upload_row WHERE batch_id = $1
    GROUP BY validation_status
    `,
    [batchId]
  );
  const { rows: errors } = await query(
    `
    SELECT row_no, column_key, external_geo_code, validation_errors
    FROM upload_row
    WHERE batch_id = $1 AND validation_status = 'error'
    ORDER BY row_no
    LIMIT 50
    `,
    [batchId]
  );
  return { batch: rows[0], row_stats: rowStats, errors };
}

async function listBatches({ limit = 20 } = {}) {
  const { rows } = await query(
    `
    SELECT b.*, i.code AS indicator_code, i.name AS indicator_name, u.username
    FROM upload_batch b
    LEFT JOIN indicator i ON i.id = b.indicator_id
    LEFT JOIN app_user u ON u.id = b.uploaded_by
    ORDER BY b.id DESC
    LIMIT $1
    `,
    [limit]
  );
  return rows;
}

module.exports = {
  processUpload,
  getBatch,
  listBatches,
  getTemplate,
  resolvePeriod,
  resolvePeriodInput,
};
