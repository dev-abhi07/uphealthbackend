const { query, pool } = require('../db/pool');
const { parseRankingWorkbook } = require('./rankingExcelParser');
const { normalizeGeoName } = require('./rankingNameNormalize');
const { groupIndicatorsForSummary } = require('./rankingRegistry');

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  if (unit === 'percent') return `${Number(n.toFixed(2))}%`;
  if (unit === 'index') return Number(n.toFixed(2));
  return Number(n.toFixed(2));
}

/** Display label for a ranking score (composite stays numeric). */
function displayForIndicator(score, ind) {
  if (score === null || score === undefined) return null;
  if (ind && ind.is_composite) return score;
  return formatValue(score, ind && ind.unit);
}

/**
 * Shared bar ceiling for current + previous values of one indicator list.
 * percent → 0–100 (or higher if outliers), index → 0–1, others → max in list.
 */
function computeBarScale(unit, values) {
  const xs = (values || []).filter((v) => v != null && !Number.isNaN(Number(v))).map(Number);
  const max = xs.length ? Math.max(...xs) : 0;
  if (unit === 'percent') {
    return { mode: 'fixed', max: Math.max(100, max) };
  }
  if (unit === 'index') {
    return { mode: 'fixed', max: Math.max(1, max) };
  }
  return { mode: 'relative', max: max > 0 ? max : 1 };
}

function barPct(score, scale) {
  if (score === null || score === undefined || !scale || !scale.max) return null;
  const pct = (Number(score) / scale.max) * 100;
  if (Number.isNaN(pct)) return null;
  return Number(Math.min(100, Math.max(0, pct)).toFixed(2));
}

async function ensurePeriod(client, label, display) {
  const { rows } = await client.query(
    `
    INSERT INTO ranking_period (label, display)
    VALUES ($1, $2)
    ON CONFLICT (label) DO UPDATE SET display = EXCLUDED.display
    RETURNING *
    `,
    [label, display || label]
  );
  return rows[0];
}

async function loadIndicatorMap(client) {
  const { rows } = await client.query(
    `SELECT id, code, name, short_name, unit, sort_order, is_composite,
            domain_label, numerator_text, denominator_text,
            data_source_text, is_negative
     FROM ranking_indicator WHERE is_active = TRUE`
  );
  const byCode = new Map();
  for (const r of rows) byCode.set(r.code, r);
  return byCode;
}

async function importRankingFile({ buffer, originalname, geoLevelHint } = {}) {
  const parsed = parseRankingWorkbook(buffer);
  const geoLevel = geoLevelHint || parsed.geoLevel;
  if (!parsed.periodLabel) {
    const err = new Error('Month not found in Excel (expected e.g. Jan 2026)');
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const period = await ensurePeriod(client, parsed.periodLabel, parsed.periodDisplay);
    const indMap = await loadIndicatorMap(client);

    await client.query(
      `DELETE FROM ranking_value WHERE period_id = $1 AND geo_level = $2`,
      [period.id, geoLevel]
    );

    let rowCount = 0;
    const unknownSheets = [];

    for (const sheet of parsed.sheets) {
      const ind = indMap.get(sheet.code);
      if (!ind) {
        unknownSheets.push(sheet.sheetName);
        continue;
      }
      for (const r of sheet.rows) {
        await client.query(
          `
          INSERT INTO ranking_value (
            period_id, indicator_id, geo_level, geo_name, district_name, value, rank
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (period_id, indicator_id, geo_level, geo_name)
          DO UPDATE SET value = EXCLUDED.value, rank = EXCLUDED.rank, district_name = EXCLUDED.district_name
          `,
          [period.id, ind.id, geoLevel, r.geoName, r.districtName, r.value, r.rank]
        );
        rowCount += 1;
      }
    }

    const { rows: batchRows } = await client.query(
      `
      INSERT INTO ranking_import_batch (geo_level, period_id, source_file, sheet_count, row_count)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id
      `,
      [geoLevel, period.id, originalname || null, parsed.sheets.length, rowCount]
    );

    await client.query('COMMIT');
    return {
      batch_id: batchRows[0].id,
      geo_level: geoLevel,
      period: parsed.periodLabel,
      period_display: parsed.periodDisplay,
      sheets_imported: parsed.sheets.length,
      rows_imported: rowCount,
      unknown_sheets: unknownSheets,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Tercile band size: 18 divisions → 6, 75 districts → 25.
 */
function bandSize(total) {
  const n = Number(total) || 0;
  if (n < 1) return 1;
  return Math.max(1, Math.ceil(n / 3));
}

function bandByTercile(rank, total) {
  const topN = bandSize(total);
  if (rank <= topN) return 'top';
  if (rank > total - topN) return 'bottom';
  return 'moderate';
}

/**
 * Ranking dashboard payload (division/district/block) with rank-change trend.
 */
function requiredSheetForGeoLevel(geoLevel) {
  if (geoLevel === 'block') return 'Agra-Data_Report_Requirement-*_block.xlsx';
  if (geoLevel === 'district') return 'Data_Report_Requirement-*_district.xlsx';
  return 'Data_Report_Requirement-*_division.xlsx';
}

function viewForGeoLevel(geoLevel) {
  if (geoLevel === 'block') return 'ranking_block';
  if (geoLevel === 'district') return 'ranking_district';
  return 'ranking_division';
}

function bandLabelsForGeoLevel(geoLevel, total) {
  const n = bandSize(total);
  const labelName =
    geoLevel === 'block' ? 'Blocks' : geoLevel === 'district' ? 'Districts' : 'Divisions';
  return {
    top: { label: `Top ${n} ${labelName}`, color: 'green', count: 0, items: [], size: n },
    moderate: {
      label: `Moderate ${n} ${labelName}`,
      color: 'orange',
      count: 0,
      items: [],
      size: n,
    },
    bottom: { label: `Bottom ${n} ${labelName}`, color: 'red', count: 0, items: [], size: n },
  };
}

function trendKey(geoName, districtName) {
  return `${geoName}||${districtName || ''}`;
}

/**
 * Resolve division filter from div_code / division name.
 * parent_area_id is accepted as an alias for div_code (must match division.code).
 */
async function resolveDivisionFilter({ divCode, division, parentAreaId } = {}) {
  const code = (divCode || parentAreaId || '').toString().trim();
  const nameRaw = (division || '').toString().trim();
  const name = nameRaw ? normalizeGeoName(nameRaw) : '';
  if (!code && !name && !nameRaw) return null;

  if (code) {
    const { rows } = await query(
      `
      SELECT id, code, name
      FROM division
      WHERE code = $1
      LIMIT 1
      `,
      [code]
    );
    if (rows[0]) return rows[0];
  }

  for (const candidate of [...new Set([name, nameRaw].filter(Boolean))]) {
    const { rows } = await query(
      `
      SELECT id, code, name
      FROM division
      WHERE name ILIKE $1 OR name ILIKE $2 OR replace(lower(name), ' nagar', '') = replace(lower($1), ' nagar', '')
      LIMIT 1
      `,
      [candidate, `%${candidate}%`]
    );
    if (rows[0]) return rows[0];
  }

  return null;
}

/**
 * Append geo filters for district/block queries.
 * Tolerates known Excel spellings (Bagpat/Badaun/Unnav/Shrawasti).
 */
function excelAliasFormsFor(canonical) {
  const lower = String(canonical || '')
    .trim()
    .toLowerCase();
  const forms = new Set([lower]);
  const reverse = {
    baghpat: ['bagpat'],
    budaun: ['badaun'],
    unnao: ['unnav'],
    shravasti: ['shrawasti'],
    'kanpur nagar division': ['kanpur division'],
    'aligarh division': ['alligarh division'],
  };
  for (const a of reverse[lower] || []) forms.add(a);
  return [...forms];
}

function appendGeoFilters(sql, params, { geoLevel, districtFilter, divisionRow }) {
  let out = sql;
  if (districtFilter) {
    const forms = excelAliasFormsFor(normalizeGeoName(districtFilter));
    params.push(forms);
    if (geoLevel === 'block') {
      out += ` AND lower(trim(v.district_name)) = ANY($${params.length}::text[])`;
    } else if (geoLevel === 'district') {
      out += ` AND lower(trim(v.geo_name)) = ANY($${params.length}::text[])`;
    }
  }
  if (divisionRow && (geoLevel === 'district' || geoLevel === 'block')) {
    params.push(divisionRow.id);
    const col = geoLevel === 'district' ? 'v.geo_name' : 'v.district_name';
    out += `
      AND EXISTS (
        SELECT 1
        FROM district d
        WHERE d.division_id = $${params.length}
          AND (
            lower(trim(d.name)) = lower(trim(${col}))
            OR (
              lower(trim(d.name)) = 'baghpat' AND lower(trim(${col})) = 'bagpat'
            )
            OR (
              lower(trim(d.name)) = 'budaun' AND lower(trim(${col})) = 'badaun'
            )
            OR (
              lower(trim(d.name)) = 'unnao' AND lower(trim(${col})) = 'unnav'
            )
            OR (
              lower(trim(d.name)) = 'shravasti' AND lower(trim(${col})) = 'shrawasti'
            )
          )
      )
    `;
  }
  return out;
}

async function getGeoDashboard({
  geoLevel,
  period,
  district,
  divCode,
  division,
  parentAreaId,
  indicatorCode,
} = {}) {
  const districtFilter = district ? normalizeGeoName(String(district).trim()) : null;
  const divisionRow = await resolveDivisionFilter({ divCode, division, parentAreaId });
  const requestedCode = String(indicatorCode || 'RANK_COMPOSITE').trim().toUpperCase();

  let periodRow;
  if (period) {
    const { rows } = await query(
      `SELECT * FROM ranking_period WHERE label = $1 OR display ILIKE $1 LIMIT 1`,
      [period]
    );
    periodRow = rows[0];
  } else {
    const { rows } = await query(
      `SELECT p.* FROM ranking_period p
       JOIN ranking_value v ON v.period_id = p.id AND v.geo_level = $1
       ORDER BY p.label DESC LIMIT 1`,
      [geoLevel]
    );
    periodRow = rows[0];
  }

  const emptyMeta = {
    district: districtFilter,
    div_code: divisionRow ? divisionRow.code : divCode || null,
    division: divisionRow ? divisionRow.name : division || null,
    parent_area_id: parentAreaId || null,
    indicator_code: requestedCode,
    selected_indicator: null,
  };

  if (!periodRow) {
    return {
      view: viewForGeoLevel(geoLevel),
      has_data: false,
      message: `No ${geoLevel} ranking data yet. Import sheet: ${requiredSheetForGeoLevel(geoLevel)}`,
      required_sheet: requiredSheetForGeoLevel(geoLevel),
      geo_level: geoLevel,
      period: period || null,
      ...emptyMeta,
      overall_composite_score: null,
      bands: { top: { count: 0, items: [] }, moderate: { count: 0, items: [] }, bottom: { count: 0, items: [] } },
      indicators: [],
      by_type: [],
      by_domain: [],
      ranking: [],
      trend_compare_period: null,
    };
  }

  // Resolve ranking indicator (default composite)
  const { rows: indRows } = await query(
    `
    SELECT id, code, name, short_name, unit, is_composite,
           domain_label, numerator_text, denominator_text,
           data_source_text, is_negative
    FROM ranking_indicator
    WHERE is_active = TRUE AND upper(code) = $1
    LIMIT 1
    `,
    [requestedCode]
  );
  const selectedInd = indRows[0] || null;
  if (!selectedInd) {
    return {
      view: viewForGeoLevel(geoLevel),
      has_data: false,
      message: `Unknown indicator_code: ${requestedCode}`,
      required_sheet: requiredSheetForGeoLevel(geoLevel),
      geo_level: geoLevel,
      period: periodRow.label,
      period_display: periodRow.display,
      ...emptyMeta,
      overall_composite_score: null,
      bands: { top: { count: 0, items: [] }, moderate: { count: 0, items: [] }, bottom: { count: 0, items: [] } },
      indicators: [],
      by_type: [],
      by_domain: [],
      ranking: [],
      trend_compare_period: null,
    };
  }

  const rankingIndicatorCode = selectedInd.code;

  // Invalid div_code when provided
  if ((divCode || parentAreaId || division) && !divisionRow) {
    return {
      view: viewForGeoLevel(geoLevel),
      has_data: false,
      message: 'Unknown division filter (div_code / division)',
      required_sheet: requiredSheetForGeoLevel(geoLevel),
      geo_level: geoLevel,
      period: periodRow.label,
      period_display: periodRow.display,
      ...emptyMeta,
      selected_indicator: {
        code: selectedInd.code,
        name: selectedInd.short_name || selectedInd.name,
        full_name: selectedInd.name,
        unit: selectedInd.unit,
        is_composite: selectedInd.is_composite,
      },
      overall_composite_score: null,
      bands: { top: { count: 0, items: [] }, moderate: { count: 0, items: [] }, bottom: { count: 0, items: [] } },
      indicators: [],
      by_type: [],
      by_domain: [],
      ranking: [],
      trend_compare_period: null,
    };
  }

  // Division level + div_code: return only that one division row (tolerate Excel aliases)
  const divisionNameFilter =
    geoLevel === 'division' && divisionRow ? divisionRow.name : null;

  const rankingParams = [periodRow.id, geoLevel, rankingIndicatorCode];
  let rankingSql = `
    SELECT v.geo_name, v.district_name, v.value, v.rank
    FROM ranking_value v
    JOIN ranking_indicator i ON i.id = v.indicator_id
    WHERE v.period_id = $1 AND v.geo_level = $2 AND i.code = $3
  `;
  if (divisionNameFilter) {
    const forms = excelAliasFormsFor(divisionNameFilter);
    rankingParams.push(forms);
    rankingSql += ` AND lower(trim(v.geo_name)) = ANY($${rankingParams.length}::text[])`;
  }
  rankingSql = appendGeoFilters(rankingSql, rankingParams, {
    geoLevel,
    districtFilter,
    divisionRow: geoLevel === 'division' ? null : divisionRow,
  });
  rankingSql += ` ORDER BY v.rank NULLS LAST, v.value DESC NULLS LAST, v.geo_name`;

  const { rows: rankingRows } = await query(rankingSql, rankingParams);

  // Indicator not imported for this geo_level (e.g. some codes only on block sheets)
  if (!rankingRows.length && rankingIndicatorCode !== 'RANK_COMPOSITE') {
    const empty = await getGeoDashboard({
      geoLevel,
      period: periodRow.label,
      district,
      divCode,
      division,
      parentAreaId,
      indicatorCode: 'RANK_COMPOSITE',
    });
    return {
      ...empty,
      has_data: false,
      message: `Indicator ${rankingIndicatorCode} has no ${geoLevel}-level data for this period`,
      indicator_code: rankingIndicatorCode,
      selected_indicator: {
        code: selectedInd.code,
        name: selectedInd.short_name || selectedInd.name,
        full_name: selectedInd.name,
        unit: selectedInd.unit,
        is_composite: selectedInd.is_composite,
        available: false,
      },
      ranking: [],
      count: 0,
      bands: bandLabelsForGeoLevel(geoLevel, 0),
    };
  }

  // Trend (rank change) for same indicator vs previous period
  const prevPeriodQuery = await query(
    `
    SELECT p.id, p.label, p.display
    FROM ranking_period p
    JOIN ranking_value v ON v.period_id = p.id AND v.geo_level = $2
    JOIN ranking_indicator i ON i.id = v.indicator_id AND i.code = $3
    WHERE p.label < $1
    GROUP BY p.id, p.label, p.display
    ORDER BY p.label DESC
    LIMIT 1
    `,
    [periodRow.label, geoLevel, rankingIndicatorCode]
  );
  const prevPeriodRow = prevPeriodQuery.rows[0] || null;
  /** @type {Map<string, { rank: number|null, score: number|null }>} */
  const prevByKey = new Map();
  if (prevPeriodRow) {
    const prevParams = [prevPeriodRow.id, geoLevel, rankingIndicatorCode];
    let prevSql = `
      SELECT v.geo_name, v.district_name, v.rank, v.value
      FROM ranking_value v
      JOIN ranking_indicator i ON i.id = v.indicator_id AND i.code = $3
      WHERE v.period_id = $1 AND v.geo_level = $2
    `;
    if (divisionNameFilter) {
      const forms = excelAliasFormsFor(divisionNameFilter);
      prevParams.push(forms);
      prevSql += ` AND lower(trim(v.geo_name)) = ANY($${prevParams.length}::text[])`;
    }
    prevSql = appendGeoFilters(prevSql, prevParams, {
      geoLevel,
      districtFilter,
      divisionRow: geoLevel === 'division' ? null : divisionRow,
    });
    const { rows: prevRows } = await query(prevSql, prevParams);
    for (const r of prevRows) {
      const rank =
        r.rank === null || r.rank === undefined ? null : Number(r.rank);
      const score = num(r.value);
      if (rank === null && score === null) continue;
      prevByKey.set(trendKey(r.geo_name, r.district_name), { rank, score });
    }
  }

  const total = rankingRows.length;
  const scores = rankingRows.map((r) => num(r.value)).filter((x) => x != null);
  const selectedAvg =
    scores.length > 0
      ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2))
      : null;

  // Overall composite score (SUMMARY header) always from RANK_COMPOSITE when possible
  let overall = selectedInd.is_composite ? selectedAvg : null;
  if (!selectedInd.is_composite) {
    const compParams = [periodRow.id, geoLevel];
    let compSql = `
      SELECT ROUND(AVG(v.value)::numeric, 2) AS value
      FROM ranking_value v
      JOIN ranking_indicator i ON i.id = v.indicator_id AND i.code = 'RANK_COMPOSITE'
      WHERE v.period_id = $1 AND v.geo_level = $2
    `;
    if (divisionNameFilter) {
      const forms = excelAliasFormsFor(divisionNameFilter);
      compParams.push(forms);
      compSql += ` AND lower(trim(v.geo_name)) = ANY($${compParams.length}::text[])`;
    }
    compSql = appendGeoFilters(compSql, compParams, {
      geoLevel,
      districtFilter,
      divisionRow: geoLevel === 'division' ? null : divisionRow,
    });
    const { rows: compAvg } = await query(compSql, compParams);
    overall = num(compAvg[0] && compAvg[0].value);
  }

  const bands = bandLabelsForGeoLevel(geoLevel, total);
  const filtered = Boolean(districtFilter || divisionRow);

  // Collect current + previous scores first so bar scale covers both months
  const rankingDraft = rankingRows.map((r, idx) => {
    const rankRaw = r.rank === null || r.rank === undefined ? null : Number(r.rank);
    const rank = rankRaw ?? 0;
    const localRank = idx + 1;
    const key = trendKey(r.geo_name, r.district_name);
    const prev = prevByKey.get(key) || null;
    const prevRank = prev && prev.rank != null ? prev.rank : null;
    const prevScore = prev ? prev.score : null;
    const rankChange = rankRaw === null || prevRank === null ? null : rankRaw - prevRank;
    const rankTrend =
      rankChange === null ? null : rankChange === 0 ? 'same' : rankChange < 0 ? 'up' : 'down';
    const bandRank = filtered ? localRank : rank;
    const bandTotal = filtered ? total : total || 18;
    const score = num(r.value);
    const valueChange =
      score === null || prevScore === null
        ? null
        : Number((score - prevScore).toFixed(4));
    const valueTrend =
      valueChange === null
        ? null
        : valueChange === 0
          ? 'same'
          : valueChange > 0
            ? 'up'
            : 'down';
    return {
      rank,
      local_rank: filtered ? localRank : null,
      name: r.geo_name,
      district: r.district_name || null,
      unit: selectedInd.unit,
      score,
      display_value: displayForIndicator(score, selectedInd),
      prev_score: prevScore,
      prev_display_value: displayForIndicator(prevScore, selectedInd),
      value_change: valueChange,
      value_trend: valueTrend,
      band: bandByTercile(bandRank, bandTotal),
      prev_rank: prevRank,
      rank_change: rankChange,
      rank_trend: rankTrend,
    };
  });

  const barScale = computeBarScale(
    selectedInd.unit,
    rankingDraft.flatMap((r) => [r.score, r.prev_score])
  );

  const ranking = rankingDraft.map((item) => {
    const withBars = {
      ...item,
      bar_pct: barPct(item.score, barScale),
      prev_bar_pct: barPct(item.prev_score, barScale),
    };
    if (bands[withBars.band]) {
      bands[withBars.band].items.push(withBars);
      bands[withBars.band].count += 1;
    }
    return withBars;
  });

  const indParams = [periodRow.id, geoLevel];
  let indSql = `
    SELECT
      i.code,
      i.short_name,
      i.name,
      i.unit,
      i.sort_order,
      i.is_composite,
      i.domain_label,
      i.numerator_text,
      i.denominator_text,
      i.data_source_text,
      i.is_negative,
      ROUND(AVG(v.value)::numeric, 2) AS value
    FROM ranking_indicator i
    JOIN ranking_value v ON v.indicator_id = i.id
    WHERE v.period_id = $1 AND v.geo_level = $2 AND i.is_active = TRUE
  `;
  if (divisionNameFilter) {
    const forms = excelAliasFormsFor(divisionNameFilter);
    indParams.push(forms);
    indSql += ` AND lower(trim(v.geo_name)) = ANY($${indParams.length}::text[])`;
  }
  indSql = appendGeoFilters(indSql, indParams, {
    geoLevel,
    districtFilter,
    divisionRow: geoLevel === 'division' ? null : divisionRow,
  });
  indSql += ` GROUP BY i.id ORDER BY i.sort_order`;

  const { rows: indAgg } = await query(indSql, indParams);

  const indicators = indAgg.map((r) => ({
    code: r.code,
    name: r.short_name || r.name,
    full_name: r.name,
    unit: r.unit,
    is_composite: r.is_composite,
    is_negative: !!r.is_negative,
    domain_label: r.domain_label || null,
    sort_order: r.sort_order != null ? Number(r.sort_order) : null,
    numerator: r.numerator_text || null,
    denominator: r.denominator_text || null,
    data_source: r.data_source_text || null,
    value: num(r.value),
    display_value: r.is_composite ? num(r.value) : formatValue(r.value, r.unit),
    selected: r.code === rankingIndicatorCode,
  }));

  const { by_type, by_domain } = groupIndicatorsForSummary(indicators);

  return {
    view: viewForGeoLevel(geoLevel),
    source: 'ranking_value',
    has_data: total > 0,
    geo_level: geoLevel,
    period: periodRow.label,
    period_display: periodRow.display,
    district: districtFilter,
    div_code: divisionRow ? divisionRow.code : null,
    division: divisionRow ? divisionRow.name : null,
    parent_area_id: parentAreaId || null,
    indicator_code: rankingIndicatorCode,
    selected_indicator: {
      code: selectedInd.code,
      name: selectedInd.short_name || selectedInd.name,
      full_name: selectedInd.name,
      unit: selectedInd.unit,
      is_composite: selectedInd.is_composite,
      is_negative: !!selectedInd.is_negative,
      domain_label: selectedInd.domain_label || null,
      numerator: selectedInd.numerator_text || null,
      denominator: selectedInd.denominator_text || null,
      data_source: selectedInd.data_source_text || null,
      available: true,
      average: selectedAvg,
      average_display: selectedInd.is_composite
        ? selectedAvg
        : formatValue(selectedAvg, selectedInd.unit),
      average_bar_pct: barPct(selectedAvg, barScale),
      bar_scale: barScale,
    },
    trend_compare_period: prevPeriodRow ? prevPeriodRow.label : null,
    trend_compare_period_display: prevPeriodRow ? prevPeriodRow.display : null,
    required_sheet: requiredSheetForGeoLevel(geoLevel),
    overall_composite_score: overall,
    overall_composite_label: 'OVERALL COMPOSITE SCORE',
    bands,
    indicators,
    by_type,
    by_domain,
    ranking,
    count: total,
  };
}

// Backward compatible wrappers
async function getDivisionDashboard({
  period,
  divCode,
  division,
  parentAreaId,
  indicatorCode,
  skipOutcomeSync,
} = {}) {
  try {
    const outcomeDistrictService = require('../outcome/outcomeDistrictService');
    const outcome = await outcomeDistrictService.getDivisionOutcomeDashboard({
      period,
      divCode,
      division,
      parentAreaId,
      indicatorCode,
      skipSync: skipOutcomeSync === true,
    });
    if (outcome && outcome.has_data) return outcome;
    return {
      view: 'ranking_division',
      source: 'indicator_outcome',
      has_data: false,
      message:
        outcome?.message ||
        'No division outcome data for this period. Sync district outcome first (POST /api/ranking/outcome/district/sync).',
      geo_level: 'division',
      period: outcome?.period || period || null,
      div_code: divCode || null,
      division: division || null,
      parent_area_id: parentAreaId || null,
      indicator_code: indicatorCode || 'RANK_COMPOSITE',
      selected_indicator: null,
      overall_composite_score: null,
      overall_composite_label: 'OVERALL COMPOSITE SCORE',
      bands: { top: { count: 0, items: [] }, moderate: { count: 0, items: [] }, bottom: { count: 0, items: [] } },
      indicators: [],
      by_type: [],
      by_domain: [],
      ranking: [],
      count: 0,
      trend_compare_period: null,
    };
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[outcome] division dashboard:', e.message);
    }
    return {
      view: 'ranking_division',
      source: 'indicator_outcome',
      has_data: false,
      message: e.message,
      geo_level: 'division',
      period: period || null,
      indicator_code: indicatorCode || 'RANK_COMPOSITE',
      ranking: [],
      bands: { top: { count: 0, items: [] }, moderate: { count: 0, items: [] }, bottom: { count: 0, items: [] } },
      indicators: [],
      count: 0,
    };
  }
}

function emptyDistrictOutcomePayload({
  period,
  district,
  divCode,
  division,
  parentAreaId,
  indicatorCode,
  message,
} = {}) {
  return {
    view: 'ranking_district',
    source: 'indicator_outcome',
    has_data: false,
    message:
      message ||
      'No district outcome data for this period. Sync from external API (POST /api/ranking/outcome/district/sync).',
    geo_level: 'district',
    period: period || null,
    district: district || null,
    div_code: divCode || null,
    division: division || null,
    parent_area_id: parentAreaId || null,
    indicator_code: indicatorCode || 'RANK_COMPOSITE',
    selected_indicator: null,
    overall_composite_score: null,
    overall_composite_label: 'OVERALL COMPOSITE SCORE',
    bands: { top: { count: 0, items: [] }, moderate: { count: 0, items: [] }, bottom: { count: 0, items: [] } },
    indicators: [],
    by_type: [],
    by_domain: [],
    ranking: [],
    count: 0,
    trend_compare_period: null,
  };
}

/**
 * District ranking uses ONLY the external outcome API cache.
 * Legacy ranking_value Excel imports are not used.
 */
async function getDistrictDashboard({
  period,
  district,
  divCode,
  division,
  parentAreaId,
  indicatorCode,
  skipOutcomeSync,
} = {}) {
  try {
    const outcomeDistrictService = require('../outcome/outcomeDistrictService');
    const outcome = await outcomeDistrictService.getDistrictOutcomeDashboard({
      period,
      district,
      divCode,
      division,
      parentAreaId,
      indicatorCode,
      skipSync: skipOutcomeSync === true,
    });
    if (outcome && outcome.has_data) return outcome;
    return emptyDistrictOutcomePayload({
      period: outcome?.period || period,
      district,
      divCode,
      division,
      parentAreaId,
      indicatorCode,
      message: outcome?.message,
    });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[outcome] district dashboard:', e.message);
    }
    return emptyDistrictOutcomePayload({
      period,
      district,
      divCode,
      division,
      parentAreaId,
      indicatorCode,
      message: e.message,
    });
  }
}

async function getBlockDashboard({
  period,
  district,
  block,
  divCode,
  division,
  parentAreaId,
  indicatorCode,
  skipOutcomeSync,
} = {}) {
  try {
    const outcomeBlockService = require('../outcome/outcomeBlockService');
    const outcome = await outcomeBlockService.getBlockOutcomeDashboard({
      period,
      district,
      block,
      indicatorCode,
      skipSync: skipOutcomeSync === true,
    });
    if (outcome && outcome.has_data) return outcome;
    return {
      view: 'ranking_block',
      source: 'indicator_outcome',
      has_data: false,
      message:
        outcome?.message ||
        'No block outcome data for this period. Sync via POST /api/ranking/outcome/block/sync.',
      geo_level: 'block',
      period: outcome?.period || period || null,
      district: district || null,
      block: block || null,
      div_code: divCode || null,
      division: division || null,
      parent_area_id: parentAreaId || null,
      indicator_code: indicatorCode || 'RANK_COMPOSITE',
      selected_indicator: null,
      overall_composite_score: null,
      overall_composite_label: 'OVERALL COMPOSITE SCORE',
      bands: {
        top: { count: 0, items: [] },
        moderate: { count: 0, items: [] },
        bottom: { count: 0, items: [] },
      },
      indicators: [],
      by_type: [],
      by_domain: [],
      ranking: [],
      count: 0,
      trend_compare_period: null,
    };
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[outcome] block dashboard:', e.message);
    }
    return {
      view: 'ranking_block',
      source: 'indicator_outcome',
      has_data: false,
      message: e.message,
      geo_level: 'block',
      period: period || null,
      ranking: [],
      count: 0,
    };
  }
}

/**
 * Resolve dashboard payload for frontend health-ranking URL params.
 *
 * Examples:
 * - level=division&period=2026-01
 * - level=division&indicator_code=RANK_ANC4_HB
 * - level=division&table_mode=district&div_code=14595&period=2026-02
 */
async function getRankingDashboard({
  period,
  district,
  block,
  divCode,
  division,
  parentAreaId,
  tableMode,
  mapLevel,
  indicatorCode,
} = {}) {
  const level = mapLevel || 'division';
  const hasDivisionFilter = Boolean(divCode || division);

  // Effective table geo: table_mode wins when drilling down under a division/district
  let tableLevel = level;
  if (tableMode === 'district' && (level === 'division' || hasDivisionFilter)) {
    tableLevel = 'district';
  } else if (
    tableMode === 'block' &&
    (level === 'district' || level === 'division' || hasDivisionFilter || district)
  ) {
    tableLevel = 'block';
  } else if (tableMode) {
    tableLevel = tableMode;
  }

  if (
    tableLevel === 'district' &&
    level === 'division' &&
    tableMode === 'district' &&
    !hasDivisionFilter
  ) {
    return {
      view: 'ranking_district',
      has_data: false,
      message: 'div_code (or division) required when table_mode=district under division map',
      geo_level: 'district',
      map_level: level,
      table_mode: tableMode,
      period: period || null,
      indicator_code: indicatorCode || 'RANK_COMPOSITE',
      ranking: [],
      bands: { top: { count: 0, items: [] }, moderate: { count: 0, items: [] }, bottom: { count: 0, items: [] } },
      indicators: [],
    };
  }

  const common = { period, district, block, divCode, division, parentAreaId, indicatorCode };
  let data;
  if (tableLevel === 'block') {
    data = await getBlockDashboard(common);
  } else if (tableLevel === 'district') {
    data = await getDistrictDashboard(common);
  } else {
    data = await getDivisionDashboard(common);
  }

  // District row / map click: SUMMARY (overall + indicators) = that district.
  // Ranking table stays full (handled inside getDistrictOutcomeDashboard).
  if (district && tableLevel === 'division') {
    const distSummary = await getDistrictDashboard({
      period,
      district,
      indicatorCode,
      skipOutcomeSync: true,
    });
    if (distSummary && distSummary.has_data) {
      data = {
        ...data,
        overall_composite_score: distSummary.overall_composite_score,
        overall_composite_label: distSummary.overall_composite_label,
        state_overall_composite_score: distSummary.state_overall_composite_score,
        indicators: distSummary.indicators,
        by_type: distSummary.by_type,
        by_domain: distSummary.by_domain,
        selected_district: distSummary.selected_district,
        district: distSummary.district,
        district_lgd: distSummary.district_lgd,
        summary_scope: 'district',
      };
    }
  }

  // Attach selected division summary for map popup when drilling into districts
  let selected = null;
  if (hasDivisionFilter && tableLevel !== 'division') {
    const divDash = await getDivisionDashboard({
      period,
      divCode,
      division,
      parentAreaId,
      skipOutcomeSync: true,
    });
    selected = divDash.ranking && divDash.ranking[0] ? divDash.ranking[0] : null;
  }

  // If still on division payload but div_code is set, attach child district ranking
  // so frontend can fill DISTRICT RANKING panel without a second call.
  let childRanking = null;
  let childBands = null;
  let childCount = null;
  if (tableLevel === 'division' && hasDivisionFilter) {
    const child = await getDistrictDashboard(common);
    childRanking = child.ranking;
    childBands = child.bands;
    childCount = child.count;
  }

  return {
    ...data,
    map_level: level,
    table_mode: tableMode || tableLevel,
    selected_division: selected,
    ...(childRanking
      ? {
          child_geo_level: 'district',
          child_ranking: childRanking,
          child_bands: childBands,
          child_count: childCount,
        }
      : {}),
  };
}

async function listRankingPeriods() {
  const store = require('../outcome/outcomeDistrictStore');
  const periods = await store.listOutcomePeriods();
  return periods.map((o) => ({
    label: o.period_label,
    display: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][o.month - 1]} ${o.year}`,
    row_count: o.district_count,
    source: 'indicator_outcome',
  }));
}

module.exports = {
  importRankingFile,
  getDivisionDashboard,
  getDistrictDashboard,
  getBlockDashboard,
  getRankingDashboard,
  listRankingPeriods,
};
