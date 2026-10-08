/**
 * Deep Dive dashboard — rankings with MONTHLY / FY / TREND series + indicator breakup.
 * Separate from map SUMMARY `/api/ranking/dashboard`.
 */
const { query } = require('../db/pool');
const { normalizeGeoName } = require('./rankingNameNormalize');
const {
  resolveOutcomePeriod,
  listOutcomePeriodLabels,
  loadCompositeByPeriod,
  loadIndicatorByPeriod,
  resolveMasterIndicator,
} = require('../outcome/outcomeRankingQueries');
const {
  ASPIRATIONAL_DISTRICTS,
  parseFilter,
  districtInCategory,
  divisionsMatchingCategory,
  districtNamesForFilter,
  normalizeKey,
} = require('./geoCategoryFilter');
const { groupIndicatorsForSummary, resolveExcelDomainKey, parsePanelTab, typeMeta } = require('./rankingRegistry');
const { outcomeConfig, parsePeriodInput } = require('../outcome/outcomeConfig');

/** Avoid hammering upstream when FE fires many parallel dashboard GETs. */
const _outcomeSyncAt = new Map();
const OUTCOME_SYNC_TTL_MS = 60_000;

/**
 * Pull district (+ optional block) outcome from HealthAssist into local cache
 * when OUTCOME_SYNC_ON_READ=true. Used by table / deep-dive so values match API.
 */
async function ensureOutcomeSyncedFromApi({ year, month, needBlock = false } = {}) {
  const cfg = outcomeConfig();
  if (!cfg.syncOnRead || !cfg.enabled) return null;
  if (!year || !month) return null;

  const meta = { district: null, block: null };
  const now = Date.now();
  const dKey = `district:${year}-${String(month).padStart(2, '0')}`;

  if (
    cfg.districtUrl &&
    (!_outcomeSyncAt.has(dKey) || now - _outcomeSyncAt.get(dKey) > OUTCOME_SYNC_TTL_MS)
  ) {
    try {
      const { syncDistrictOutcome } = require('../outcome/outcomeDistrictService');
      meta.district = await syncDistrictOutcome({ month, year, force: true });
      if (meta.district?.ok) _outcomeSyncAt.set(dKey, Date.now());
    } catch (e) {
      meta.district = { ok: false, reason: e.message };
    }
  }

  if (needBlock && cfg.blockUrl) {
    const bKey = `block:${year}-${String(month).padStart(2, '0')}`;
    if (
      !_outcomeSyncAt.has(bKey) ||
      Date.now() - _outcomeSyncAt.get(bKey) > OUTCOME_SYNC_TTL_MS
    ) {
      try {
        const { syncBlockOutcome } = require('../outcome/outcomeBlockService');
        meta.block = await syncBlockOutcome({ month, year, force: true });
        if (meta.block?.ok) _outcomeSyncAt.set(bKey, Date.now());
      } catch (e) {
        meta.block = { ok: false, reason: e.message };
      }
    }
  }

  return meta;
}
/** Keep decimals when |value| < 10; whole number at 10+. */
function formatDisplayNumber(n) {
  if (Math.abs(n) < 10) return Number(n.toFixed(2)).toString();
  return String(Math.round(n));
}

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  const formatted = formatDisplayNumber(n);
  if (unit === 'percent') return `${formatted}%`;
  if (unit === 'index') return Math.abs(n) < 10 ? Number(n.toFixed(2)) : Math.round(n);
  if (unit === 'amount') return `Rs.${formatted}`;
  return formatted;
}

function parsePeriodLabel(label) {
  const m = String(label || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), label };
}

function prevMonthLabel(label) {
  const p = parsePeriodLabel(label);
  if (!p) return null;
  let { year, month } = p;
  month -= 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Indian FY Apr–Mar: periods from FY start through selected month. */
function fyPeriodLabels(periodLabel) {
  const p = parsePeriodLabel(periodLabel);
  if (!p) return [];
  const fyStartYear = p.month >= 4 ? p.year : p.year - 1;
  const out = [];
  let y = fyStartYear;
  let m = 4;
  while (y < p.year || (y === p.year && m <= p.month)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Inclusive month range ending at periodLabel, length up to `count`. */
function trailingPeriodLabels(periodLabel, count = 6) {
  const out = [];
  let cur = periodLabel;
  for (let i = 0; i < count; i += 1) {
    if (!cur) break;
    out.unshift(cur);
    cur = prevMonthLabel(cur);
  }
  return out;
}

async function resolvePeriod(period) {
  return resolveOutcomePeriod(period);
}

async function resolveIndicator(code) {
  const ind = await resolveMasterIndicator(code);
  if (!ind) return null;
  return {
    id: ind.id || ind.code,
    code: ind.code,
    name: ind.name,
    short_name: ind.short_name || ind.name,
    unit: ind.unit,
    is_composite: !!ind.is_composite,
    is_negative: !!ind.is_negative,
  };
}

async function loadValuesForPeriods({ geoLevel, indicatorId, indicatorCode, periodLabels, isNegative }) {
  if (!periodLabels.length) return [];

  const code = String(indicatorCode || indicatorId || 'RANK_COMPOSITE').toUpperCase();
  const isComposite = !code || code === 'RANK_COMPOSITE' || code === 'COMPOSITE' || code === 'INDEX_OUTCOME';
  const level =
    geoLevel === 'division' ? 'division' : geoLevel === 'block' ? 'block' : 'district';

  const rows = isComposite
    ? await loadCompositeByPeriod(level, periodLabels)
    : await loadIndicatorByPeriod({
        geoLevel: level,
        indicatorCode: code,
        periodLabels,
        isNegative: !!isNegative,
      });

  return rows.map((r) => ({
    period: r.period,
    geo_name: r.name,
    district_name:
      level === 'district' ? r.name : r.district_name || null,
    district_lgd: r.district_lgd != null ? Number(r.district_lgd) : null,
    block_lgd: r.block_lgd != null ? Number(r.block_lgd) : null,
    value: r.value,
    rank: r.rank,
  }));
}

function avg(nums) {
  const xs = nums.filter((x) => x != null && !Number.isNaN(Number(x))).map(Number);
  if (!xs.length) return null;
  return Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4));
}

function roundScore(v, isComposite) {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return isComposite ? Number(n.toFixed(2)) : Number(n.toFixed(2));
}

/**
 * Resolve block by LGD / id / name for breakup scoping.
 */
async function resolveBlockRef(block) {
  if (!block) return null;
  const raw = String(block).trim();
  if (!raw) return null;
  if (raw.includes('__')) {
    const part = raw.split('__').slice(1).join(' ').replace(/-/g, ' ');
    return resolveBlockRef(part);
  }
  const { rows } = await query(
    `
    SELECT b.name AS block_name, d.name AS district_name, b.lgd_code
    FROM block b
    JOIN district d ON d.id = b.district_id
    WHERE b.lgd_code::text = $1
       OR b.id::text = $1
       OR lower(trim(b.name)) = lower(trim($1))
    ORDER BY
      CASE
        WHEN b.lgd_code::text = $1 THEN 0
        WHEN b.id::text = $1 THEN 1
        ELSE 2
      END
    LIMIT 1
    `,
    [raw]
  );
  if (!rows[0]) return { blockName: normalizeGeoName(raw), districtName: null };
  return {
    blockName: rows[0].block_name,
    districtName: rows[0].district_name,
    blockLgd: rows[0].lgd_code != null ? String(rows[0].lgd_code) : null,
  };
}

/**
 * Indicator breakup only (state / division / district / block).
 * Right-panel uses this so block clicks don't rebuild the full rankings tree.
 */
async function buildIndicatorBreakup({
  periodRow,
  fyLabels,
  division,
  district,
  block,
  divCode,
  districtMaster = [],
  filter = 'all',
}) {
  const resolvedBlock = await resolveBlockRef(block);
  const scopeBlock = resolvedBlock?.blockName
    ? normalizeGeoName(resolvedBlock.blockName)
    : block
      ? normalizeGeoName(block)
      : null;
  let resolvedScopeDistrict = district
    ? normalizeGeoName(district)
    : resolvedBlock?.districtName
      ? normalizeGeoName(resolvedBlock.districtName)
      : null;
  // If district looks like an LGD code, resolve name
  if (district && /^\d+$/.test(String(district).trim())) {
    const { rows: distRows } = await query(
      `
      SELECT name FROM district
      WHERE lgd_code::text = $1 OR id::text = $1
      LIMIT 1
      `,
      [String(district).trim()]
    );
    if (distRows[0]) resolvedScopeDistrict = normalizeGeoName(distRows[0].name);
  }
  const scopeDivision = division ? normalizeGeoName(division) : null;
  let breakupGeoLevel = 'district';
  let breakupGeoNames = null;
  let breakupTitle = 'UTTAR PRADESH';
  /** @type {Set<string>|null} */
  let breakupBlockScope = null;

  if (scopeBlock) {
    breakupGeoLevel = 'block';
    breakupGeoNames = [scopeBlock];
    breakupTitle = scopeBlock.toUpperCase();
    breakupBlockScope = new Set([scopeBlock.toLowerCase()]);
    if (!resolvedScopeDistrict && resolvedBlock?.districtName) {
      resolvedScopeDistrict = normalizeGeoName(resolvedBlock.districtName);
    }
  } else if (resolvedScopeDistrict) {
    breakupGeoLevel = 'district';
    breakupGeoNames = [resolvedScopeDistrict];
    breakupTitle = resolvedScopeDistrict.toUpperCase();
  } else if (scopeDivision || divCode) {
    const { rows: divRows } = await query(
      `
      SELECT name, code FROM division
      WHERE ($1::text IS NOT NULL AND (name ILIKE $1 OR name ILIKE $2))
         OR ($3::text IS NOT NULL AND code = $3)
      LIMIT 1
      `,
      [
        scopeDivision || null,
        scopeDivision ? `%${scopeDivision}%` : null,
        divCode || null,
      ]
    );
    if (divRows[0]) {
      breakupTitle = divRows[0].name.toUpperCase();
      breakupGeoNames = (districtMaster || [])
        .filter((d) => d.division_name === divRows[0].name)
        .map((d) => d.district_name);
    }
  }

  // State / division breakup under aspirational | high_priority → restrict district pool
  const filterKey = parseFilter(filter);
  if (filterKey !== 'all' && breakupGeoLevel === 'district' && !scopeBlock) {
    if (!breakupGeoNames) {
      // Full-state breakup: only category districts
      const names = districtNamesForFilter(filterKey, districtMaster);
      if (names && names.length) {
        breakupGeoNames = names;
        breakupTitle =
          filterKey === 'aspirational'
            ? 'ASPIRATIONAL DISTRICTS'
            : 'HIGH PRIORITY DISTRICTS';
      }
    } else if (!resolvedScopeDistrict) {
      // Division (or multi-district) scope: intersect with category
      breakupGeoNames = breakupGeoNames.filter((n) =>
        districtInCategory(n, filterKey)
      );
    }
  }

  const { rows: allInds } = await query(
    `
    SELECT code, short_name, name, unit, FALSE AS is_composite, sno AS sort_order,
           is_negative, domain, domain_label, indicator_type
    FROM indicator
    WHERE is_active = TRUE AND code ~ '^IND\\d{3}$'
    ORDER BY sno NULLS LAST, code
    `
  );

  const breakupPeriodLabels = [...new Set([periodRow.label, ...fyLabels])];
  const breakupLoadLevel = breakupGeoLevel === 'block' ? 'block' : 'district';

  // Load all indicator values from outcome for scoped geos
  const allBreakupRows = [];
  for (const bi of allInds) {
    const rows = await loadValuesForPeriods({
      geoLevel: breakupLoadLevel,
      indicatorCode: bi.code,
      periodLabels: breakupPeriodLabels,
      isNegative: !!bi.is_negative,
    });
    for (const r of rows) {
      allBreakupRows.push({
        indicator_code: bi.code,
        period: r.period,
        geo_name: r.geo_name,
        district_name: r.district_name,
        value: r.value,
        rank: r.rank,
      });
    }
  }

  const scopeSet = breakupGeoNames
    ? new Set(breakupGeoNames.map((n) => n.toLowerCase()))
    : null;
  const scopeDistrictKey = resolvedScopeDistrict
    ? resolvedScopeDistrict.toLowerCase()
    : null;

  let indicator_breakup = allInds.map((bi) => {
    const bRows = allBreakupRows.filter((r) => r.indicator_code === bi.code);
    let scoped = bRows;
    if (breakupBlockScope && breakupGeoLevel === 'block') {
      scoped = bRows.filter((r) => {
        const geoKey = normalizeGeoName(r.geo_name || '').toLowerCase();
        if (!breakupBlockScope.has(geoKey)) return false;
        if (!scopeDistrictKey) return true;
        const distNorm = normalizeGeoName(r.district_name || '').toLowerCase();
        return distNorm === scopeDistrictKey;
      });
    } else if (scopeSet) {
      scoped = bRows.filter((r) =>
        scopeSet.has(String(r.geo_name).toLowerCase())
      );
    }
    const monthRows = scoped.filter((r) => r.period === periodRow.label);
    const monthly = avg(monthRows.map((r) => num(r.value)));
    const upPool = bRows.filter((r) => r.period === periodRow.label);
    const up_avg = avg(upPool.map((r) => num(r.value)));
    const bestPool = monthRows.length ? monthRows : upPool;
    const lowerIsBetter = !!bi.is_negative;
    let best = null;
    for (const r of bestPool) {
      const v = num(r.value);
      if (v == null) continue;
      // Negative indicators (IND010/IND011): lower value is better
      if (
        !best ||
        (lowerIsBetter ? v < best.value : v > best.value)
      ) {
        best = { name: r.geo_name, value: v };
      }
    }
    const fyScopedVals = [];
    for (const pl of fyLabels) {
      const a = avg(
        scoped.filter((r) => r.period === pl).map((r) => num(r.value))
      );
      if (a != null) fyScopedVals.push(a);
    }
    const fy = avg(fyScopedVals);

    const excel = resolveExcelDomainKey(bi.domain_label, bi.domain);
    const typeKey = String(bi.indicator_type || '')
      .trim()
      .toLowerCase() || null;
    const typeInfo = typeKey ? typeMeta(typeKey) : null;
    return {
      code: bi.code,
      indicator: bi.short_name || bi.name,
      name: bi.short_name || bi.name,
      unit: bi.unit,
      is_negative: lowerIsBetter,
      lower_is_better: lowerIsBetter,
      // DOMAIN column / FE accordion: Excel Domain label (never ante_natal / delivery_care)
      domain: excel.label || excel.key,
      domain_key: excel.key,
      domain_label: excel.label,
      domain_slug: bi.domain || null,
      // TYPE column / FE accordion: COVERAGE / QUALITY / DATA QUALITY (not coverage / data_quality)
      type: typeInfo?.label || typeKey,
      type_key: typeKey,
      type_label: typeInfo?.label || null,
      indicator_type: typeKey,
      sort_order: bi.sort_order != null ? Number(bi.sort_order) : null,
      up_avg: roundScore(up_avg, false),
      up_avg_display: formatValue(up_avg, bi.unit),
      best_perf: best
        ? {
            name: best.name,
            value: roundScore(best.value, false),
            display_value: formatValue(best.value, bi.unit),
          }
        : null,
      monthly: roundScore(monthly, false),
      monthly_display: formatValue(monthly, bi.unit),
      fy: roundScore(fy, false),
      fy_display: formatValue(fy, bi.unit),
    };
  });

  // Block breakup: omit indicators with no value for that block
  if (breakupGeoLevel === 'block') {
    indicator_breakup = indicator_breakup.filter((r) => r.monthly != null);
  }

  return {
    breakup_scope: breakupTitle,
    breakup_geo_level: breakupGeoLevel,
    indicator_breakup,
  };
}

function mapBreakupToIndicators(indicator_breakup) {
  return (indicator_breakup || []).map((r) => ({
    code: r.code,
    name: r.indicator || r.name,
    unit: r.unit,
    domain: r.domain_key || r.domain || null,
    domain_label: r.domain_label || null,
    domain_slug: r.domain_slug || null,
    // keep machine key for groupIndicatorsForSummary
    indicator_type: r.type_key || r.indicator_type || null,
    type: r.type_key || r.indicator_type || null,
    type_label: r.type_label || null,
    sort_order: r.sort_order != null ? Number(r.sort_order) : null,
    is_composite: false,
    is_negative: Boolean(r.is_negative || r.lower_is_better),
    lower_is_better: Boolean(r.is_negative || r.lower_is_better),
    value: r.monthly,
    display_value: r.monthly_display,
    up_avg: r.up_avg,
    up_avg_display: r.up_avg_display,
    best_perf: r.best_perf,
    fy: r.fy,
    fy_display: r.fy_display,
    monthly: r.monthly,
    monthly_display: r.monthly_display,
  }));
}

/** Roll up UP AVG / MONTHLY / FY / BEST onto domain|type groups for table breakup. */
function enrichBreakupGroups(groups) {
  return (groups || []).map((g) => {
    const items = g.indicators || [];
    const monthlyVals = items.map((i) => i.monthly ?? i.value).filter((x) => x != null);
    const upVals = items.map((i) => i.up_avg).filter((x) => x != null);
    const fyVals = items.map((i) => i.fy).filter((x) => x != null);
    const monthly =
      monthlyVals.length
        ? Number(
            (
              monthlyVals.reduce((a, b) => a + Number(b), 0) / monthlyVals.length
            ).toFixed(2)
          )
        : null;
    const up_avg =
      upVals.length
        ? Number((upVals.reduce((a, b) => a + Number(b), 0) / upVals.length).toFixed(2))
        : null;
    const fy =
      fyVals.length
        ? Number((fyVals.reduce((a, b) => a + Number(b), 0) / fyVals.length).toFixed(2))
        : null;
    let best_perf = null;
    for (const i of items) {
      const v = i.monthly ?? i.value;
      if (v == null) continue;
      if (!best_perf || Number(v) > Number(best_perf.value)) {
        best_perf = {
          name: i.name || i.indicator,
          value: Number(v),
          display_value: i.monthly_display || i.display_value || String(v),
        };
      }
      if (i.best_perf && i.best_perf.value != null) {
        if (!best_perf || Number(i.best_perf.value) > Number(best_perf.value)) {
          best_perf = { ...i.best_perf };
        }
      }
    }
    const unit = items[0]?.unit || 'percent';
    return {
      key: g.key,
      label: g.label,
      // DOMAIN column in table breakup — always human Excel label
      domain: g.label,
      domain_key: g.key,
      color: g.color,
      count: items.length,
      expandable: true,
      up_avg,
      up_avg_display:
        up_avg == null
          ? null
          : unit === 'percent'
            ? `${up_avg}%`
            : up_avg,
      best_perf,
      monthly,
      monthly_display:
        monthly == null
          ? null
          : unit === 'percent'
            ? `${monthly}%`
            : monthly,
      fy,
      fy_display:
        fy == null ? null : unit === 'percent' ? `${fy}%` : fy,
      indicators: items,
    };
  });
}

/**
 * Shape right-panel INDICATOR BREAKUP for table view dropdown.
 * Query key: breakup_tab=indicator|type|domain  (aliases: breakup_group, group_by)
 */
function parseBreakupTab(raw) {
  const v = String(raw || 'indicator').toLowerCase().trim();
  if (v === 'type' || v === 'by_type' || v === 'types') return 'type';
  if (v === 'domain' || v === 'by_domain' || v === 'domains') return 'domain';
  return 'indicator';
}

function shapeBreakupPanel({
  indicator_breakup,
  by_type,
  by_domain,
  breakupTabRaw,
}) {
  const tab = parseBreakupTab(breakupTabRaw);
  const typeGroups = enrichBreakupGroups(by_type);
  const domainGroups = enrichBreakupGroups(by_domain);

  // breakup_* keys are independent of panel_tab (map SUMMARY shaping).
  const base = {
    breakup_tab: tab,
    breakup_by_type: typeGroups,
    breakup_by_domain: domainGroups,
    // Keep flat list always — FE may group client-side using domain / domain_label
    indicator_breakup: indicator_breakup || [],
  };

  if (tab === 'type') {
    return { ...base, breakup_rows: typeGroups };
  }
  if (tab === 'domain') {
    return { ...base, breakup_rows: domainGroups };
  }
  return { ...base, breakup_rows: indicator_breakup || [] };
}

/**
 * @param {object} opts
 * @param {'division'|'district'|'table'} opts.view  table → use tableMode/level
 * @param {string} [opts.level] frontend level=
 * @param {string} [opts.tableMode] frontend table_mode=
 * @param {string} [opts.period]
 * @param {string} [opts.indicatorCode]
 * @param {'all'|'aspirational'|'high_priority'} [opts.filter]
 * @param {string} [opts.division] selected geo for breakup
 * @param {string} [opts.district]
 * @param {string} [opts.block]
 * @param {string} [opts.divCode]
 * @param {string} [opts.panelTab] indicators|type|domain
 * @param {string} [opts.breakupTab] indicator|type|domain — table INDICATOR BREAKUP dropdown
 * @param {boolean|string|number} [opts.labels]
 * @param {string} [opts.analyticsCompare] timeperiod|…
 * @param {string} [opts.analyticsMode] month|fy
 * @param {boolean|string|number} [opts.breakupOnly]
 */
async function getDeepDiveDashboard({
  view = 'division',
  level,
  tableMode,
  period,
  indicatorCode = 'RANK_COMPOSITE',
  filter = 'all',
  division,
  district,
  block,
  divCode,
  panelTab = 'indicators',
  breakupTab = 'indicator',
  labels = true,
  analyticsCompare = 'timeperiod',
  analyticsMode = 'month',
  breakupOnly = false,
} = {}) {
  const uiView = view === 'table' || String(view).toLowerCase() === 'table' ? 'table' : 'deep_dive';
  const rawGeo =
    String(tableMode || level || (view === 'table' ? 'division' : view) || 'division').toLowerCase();
  const geoLevel = ['division', 'district', 'block'].includes(rawGeo) ? rawGeo : 'division';
  const panel = String(panelTab || 'indicators').toLowerCase();
  const showLabels = labels === true || labels === 1 || labels === '1' || labels === 'true';
  const compare = String(analyticsCompare || 'timeperiod').toLowerCase();
  const mode = String(analyticsMode || 'month').toLowerCase();
  const onlyBreakup =
    breakupOnly === true ||
    breakupOnly === 1 ||
    breakupOnly === '1' ||
    breakupOnly === 'true';

  // Resolve district LGD / id → name for filtering + breakup
  let resolvedDistrict = district || null;
  if (district && /^\d+$/.test(String(district).trim())) {
    const { rows: distRows } = await query(
      `
      SELECT name FROM district
      WHERE lgd_code::text = $1 OR id::text = $1
      LIMIT 1
      `,
      [String(district).trim()]
    );
    if (distRows[0]) resolvedDistrict = distRows[0].name;
  }
  const resolvedBlock = block ? await resolveBlockRef(block) : null;
  const resolvedBlockName = resolvedBlock?.blockName || block || null;
  if (!resolvedDistrict && resolvedBlock?.districtName) {
    resolvedDistrict = resolvedBlock.districtName;
  }

  const needBlockSync =
    geoLevel === 'block' || !!resolvedBlockName || geoLevel === 'district';

  // If FE asked for a concrete month, sync from API first so cache matches upstream
  // (also allows first-time load when that month was never cached).
  const parsedAsk = period ? parsePeriodInput({ period }) : null;
  let syncMeta = null;
  if (parsedAsk) {
    syncMeta = await ensureOutcomeSyncedFromApi({
      year: parsedAsk.year,
      month: parsedAsk.month,
      needBlock: needBlockSync,
    });
  }

  let periodRow = await resolvePeriod(period);
  if (!periodRow && parsedAsk) {
    // Sync succeeded (or period known) but hasDistrict check lagged — serve requested month
    periodRow = {
      ...parsedAsk,
      label: parsedAsk.period_label,
      display: parsedAsk.period_display,
    };
  }
  if (!periodRow) {
    return {
      view: uiView,
      has_data: false,
      message: 'No ranking periods imported yet',
      geo_level: geoLevel,
      level: geoLevel,
      table_mode: geoLevel,
      period: period || null,
      panel_tab: panel,
      labels: showLabels,
      analytics: { compare, mode, periods: [] },
      summary: null,
      rankings: [],
      indicator_breakup: [],
      indicator_options: [],
      breakup_scope: 'UTTAR PRADESH',
    };
  }

  // Latest-period path (no period query): still refresh that month from API
  if (!parsedAsk) {
    syncMeta = await ensureOutcomeSyncedFromApi({
      year: periodRow.year,
      month: periodRow.month,
      needBlock: needBlockSync,
    });
  }

  // Fast path for table right-panel (block / district / division / state)
  if (onlyBreakup) {
    const fyLabels = fyPeriodLabels(periodRow.label);
    let districtMaster = [];
    if (
      ((division || divCode) && !resolvedDistrict && !resolvedBlockName) ||
      parseFilter(filter) !== 'all'
    ) {
      const { rows } = await query(
        `
        SELECT d.name AS district_name, dv.name AS division_name, dv.code AS div_code
        FROM district d
        JOIN division dv ON dv.id = d.division_id
        WHERE d.is_active = TRUE
        `
      );
      districtMaster = rows;
    }
    const breakup = await buildIndicatorBreakup({
      periodRow,
      fyLabels,
      division,
      district: resolvedDistrict,
      block: resolvedBlockName,
      divCode,
      districtMaster,
      filter,
    });
    const indicators = mapBreakupToIndicators(breakup.indicator_breakup);
    const { by_type, by_domain } = groupIndicatorsForSummary(indicators);
    const shaped = shapeBreakupPanel({
      indicator_breakup: breakup.indicator_breakup,
      by_type,
      by_domain,
      breakupTabRaw: breakupTab,
    });
    return {
      view: uiView,
      has_data: (breakup.indicator_breakup || []).some(
        (r) => r.monthly != null || r.fy != null
      ),
      geo_level: geoLevel,
      level: geoLevel,
      table_mode: geoLevel,
      period: periodRow.label,
      period_display: periodRow.display,
      panel_tab: panel,
      labels: showLabels,
      breakup_only: true,
      filter: parseFilter(filter),
      breakup_scope: breakup.breakup_scope,
      breakup_geo_level: breakup.breakup_geo_level,
      summary_scope: breakup.breakup_geo_level,
      district: resolvedDistrict || null,
      block: resolvedBlockName || null,
      ...shaped,
      indicators,
      by_type,
      by_domain,
      rankings: [],
      summary: null,
    };
  }

  const ind = await resolveIndicator(indicatorCode);
  if (!ind) {
    return {
      view: uiView,
      has_data: false,
      message: `Unknown indicator_code: ${indicatorCode}`,
      geo_level: geoLevel,
      level: geoLevel,
      table_mode: geoLevel,
      period: periodRow.label,
      panel_tab: panel,
      labels: showLabels,
      analytics: { compare, mode, periods: [] },
      summary: null,
      rankings: [],
      indicator_breakup: [],
      indicator_options: [],
    };
  }

  // Month columns for timeperiod analytics: outcome periods up to selected
  const allOutcomeLabels = await listOutcomePeriodLabels();
  const analyticsPeriodLabels = allOutcomeLabels.filter((l) => l <= periodRow.label);
  const trendLabels =
    mode === 'fy'
      ? fyPeriodLabels(periodRow.label)
      : analyticsPeriodLabels.length
        ? analyticsPeriodLabels.slice(-6)
        : trailingPeriodLabels(periodRow.label, 6);
  const fyLabels = fyPeriodLabels(periodRow.label);
  const allLabels = [
    ...new Set([...trendLabels, ...fyLabels, periodRow.label, ...analyticsPeriodLabels]),
  ];

  const rowsRaw = await loadValuesForPeriods({
    geoLevel,
    indicatorCode: ind.code,
    periodLabels: allLabels,
    isNegative: !!ind.is_negative,
  });

  // District master → division for hierarchy / filters
  const { rows: districtMaster } = await query(
    `
    SELECT d.name AS district_name, dv.name AS division_name, dv.code AS div_code
    FROM district d
    JOIN division dv ON dv.id = d.division_id
    WHERE d.is_active = TRUE
    `
  );
  const divisionByDistrict = new Map();
  for (const r of districtMaster) {
    divisionByDistrict.set(r.district_name.toLowerCase(), {
      division: r.division_name,
      div_code: r.div_code,
    });
  }

  // Apply geo filters (same intent as map view)
  let rows = rowsRaw;
  if (geoLevel === 'block' && resolvedDistrict) {
    const distKey = normalizeGeoName(resolvedDistrict).toLowerCase();
    rows = rows.filter(
      (r) => normalizeGeoName(r.district_name || '').toLowerCase() === distKey
    );
  } else if (geoLevel === 'district' && (divCode || division)) {
    const allowed = new Set(
      districtMaster
        .filter((d) => {
          if (divCode && String(d.div_code) === String(divCode)) return true;
          if (
            division &&
            normalizeGeoName(d.division_name) === normalizeGeoName(division)
          ) {
            return true;
          }
          return false;
        })
        .map((d) => d.district_name.toLowerCase())
    );
    if (allowed.size) {
      rows = rows.filter((r) => allowed.has(String(r.geo_name || '').toLowerCase()));
    }
  } else if (geoLevel === 'division' && (divCode || division)) {
    let divKey = division ? normalizeGeoName(division).toLowerCase() : null;
    if (!divKey && divCode) {
      const { rows: divRows } = await query(
        `SELECT name FROM division WHERE code = $1 LIMIT 1`,
        [String(divCode)]
      );
      if (divRows[0]) divKey = normalizeGeoName(divRows[0].name).toLowerCase();
    }
    if (divKey) {
      rows = rowsRaw.filter(
        (r) => normalizeGeoName(r.geo_name || '').toLowerCase() === divKey
      );
    }
  }

  // Block table: if this indicator has no block values (common for some INDs),
  // still list the district's blocks (from composite headers) with null scores
  // so the response shape stays consistent across indicators.
  let indicatorHasBlockValues = true;
  if (geoLevel === 'block' && resolvedDistrict) {
    const periodHasValues = rows.some((r) => r.period === periodRow.label && r.value != null);
    if (!periodHasValues) {
      indicatorHasBlockValues = false;
      const compositeScaffold = await loadValuesForPeriods({
        geoLevel: 'block',
        indicatorCode: 'RANK_COMPOSITE',
        periodLabels: [periodRow.label],
        isNegative: false,
      });
      const distKey = normalizeGeoName(resolvedDistrict).toLowerCase();
      const scaffold = compositeScaffold.filter(
        (r) => normalizeGeoName(r.district_name || '').toLowerCase() === distKey
      );
      const seen = new Set();
      for (const r of scaffold) {
        const key = String(r.geo_name || '').toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push({
          period: periodRow.label,
          geo_name: r.geo_name,
          district_name: r.district_name || resolvedDistrict,
          district_lgd: r.district_lgd,
          block_lgd: r.block_lgd,
          value: null,
          rank: null,
        });
      }
    }
  }

  // Pivot: geo_name → period → {value, rank}
  // For blocks, key by district||block to avoid cross-district name collisions
  const byGeo = new Map();
  const geoMeta = new Map();
  for (const r of rows) {
    const key =
      geoLevel === 'block'
        ? `${String(r.district_name || '').toLowerCase()}||${String(r.geo_name || '').toLowerCase()}`
        : r.geo_name;
    if (!byGeo.has(key)) {
      byGeo.set(key, new Map());
      geoMeta.set(key, {
        name: r.geo_name,
        district_name: r.district_name || (geoLevel === 'district' ? r.geo_name : null),
        block_lgd: r.block_lgd || null,
        district_lgd: r.district_lgd || null,
      });
    }
    byGeo.get(key).set(r.period, {
      value: num(r.value),
      rank: r.rank != null ? Number(r.rank) : null,
    });
  }

  let geoKeys = [...byGeo.keys()].sort((a, b) => {
    const na = geoMeta.get(a)?.name || a;
    const nb = geoMeta.get(b)?.name || b;
    return String(na).localeCompare(String(nb));
  });

  // Category filter: aspirational | high_priority (skip at block level)
  const filterKey = parseFilter(filter);
  let filter_note = null;
  if (filterKey !== 'all' && geoLevel !== 'block') {
    if (geoLevel === 'district') {
      geoKeys = geoKeys.filter((k) =>
        districtInCategory(geoMeta.get(k)?.name || k, filterKey)
      );
    } else if (geoLevel === 'division') {
      const allowedDivs = divisionsMatchingCategory(districtMaster, filterKey);
      if (allowedDivs) {
        geoKeys = geoKeys.filter((k) =>
          allowedDivs.has(normalizeKey(geoMeta.get(k)?.name || k))
        );
      }
    }
    if (!geoKeys.length) {
      filter_note =
        filterKey === 'aspirational'
          ? 'No aspirational districts matched for this geo level'
          : 'No high_priority districts matched for this geo level';
    }
  } else if (filterKey !== 'all' && geoLevel === 'block') {
    filter_note = 'Category filter skipped at block level';
  }

  const isComposite = !!ind.is_composite;

  function buildFromSeries(geoName, series, extra = {}) {
    const monthlyCell = series.get(periodRow.label);
    const monthly = monthlyCell ? monthlyCell.value : null;
    const fy = avg(fyLabels.map((pl) => (series.get(pl) ? series.get(pl).value : null)));
    const trend_series = trendLabels.map((pl) => {
      const c = series.get(pl);
      return {
        period: pl,
        value: c ? roundScore(c.value, isComposite) : null,
        rank: c ? c.rank : null,
      };
    });
    const period_values = {};
    for (const pl of analyticsPeriodLabels) {
      const c = series.get(pl);
      period_values[pl] = c ? roundScore(c.value, isComposite) : null;
    }
    const trendDelta = (() => {
      const vals = trend_series.map((t) => t.value).filter((x) => x != null);
      if (vals.length < 2) return null;
      return roundScore(vals[vals.length - 1] - vals[0], true);
    })();

    return {
      name: geoName,
      rank: monthlyCell ? monthlyCell.rank : null,
      state_rank: monthlyCell ? monthlyCell.rank : null,
      monthly: roundScore(monthly, isComposite),
      monthly_display: isComposite
        ? roundScore(monthly, true)
        : formatValue(monthly, ind.unit),
      fy: roundScore(fy, isComposite),
      fy_display: isComposite ? roundScore(fy, true) : formatValue(fy, ind.unit),
      trend_series,
      trend_delta: trendDelta,
      period_values,
      ...extra,
    };
  }

  function buildRow(geoKey) {
    const meta = geoMeta.get(geoKey) || { name: geoKey };
    return buildFromSeries(meta.name, byGeo.get(geoKey) || new Map(), {
      geo_level: geoLevel,
      district_name: meta.district_name || null,
      block_lgd: meta.block_lgd || null,
      district_lgd: meta.district_lgd || null,
    });
  }

  function sortRankRows(a, b) {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    if (a.monthly != null && b.monthly != null) return b.monthly - a.monthly;
    return a.name.localeCompare(b.name);
  }

  // Block series keyed by district → block name (for Division→District→Block expand)
  const blockRows = await loadValuesForPeriods({
    geoLevel: 'block',
    indicatorCode: ind.code,
    periodLabels: allLabels,
    isNegative: !!ind.is_negative,
  });
  /** @type {Map<string, Map<string, Map<string, {value:number|null, rank:number|null}>>>} */
  const blocksByDistrict = new Map();
  for (const r of blockRows) {
    const distKey = String(r.district_name || '').toLowerCase();
    if (!distKey) continue;
    if (!blocksByDistrict.has(distKey)) blocksByDistrict.set(distKey, new Map());
    const byBlock = blocksByDistrict.get(distKey);
    if (!byBlock.has(r.geo_name)) byBlock.set(r.geo_name, new Map());
    byBlock.get(r.geo_name).set(r.period, {
      value: num(r.value),
      rank: r.rank != null ? Number(r.rank) : null,
    });
  }

  function buildBlockChildren(districtName) {
    const byBlock = blocksByDistrict.get(String(districtName).toLowerCase());
    if (!byBlock) return [];
    return [...byBlock.keys()]
      .map((blockName) =>
        buildFromSeries(blockName, byBlock.get(blockName) || new Map(), {
          geo_level: 'block',
          district_name: districtName,
          children: null,
          child_count: 0,
          expandable: false,
        })
      )
      .sort(sortRankRows);
  }

  let rankings = geoKeys.map(buildRow);
  rankings.sort(sortRankRows);

  // Attach district children under each division (By Division tab expand)
  // and block children under each district (Division → District → Block)
  if (geoLevel === 'division') {
    const districtRows = await loadValuesForPeriods({
      geoLevel: 'district',
      indicatorCode: ind.code,
      periodLabels: allLabels,
      isNegative: !!ind.is_negative,
    });
    const distByGeo = new Map();
    for (const r of districtRows) {
      if (!distByGeo.has(r.geo_name)) distByGeo.set(r.geo_name, new Map());
      distByGeo.get(r.geo_name).set(r.period, {
        value: num(r.value),
        rank: r.rank != null ? Number(r.rank) : null,
      });
    }

    function buildDistrictRow(geoName) {
      const blockChildren = buildBlockChildren(geoName);
      return buildFromSeries(geoName, distByGeo.get(geoName) || new Map(), {
        geo_level: 'district',
        children: blockChildren,
        child_count: blockChildren.length,
        expandable: blockChildren.length > 0,
      });
    }

    let allDistrictNames = [...distByGeo.keys()];
    if (filterKey === 'aspirational' || filterKey === 'high_priority') {
      allDistrictNames = allDistrictNames.filter((n) =>
        districtInCategory(n, filterKey)
      );
    }

    rankings = rankings
      .map((divRow) => {
        const children = allDistrictNames
          .filter((dn) => {
            const meta = divisionByDistrict.get(dn.toLowerCase());
            return meta && meta.division === divRow.name;
          })
          .map(buildDistrictRow)
          .sort(sortRankRows);
        return {
          ...divRow,
          geo_level: 'division',
          children,
          child_count: children.length,
          expandable: children.length > 0,
        };
      })
      .filter((divRow) => {
        // Drop divisions with no matching category districts
        if (filterKey === 'all') return true;
        return (divRow.children || []).length > 0;
      });
  } else if (geoLevel === 'district') {
    // By District tab: expand district → blocks
    rankings = rankings.map((distRow) => {
      const blockChildren = buildBlockChildren(distRow.name);
      return {
        ...distRow,
        geo_level: 'district',
        children: blockChildren,
        child_count: blockChildren.length,
        expandable: blockChildren.length > 0,
      };
    });
  } else if (geoLevel === 'block') {
    rankings = rankings.map((row, idx) => ({
      ...row,
      geo_level: 'block',
      // Keep API rank on rank/local_rank; list_index = position in this list
      local_rank: row.rank != null ? row.rank : row.state_rank != null ? row.state_rank : idx + 1,
      list_index: idx + 1,
      children: null,
      child_count: 0,
      expandable: false,
    }));
  }

  // State (UP) aggregate row
  const stateMonthly = avg(rankings.map((r) => r.monthly));
  const stateFy = avg(rankings.map((r) => r.fy));
  const stateTrend = trendLabels.map((pl) => {
    const vals = rankings
      .map((r) => {
        const t = (r.trend_series || []).find((x) => x.period === pl);
        return t ? t.value : null;
      })
      .filter((x) => x != null);
    return { period: pl, value: roundScore(avg(vals), isComposite), rank: null };
  });
  const statePeriodValues = {};
  for (const pl of analyticsPeriodLabels) {
    const vals = rankings
      .map((r) => (r.period_values ? r.period_values[pl] : null))
      .filter((x) => x != null);
    statePeriodValues[pl] = roundScore(avg(vals), isComposite);
  }

  const stateRow = {
    name: 'Uttar Pradesh',
    is_state: true,
    rank: null,
    monthly: roundScore(stateMonthly, isComposite),
    monthly_display: isComposite
      ? roundScore(stateMonthly, true)
      : formatValue(stateMonthly, ind.unit),
    fy: roundScore(stateFy, isComposite),
    fy_display: isComposite ? roundScore(stateFy, true) : formatValue(stateFy, ind.unit),
    trend_series: stateTrend,
    period_values: statePeriodValues,
    children: null,
  };

  // Summary cards — scoped to current geo list (districts or blocks)
  const summarySourceLevel = geoLevel === 'block' ? 'block' : 'district';
  const summaryRows = await loadValuesForPeriods({
    geoLevel: summarySourceLevel,
    indicatorCode: ind.code,
    periodLabels: [periodRow.label, prevMonthLabel(periodRow.label)].filter(Boolean),
    isNegative: !!ind.is_negative,
  });
  let summaryCurrent = summaryRows.filter((r) => r.period === periodRow.label);
  if (geoLevel === 'block' && resolvedDistrict) {
    const distKey = normalizeGeoName(resolvedDistrict).toLowerCase();
    summaryCurrent = summaryCurrent.filter(
      (r) => normalizeGeoName(r.district_name || '').toLowerCase() === distKey
    );
  } else if (geoLevel === 'district' && (divCode || division)) {
    const allowed = new Set(
      districtMaster
        .filter((d) => {
          if (divCode && String(d.div_code) === String(divCode)) return true;
          if (
            division &&
            normalizeGeoName(d.division_name) === normalizeGeoName(division)
          ) {
            return true;
          }
          return false;
        })
        .map((d) => d.district_name.toLowerCase())
    );
    if (allowed.size) {
      summaryCurrent = summaryCurrent.filter((r) =>
        allowed.has(String(r.geo_name || '').toLowerCase())
      );
    }
  }
  const distScores = summaryCurrent
    .map((r) => ({ name: r.geo_name, score: num(r.value), rank: r.rank }))
    .filter((r) => r.score != null)
    .sort((a, b) => b.score - a.score);

  const prevLabel = prevMonthLabel(periodRow.label);
  const compareLabel = prevLabel;
  let summaryPrev = summaryRows.filter((r) => r.period === compareLabel);
  if (geoLevel === 'block' && resolvedDistrict) {
    const distKey = normalizeGeoName(resolvedDistrict).toLowerCase();
    summaryPrev = summaryPrev.filter(
      (r) => normalizeGeoName(r.district_name || '').toLowerCase() === distKey
    );
  }
  const avgNow = avg(distScores.map((d) => d.score));
  const avgPrev = avg(summaryPrev.map((r) => num(r.value)));
  const avgChange =
    avgNow != null && avgPrev != null ? roundScore(avgNow - avgPrev, true) : null;

  const entityLabel = geoLevel === 'block' ? 'blocks' : 'districts';
  const summary = {
    total_districts: distScores.length,
    total_entities: distScores.length,
    entity_level: geoLevel === 'block' ? 'block' : 'district',
    top_district: distScores[0]
      ? { name: distScores[0].name, score: roundScore(distScores[0].score, isComposite) }
      : null,
    lowest_district: distScores.length
      ? {
          name: distScores[distScores.length - 1].name,
          score: roundScore(distScores[distScores.length - 1].score, isComposite),
        }
      : null,
    average_score: roundScore(avgNow, isComposite),
    average_change: avgChange,
    average_change_vs_period: compareLabel,
    note: `Summary over ${distScores.length} ${entityLabel}`,
  };

  // Indicator options for dropdown (from outcome master indicators)
  const { rows: indOpts } = await query(
    `
    SELECT code, short_name, name, unit, FALSE AS is_composite, sno AS sort_order
    FROM indicator
    WHERE is_active = TRUE AND code ~ '^IND\\d{3}$'
    ORDER BY sno NULLS LAST, code
    `
  );
  const indicator_options = [
    {
      code: 'RANK_COMPOSITE',
      name: 'Overall composite score',
      short_name: 'Overall composite score',
      unit: 'index',
      is_composite: true,
    },
    ...indOpts.map((r) => ({
      code: r.code,
      name: r.short_name || r.name,
      short_name: r.short_name || r.name,
      unit: r.unit,
      is_composite: false,
    })),
  ];

  const breakup = await buildIndicatorBreakup({
    periodRow,
    fyLabels,
    division,
    district: resolvedDistrict,
    block: resolvedBlockName,
    divCode,
    districtMaster,
    filter: filterKey,
  });
  const breakupTitle = breakup.breakup_scope;
  const indicator_breakup = breakup.indicator_breakup;
  const indicators = mapBreakupToIndicators(indicator_breakup);
  const { by_type, by_domain } = groupIndicatorsForSummary(indicators);
  const shapedBreakup = shapeBreakupPanel({
    indicator_breakup,
    by_type,
    by_domain,
    breakupTabRaw: breakupTab,
  });

  // SUMMARY panel groups (panel_tab) — separate from table breakup_tab
  const summaryGroups = { by_type, by_domain };

  const tabLabel =
    geoLevel === 'division'
      ? 'By Division'
      : geoLevel === 'block'
        ? 'By Block'
        : 'By District';

  return {
    view: uiView,
    has_data: rankings.length > 0 || distScores.length > 0,
    geo_level: geoLevel,
    level: geoLevel,
    table_mode: geoLevel,
    tab: tabLabel,
    period: periodRow.label,
    period_display: periodRow.display,
    panel_tab: panel,
    labels: showLabels,
    filter: filterKey,
    filter_note,
    analytics: {
      compare,
      mode,
      periods: analyticsPeriodLabels,
      period_columns: analyticsPeriodLabels,
    },
    selected_indicator: {
      code: ind.code,
      name: ind.short_name || ind.name,
      unit: ind.unit,
      is_composite: ind.is_composite,
      has_block_values: indicatorHasBlockValues !== false,
    },
    indicator_has_block_values: indicatorHasBlockValues !== false,
    missing_block_values_message:
      indicatorHasBlockValues === false
        ? 'No block-level values for this indicator in the outcome cache; block rows listed with empty scores.'
        : null,
    trend_from: trendLabels[0] || null,
    trend_to: trendLabels[trendLabels.length - 1] || null,
    fy_periods: fyLabels,
    summary,
    state_row: stateRow,
    rankings,
    ranking: rankings,
    count: rankings.length,
    hierarchy:
      geoLevel === 'division'
        ? ['division', 'district', 'block']
        : geoLevel === 'block'
          ? ['block']
          : ['district', 'block'],
    breakup_scope: breakupTitle,
    breakup_geo_level: breakup.breakup_geo_level,
    summary_scope: breakup.breakup_geo_level || (resolvedDistrict ? 'district' : 'state'),
    district: resolvedDistrict || null,
    block: resolvedBlockName || null,
    ...shapedBreakup,
    // left SUMMARY tabs (panel_tab) — independent of breakup_tab
    indicators,
    ...summaryGroups,
    indicator_options,
  };
}

module.exports = {
  getDeepDiveDashboard,
  ASPIRATIONAL_DISTRICTS,
};
