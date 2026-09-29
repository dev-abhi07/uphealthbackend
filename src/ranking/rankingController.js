const path = require('path');
const rankingService = require('../ranking/rankingService');
const rankingDeepDiveService = require('../ranking/rankingDeepDiveService');
const rankingAnalyticsService = require('../ranking/rankingAnalyticsService');
const rankingExecutiveSummaryService = require('../ranking/rankingExecutiveSummaryService');
const rankingExecutiveInsightsService = require('../ranking/rankingExecutiveInsightsService');
const rankingTrendService = require('../ranking/rankingTrendService');
const {
  applyGeoCategoryFilter,
  parseFilter,
} = require('../ranking/geoCategoryFilter');
const { applyPanelTabShape, parsePanelTab } = require('../ranking/rankingRegistry');
const { query } = require('../db/pool');
const {
  resolveUserGeoScope,
  enforceQueryGeoScope,
  filterRankingsByScope,
  scopeMeta,
} = require('../services/geoScopeService');
const { asyncHandler } = require('../middleware/errorHandler');

async function runAnalyticsFromQuery(query) {
  const opts = rankingAnalyticsService.parseFrontendAnalyticsQuery(query);
  return rankingAnalyticsService.getAnalyticsDashboard(opts);
}

async function withUserScope(req) {
  const scope = await resolveUserGeoScope(req.user);
  enforceQueryGeoScope(req.query, scope);
  return scope;
}

function attachScopedRankings(data, scope, geoLevel) {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data.rankings)) {
    data.rankings = filterRankingsByScope(data.rankings, scope, geoLevel);
  }
  if (Array.isArray(data.ranking)) {
    data.ranking = filterRankingsByScope(data.ranking, scope, geoLevel);
    data.count = data.ranking.length;
  }

  // Keep gauge / overall in sync with scoped ranking (division avg of districts)
  // Do not overwrite when summary is already district/block-selected.
  if (
    scope &&
    !scope.isStateAdmin &&
    !scope.unrestricted &&
    Array.isArray(data.ranking) &&
    data.ranking.length &&
    data.summary_scope !== 'district' &&
    data.summary_scope !== 'block'
  ) {
    const scores = data.ranking
      .map((r) => (r.score != null ? Number(r.score) : null))
      .filter((x) => x != null && !Number.isNaN(x));
    if (scores.length) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      data.overall_composite_score = Number(avg.toFixed(4));
      if (data.selected_indicator && data.selected_indicator.is_composite) {
        data.selected_indicator.average = data.overall_composite_score;
        data.selected_indicator.average_display = data.overall_composite_score;
      }
    }
  }

  data.user_scope = scopeMeta(scope);
  if (scope?.level === 'division') {
    data.locked_division = {
      id: scope.divisionId,
      name: scope.divisionName,
      code: scope.divisionCode,
      district_count: (scope.districtNamesInDivision || []).length,
      districts: scope.districtNamesInDivision || [],
    };
  }
  if (scope?.level === 'district') {
    data.locked_district = {
      id: scope.districtId,
      name: scope.districtName,
      lgd: scope.districtLgd,
      division_id: scope.divisionId,
      division_name: scope.divisionName,
      block_count: (scope.blockNamesInDistrict || []).length,
      blocks: scope.blockNamesInDistrict || [],
    };
  }
  return data;
}

async function dashboard(req, res) {
  const scope = await withUserScope(req);
  const uiView = String(req.query.view || 'map').toLowerCase();
  const rawLevel = String(req.query.geo_level || req.query.level || 'division').toLowerCase();
  const tableMode = String(req.query.table_mode || '').toLowerCase() || null;

  // Overall Composite Score analytics — same query string as health-ranking UI
  // e.g. view=analytics&analytics_mode=quarter&analytics_from=2026-Q1
  //      &district_id=auraiya&block_id=auraiya__erwa-katra&area_id=auraiya__erwa-katra
  if (uiView === 'analytics') {
    const data = await runAnalyticsFromQuery(req.query);
    return res.json({
      success: true,
      ...applyPanelTabShape(
        attachScopedRankings(data, scope, rawLevel),
        req.query.panel_tab,
        { defaultTab: 'all' }
      ),
    });
  }

  // VIEW BY: Trend (also available as GET /api/ranking/trend)
  if (uiView === 'trend') {
    const data = await rankingTrendService.getTrendDashboard(req.query);
    return res.json({
      success: true,
      ...data,
      user_scope: scopeMeta(scope),
    });
  }

  // Executive Summary screen
  if (uiView === 'executive' || uiView === 'executive_summary') {
    let level = String(req.query.level || req.query.geo_level || 'division').toLowerCase();
    if (scope?.level === 'district' || scope?.level === 'block') level = 'district';
    else if (scope?.level === 'division') level = 'division';
    if (!['division', 'district'].includes(level)) {
      return res.status(400).json({
        success: false,
        message: 'For view=executive, level must be division or district',
      });
    }
    const data = await rankingExecutiveSummaryService.getExecutiveSummary({
      period: req.query.period || req.query.analytics_period,
      level,
      topN: req.query.top_n ? Number(req.query.top_n) : 3,
      historyMonths: req.query.history_months ? Number(req.query.history_months) : 3,
    });
    return res.json({
      success: true,
      ...attachScopedRankings(data, scope, level),
      user_scope: scopeMeta(scope),
    });
  }

  // Table / Deep Dive view — same geo tier rules as map view
  // e.g. view=table&level=district&table_mode=district&period=2026-07
  if (uiView === 'table') {
    let tableLevel = String(tableMode || rawLevel || 'division').toLowerCase();
    // Scoped users: open at their geo tier, honour explicit block drill-down
    if (scope?.level === 'block') {
      tableLevel = 'block';
    } else if (scope?.level === 'district') {
      tableLevel = 'block';
    } else if (scope?.level === 'division') {
      if (
        (rawLevel === 'block' || tableLevel === 'block') &&
        (req.query.district || req.query.dt_lgd || req.query.district_lgd)
      ) {
        tableLevel = 'block';
      } else if (tableLevel === 'division' || !tableLevel) {
        tableLevel = 'district';
      } else {
        tableLevel = 'district';
      }
    }
    if (!['division', 'district', 'block'].includes(tableLevel)) {
      return res.status(400).json({
        success: false,
        message: 'For view=table, level/table_mode must be division, district, or block',
      });
    }
    const filter = String(req.query.filter || 'all').toLowerCase();
    if (!['all', 'aspirational', 'high_priority'].includes(filter)) {
      return res.status(400).json({
        success: false,
        message: 'filter must be one of: all, aspirational, high_priority',
      });
    }

    const district =
      req.query.district ||
      req.query.district_name ||
      req.query.selected_district ||
      req.query.district_lgd ||
      req.query.dt_lgd ||
      req.query.lgd ||
      req.query.district_id ||
      null;
    const block =
      req.query.block ||
      req.query.block_name ||
      req.query.selected_block ||
      req.query.block_lgd ||
      req.query.block_id ||
      null;

    const data = await rankingDeepDiveService.getDeepDiveDashboard({
      view: 'table',
      level: tableLevel,
      tableMode: tableLevel,
      period: req.query.period,
      indicatorCode: req.query.indicator_code || req.query.indicator || 'RANK_COMPOSITE',
      filter,
      division: req.query.division || scope?.divisionName || null,
      district,
      block,
      divCode:
        req.query.div_code ||
        (scope?.divisionCode ? String(scope.divisionCode) : null) ||
        (/^\d+$/.test(String(req.query.parent_area_id || ''))
          ? req.query.parent_area_id
          : null),
      panelTab: req.query.panel_tab || 'indicators',
      breakupTab:
        req.query.breakup_tab ||
        req.query.breakup_group ||
        req.query.group_by ||
        'indicator',
      labels: req.query.labels,
      analyticsCompare: req.query.analytics_compare || 'timeperiod',
      analyticsMode: req.query.analytics_mode || 'month',
      // District users need the block ranking list; FE often sends breakup_only=1
      // on the main table load. Only honour breakup_only when a block is selected.
      breakupOnly:
        (req.query.breakup_only === '1' ||
          req.query.breakup_only === 'true' ||
          req.query.breakupOnly === '1') &&
        !(scope?.level === 'district' && !block),
    });

    // District-scoped table: same shape for every indicator —
    // flat blocks as rankings/ranking/block_rankings (+ district_tree for expand UIs).
    if (scope?.level === 'district' && !block) {
      const scopedFlat = attachScopedRankings({ ...data }, scope, 'block');
      const blocks = Array.isArray(scopedFlat.rankings)
        ? scopedFlat.rankings.filter((r) => r && !r.is_state)
        : Array.isArray(scopedFlat.ranking)
          ? scopedFlat.ranking.filter((r) => r && !r.is_state)
          : [];
      const flatBlocks = [];
      for (const row of blocks) {
        if (
          row.geo_level === 'block' ||
          (!row.children?.length && (row.district_name || row.block_lgd != null))
        ) {
          flatBlocks.push({ ...row, geo_level: 'block' });
        } else if (Array.isArray(row.children) && row.children.length) {
          for (const child of row.children) {
            flatBlocks.push({
              ...child,
              geo_level: 'block',
              district_name: child.district_name || row.name || scope.districtName,
            });
          }
        }
      }
      const blockRows =
        flatBlocks.length > 0
          ? flatBlocks
          : blocks.map((r) => ({ ...r, geo_level: 'block' }));

      // Parent score for the SELECTED indicator (not always composite)
      let districtMonthly = null;
      let districtMonthlyDisplay = null;
      try {
        const indCode =
          req.query.indicator_code || req.query.indicator || 'RANK_COMPOSITE';
        const distDash = await rankingDeepDiveService.getDeepDiveDashboard({
          view: 'table',
          level: 'district',
          tableMode: 'district',
          period: req.query.period,
          indicatorCode: indCode,
          district: scope.districtName,
          divCode: scope.divisionCode ? String(scope.divisionCode) : null,
          panelTab: 'indicators',
          breakupOnly: false,
        });
        const distRow = (distDash.rankings || []).find(
          (r) =>
            !r.is_state &&
            String(r.name || '').toLowerCase() ===
              String(scope.districtName).toLowerCase()
        );
        if (distRow) {
          districtMonthly = distRow.monthly;
          districtMonthlyDisplay = distRow.monthly_display;
        }
      } catch (_) {
        /* optional */
      }
      if (districtMonthly == null) {
        const scores = blockRows
          .map((r) => (r.monthly != null ? Number(r.monthly) : null))
          .filter((x) => x != null && !Number.isNaN(x));
        if (scores.length) {
          districtMonthly = Number(
            (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)
          );
          districtMonthlyDisplay = districtMonthly;
        }
      }

      const densifiedBlocks = blockRows.map((r, i) => {
        const apiRank =
          r.state_rank != null
            ? Number(r.state_rank)
            : r.rank != null
              ? Number(r.rank)
              : null;
        const rank = apiRank != null ? apiRank : i + 1;
        return {
          ...r,
          geo_level: 'block',
          district_name: r.district_name || scope.districtName,
          list_index: i + 1,
          local_rank: rank,
          rank,
          state_rank: rank,
          children: null,
          child_count: 0,
          expandable: false,
        };
      });

      let districtApiRank = null;
      try {
        const distOutcome = await rankingService.getDistrictDashboard({
          period: req.query.period,
          district: scope.districtName,
          skipOutcomeSync: true,
        });
        const hit = (distOutcome.ranking || []).find(
          (r) =>
            String(r.name || '').toLowerCase() ===
            String(scope.districtName).toLowerCase()
        );
        if (hit) {
          districtApiRank =
            hit.state_rank != null
              ? Number(hit.state_rank)
              : hit.rank != null
                ? Number(hit.rank)
                : null;
        }
      } catch (_) {
        /* optional */
      }

      const parentRow = {
        name: scope.districtName,
        district_name: scope.districtName,
        district_lgd: scope.districtLgd,
        geo_level: 'district',
        rank: districtApiRank != null ? districtApiRank : null,
        state_rank: districtApiRank,
        local_rank: 1,
        monthly: districtMonthly,
        monthly_display:
          districtMonthlyDisplay != null ? districtMonthlyDisplay : districtMonthly,
        children: densifiedBlocks,
        child_count: densifiedBlocks.length,
        expandable: densifiedBlocks.length > 0,
        expanded: true,
        auto_expand: true,
      };

      data.district = scope.districtName;
      data.summary_scope = 'district';
      data.show_blocks = true;
      data.list_title = 'ALL BLOCKS';
      data.hierarchy = ['block'];
      data.geo_level = 'block';
      data.level = 'block';
      data.table_mode = 'block';
      data.tab = 'By Block';
      data.auto_expand_district = true;
      // Primary list is ALWAYS flat blocks (same for composite and every IND*)
      data.rankings = densifiedBlocks;
      data.ranking = densifiedBlocks;
      data.block_rankings = densifiedBlocks;
      data.count = densifiedBlocks.length;
      data.district_tree = [parentRow];
      data.parent_district = parentRow;
      data.state_row = null;
      data.user_scope = scopedFlat.user_scope;
      data.locked_district = scopedFlat.locked_district;
      if (data.selected_indicator) {
        data.selected_indicator = {
          ...data.selected_indicator,
          has_block_values: data.indicator_has_block_values !== false,
        };
      }

      return res.json({
        success: true,
        ...applyPanelTabShape(data, req.query.panel_tab, {
          defaultTab: 'indicators',
        }),
      });
    }

    return res.json({
      success: true,
      ...applyPanelTabShape(
        attachScopedRankings(data, scope, tableLevel),
        req.query.panel_tab,
        { defaultTab: 'indicators' }
      ),
    });
  }

  if (!['division', 'district', 'block'].includes(rawLevel)) {
    return res.status(400).json({
      success: false,
      message: 'geo_level / level must be one of: division, district, block',
    });
  }
  if (tableMode && !['division', 'district', 'block'].includes(tableMode)) {
    return res.status(400).json({
      success: false,
      message: 'table_mode must be one of: division, district, block',
    });
  }

  let mapLevel = rawLevel;
  // Scoped users: open at their geo tier, but honour explicit drill-down
  // (division user → district list by default; level=block+district=… → blocks)
  if (scope?.level === 'block') {
    mapLevel = 'block';
  } else if (scope?.level === 'district') {
    mapLevel = 'block';
  } else if (scope?.level === 'division') {
    if (rawLevel === 'block' && (req.query.district || req.query.dt_lgd || req.query.district_lgd)) {
      mapLevel = 'block';
    } else {
      mapLevel = 'district';
    }
  }

  // Division users → districts (unless drilling into blocks); district users → blocks
  let effectiveTableMode = tableMode;
  if (scope?.level === 'division') {
    if (mapLevel === 'block') {
      effectiveTableMode = 'block';
    } else if (!effectiveTableMode || effectiveTableMode === 'division') {
      effectiveTableMode = 'district';
    }
  }
  if (
    scope?.level === 'district' &&
    (!effectiveTableMode || effectiveTableMode === 'division' || effectiveTableMode === 'district')
  ) {
    effectiveTableMode = 'block';
  }

  const opts = {
    period: req.query.period,
    // Prefer explicit district name; area_id must be LGD (Pilibhit=173) or master id (59)
    district:
      req.query.district ||
      req.query.district_name ||
      req.query.selected_district ||
      req.query.district_lgd ||
      req.query.dt_lgd ||
      req.query.lgd ||
      // district_id = master PK (Pilibhit=59) — check before area_id
      req.query.district_id ||
      (req.query.area_id &&
      !String(req.query.area_id).includes('__') &&
      !req.query.block_id &&
      !req.query.block
        ? req.query.area_id
        : null) ||
      null,
    // Block click: FE often sends block_id = Block LGD (Bakshi-Ka-Talab = 1329)
    block:
      req.query.block ||
      req.query.block_name ||
      req.query.selected_block ||
      req.query.block_lgd ||
      req.query.block_id ||
      (req.query.area_id && String(req.query.area_id).includes('__')
        ? req.query.area_id
        : null) ||
      null,
    divCode: req.query.div_code || (scope?.divisionCode ? String(scope.divisionCode) : null),
    division: req.query.division || scope?.divisionName || null,
    parentAreaId: /^\d+$/.test(String(req.query.parent_area_id || ''))
      ? req.query.parent_area_id
      : scope?.divisionCode
        ? String(scope.divisionCode)
        : null,
    tableMode: effectiveTableMode,
    mapLevel,
    indicatorCode: req.query.indicator_code || req.query.indicator || null,
  };

  // Drill-down: map stays on division, table shows districts under div_code
  // e.g. level=division&table_mode=district&div_code=14595
  let data = await rankingService.getRankingDashboard(opts);

  // District-scoped user on block map:
  // - no block selected → SUMMARY = district; ranking stays all blocks
  // - block selected → keep getBlockDashboard summary (already block-scoped)
  if (scope?.level === 'district' && mapLevel === 'block' && scope.districtName && !opts.block) {
    const distSummary = await rankingService.getDistrictDashboard({
      period: opts.period,
      district: scope.districtName,
      indicatorCode: opts.indicatorCode,
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
        district: distSummary.district || scope.districtName,
        district_lgd: distSummary.district_lgd || scope.districtLgd,
        summary_scope: 'district',
      };
    }
  }

  // Division user drilled into a district's blocks:
  // - no block selected → SUMMARY = district
  // - block selected → keep getBlockDashboard summary (block gauge/indicators)
  if (
    scope?.level === 'division' &&
    mapLevel === 'block' &&
    opts.district &&
    !opts.block
  ) {
    const distSummary = await rankingService.getDistrictDashboard({
      period: opts.period,
      district: opts.district,
      indicatorCode: opts.indicatorCode,
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
        district: distSummary.district || opts.district,
        district_lgd: distSummary.district_lgd,
        summary_scope: 'district',
      };
    }
  }

  const scoped = attachScopedRankings(data, scope, mapLevel);

  // Show All | Aspirational | High Priority (same key as table: filter=)
  const mapFilter = parseFilter(req.query.filter);
  if (mapFilter !== 'all' && mapLevel !== 'block') {
    let districtMaster = [];
    if (mapLevel === 'division') {
      const { rows } = await query(
        `
        SELECT d.name AS district_name, dv.name AS division_name
        FROM district d
        JOIN division dv ON dv.id = d.division_id
        WHERE d.is_active = TRUE
        `
      );
      districtMaster = rows;
    }
    const list = Array.isArray(scoped.ranking)
      ? scoped.ranking
      : Array.isArray(scoped.rankings)
        ? scoped.rankings
        : [];
    const applied = applyGeoCategoryFilter(list, mapFilter, mapLevel, districtMaster);
    scoped.ranking = applied.rankings;
    scoped.rankings = applied.rankings;
    scoped.count = applied.rankings.filter((r) => !r?.is_state).length;
    scoped.filter = applied.filter;
    scoped.filter_note = applied.filter_note;
  } else {
    scoped.filter = mapFilter;
    if (mapFilter !== 'all' && mapLevel === 'block') {
      scoped.filter_note = 'Category filter skipped at block level';
    }
  }

  if (scope?.level === 'district') {
    scoped.locked_district = {
      id: scope.districtId,
      name: scope.districtName,
      lgd: scope.districtLgd,
      division_id: scope.divisionId,
      division_name: scope.divisionName,
      block_count: (scope.blockNamesInDistrict || []).length,
      blocks: scope.blockNamesInDistrict || [],
    };
  }
  res.json({
    success: true,
    view: 'map',
    panel_tab: parsePanelTab(req.query.panel_tab, { defaultTab: 'indicators' }),
    labels: req.query.labels === '1' || req.query.labels === 'true' || req.query.labels === 1,
    analytics: {
      compare: req.query.analytics_compare || null,
      mode: req.query.analytics_mode || null,
    },
    ...applyPanelTabShape(scoped, req.query.panel_tab, {
      defaultTab: 'indicators',
    }),
  });
}

async function deepDive(req, res) {
  const scope = await withUserScope(req);
  const viewRaw = String(req.query.view || req.query.geo_level || req.query.level || 'division').toLowerCase();
  let tableMode = String(req.query.table_mode || '').toLowerCase() || null;
  let view =
    viewRaw === 'table'
      ? String(tableMode || req.query.level || 'division').toLowerCase()
      : viewRaw;

  // Mirror map / table dashboard geo tier rules
  if (scope?.level === 'block') {
    view = 'block';
    tableMode = 'block';
  } else if (scope?.level === 'district') {
    view = 'block';
    tableMode = 'block';
  } else if (scope?.level === 'division') {
    if (
      (view === 'block' || tableMode === 'block') &&
      (req.query.district || req.query.dt_lgd || req.query.district_lgd)
    ) {
      view = 'block';
      tableMode = 'block';
    } else {
      view = 'district';
      tableMode = 'district';
    }
  }

  if (
    !['division', 'district', 'block', 'table'].includes(viewRaw) &&
    !['division', 'district', 'block'].includes(view)
  ) {
    return res.status(400).json({
      success: false,
      message: 'view must be division, district, block, or table',
    });
  }
  const filter = String(req.query.filter || 'all').toLowerCase();
  if (!['all', 'aspirational', 'high_priority'].includes(filter)) {
    return res.status(400).json({
      success: false,
      message: 'filter must be one of: all, aspirational, high_priority',
    });
  }

  const district =
    req.query.district ||
    req.query.district_name ||
    req.query.selected_district ||
    req.query.district_lgd ||
    req.query.dt_lgd ||
    req.query.district_id ||
    null;
  const block =
    req.query.block ||
    req.query.block_name ||
    req.query.selected_block ||
    req.query.block_lgd ||
    req.query.block_id ||
    null;

  const data = await rankingDeepDiveService.getDeepDiveDashboard({
    view: viewRaw === 'table' ? 'table' : view,
    level: view,
    tableMode: tableMode || view,
    period: req.query.period,
    indicatorCode: req.query.indicator_code || req.query.indicator || 'RANK_COMPOSITE',
    filter,
    division: req.query.division || scope?.divisionName || null,
    district,
    block,
    divCode:
      req.query.div_code ||
      (scope?.divisionCode ? String(scope.divisionCode) : null) ||
      (/^\d+$/.test(String(req.query.parent_area_id || ''))
        ? req.query.parent_area_id
        : null),
    panelTab: req.query.panel_tab || 'indicators',
    breakupTab:
      req.query.breakup_tab ||
      req.query.breakup_group ||
      req.query.group_by ||
      'indicator',
    labels: req.query.labels,
    analyticsCompare: req.query.analytics_compare || 'timeperiod',
    analyticsMode: req.query.analytics_mode || 'month',
  });
  res.json({
    success: true,
    ...applyPanelTabShape(
      attachScopedRankings(data, scope, tableMode || view),
      req.query.panel_tab,
      { defaultTab: 'indicators' }
    ),
  });
}

async function periods(req, res) {
  // District ranking periods come only from the outcome API cache (no legacy Excel months).
  let outcomePeriods = [];
  try {
    const store = require('../outcome/outcomeDistrictStore');
    outcomePeriods = await store.listOutcomePeriods();
  } catch (_) {
    /* tables may not exist yet */
  }
  const periodsOut = outcomePeriods.map((o) => ({
    label: o.period_label,
    display: `${o.year}-${String(o.month).padStart(2, '0')}`,
    row_count: o.district_count || 0,
    source: 'outcome',
    synced_at: o.synced_at,
    year: o.year,
    month: o.month,
  }));
  res.json({ success: true, count: periodsOut.length, periods: periodsOut });
}

async function geoOptions(req, res) {
  // Analytics dropdowns need peer divisions/districts/blocks for all roles.
  // Mark peer_compare so enforceQueryGeoScope does not 403 outside home geo.
  req.query.peer_compare = '1';
  const scope = await withUserScope(req);
  const parsed = rankingAnalyticsService.parseFrontendAnalyticsQuery(req.query);
  const data = await rankingAnalyticsService.getGeoOptions({
    division: req.query.division || req.query.div_code || parsed.division,
    district:
      req.query.district ||
      req.query.district_name ||
      req.query.district_id ||
      parsed.district,
  });
  res.json({
    success: true,
    ...data,
    peer_compare: true,
    user_scope: scopeMeta(scope),
  });
}

async function analytics(req, res) {
  const scope = await withUserScope(req);
  const data = await runAnalyticsFromQuery(req.query);
  res.json({
    success: true,
    ...attachScopedRankings(data, scope, req.query.level || 'district'),
  });
}

/**
 * VIEW BY: Trend — overall composite time series + optional compare + UP average.
 * Accepts FE aliases: from_period/to_period, area_id (LGD), area_name, compare_*.
 */
async function trend(req, res) {
  const scope = await withUserScope(req);
  const data = await rankingTrendService.getTrendDashboard(req.query);
  res.json({
    success: true,
    ...data,
    user_scope: scopeMeta(scope),
  });
}

async function executiveSummary(req, res) {
  const scope = await withUserScope(req);
  let level = String(req.query.level || req.query.geo_level || 'division').toLowerCase();
  if (scope?.level === 'district' || scope?.level === 'block') level = 'district';
  else if (scope?.level === 'division') level = 'division';
  if (!['division', 'district'].includes(level)) {
    return res.status(400).json({
      success: false,
      message: 'level must be division or district',
    });
  }
  const data = await rankingExecutiveSummaryService.getExecutiveSummary({
    period: req.query.period || req.query.analytics_period,
    level,
    topN: req.query.top_n ? Number(req.query.top_n) : 3,
    historyMonths: req.query.history_months ? Number(req.query.history_months) : 3,
  });
  res.json({
    success: true,
    ...attachScopedRankings(data, scope, level),
  });
}

async function rankInsights(req, res) {
  const mode = String(req.query.mode || req.query.level || 'division').toLowerCase();
  const data = await rankingExecutiveInsightsService.getRankInsights({
    period: req.query.period || req.query.analytics_period,
    mode,
  });
  res.json({ success: true, ...data });
}

async function indicatorPerformance(req, res) {
  const mode = String(req.query.mode || req.query.level || 'district').toLowerCase();
  const data = await rankingExecutiveInsightsService.getIndicatorPerformanceMatrix({
    period: req.query.period || req.query.analytics_period,
    mode,
  });
  res.json({ success: true, ...data });
}

async function importFile(req, res) {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'Excel file required (field name: file)',
      required_sheet: 'Data_Report_Requirement-*_division.xlsx',
    });
  }
  const ext = path.extname(req.file.originalname || '').toLowerCase();
  if (!['.xlsx', '.xls'].includes(ext)) {
    return res.status(400).json({ success: false, message: 'Only .xlsx / .xls accepted' });
  }
  const result = await rankingService.importRankingFile({
    buffer: req.file.buffer,
    originalname: req.file.originalname,
    geoLevelHint: req.body.geo_level || req.query.geo_level,
  });
  res.json({ success: true, ...result });
}

/** Sync district outcome from external API into DB */
async function syncDistrictOutcome(req, res) {
  const outcomeDistrictService = require('../outcome/outcomeDistrictService');
  const month = req.query.month || req.body?.month;
  const year = req.query.year || req.body?.year;
  const period = req.query.period || req.body?.period;
  const parsed = outcomeDistrictService.parsePeriodInput({ period, month, year });
  if (!parsed) {
    return res.status(400).json({
      success: false,
      message: 'Provide period=2026-06 or month=&year=',
    });
  }
  const result = await outcomeDistrictService.syncDistrictOutcome({
    month: parsed.month,
    year: parsed.year,
    force: true,
  });
  if (!result.ok) {
    let has_cache = false;
    try {
      has_cache = await require('../outcome/outcomeDistrictStore').hasDistrictOutcomePeriod(
        parsed.year,
        parsed.month
      );
    } catch (_) {
      /* ignore */
    }
    return res.status(502).json({
      success: false,
      message: result.reason || 'Sync failed',
      period: parsed,
      has_cache,
    });
  }
  res.json({ success: true, ...result });
}

/** Sync block outcome from external API into DB */
async function syncBlockOutcome(req, res) {
  const outcomeBlockService = require('../outcome/outcomeBlockService');
  const month = req.query.month || req.body?.month;
  const year = req.query.year || req.body?.year;
  const period = req.query.period || req.body?.period;
  const parsed = outcomeBlockService.parsePeriodInput({ period, month, year });
  if (!parsed) {
    return res.status(400).json({
      success: false,
      message: 'Provide period=2026-06 or month=&year=',
    });
  }
  const result = await outcomeBlockService.syncBlockOutcome({
    month: parsed.month,
    year: parsed.year,
    force: true,
  });
  if (!result.ok) {
    let has_cache = false;
    try {
      has_cache = await require('../outcome/outcomeBlockStore').hasBlockOutcomePeriod(
        parsed.year,
        parsed.month
      );
    } catch (_) {
      /* ignore */
    }
    return res.status(502).json({
      success: false,
      message: result.reason || 'Block sync failed',
      period: parsed,
      has_cache,
    });
  }
  res.json({ success: true, ...result });
}

/** Ingest district outcome JSON array (same shape as external API) */
async function ingestDistrictOutcome(req, res) {
  const outcomeDistrictService = require('../outcome/outcomeDistrictService');
  const body = req.body || {};
  const rows = Array.isArray(body) ? body : body.data || body.districts || body.rows;
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({
      success: false,
      message: 'Body must be a JSON array of district outcome rows (or { data: [] })',
    });
  }
  const month = req.query.month || body.month || rows[0]?.month;
  const year = req.query.year || body.year || rows[0]?.year;
  const result = await outcomeDistrictService.ingestDistrictOutcomeJson(rows, {
    month,
    year,
    source: 'manual',
  });
  res.json({ success: true, ...result });
}

/** Ingest block outcome JSON array */
async function ingestBlockOutcome(req, res) {
  const outcomeBlockService = require('../outcome/outcomeBlockService');
  const body = req.body || {};
  const rows = Array.isArray(body) ? body : body.data || body.blocks || body.rows;
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({
      success: false,
      message: 'Body must be a JSON array of block outcome rows (or { data: [] })',
    });
  }
  const month = req.query.month || body.month || rows[0]?.month;
  const year = req.query.year || body.year || rows[0]?.year;
  const result = await outcomeBlockService.ingestBlockOutcomeJson(rows, {
    month,
    year,
    source: 'manual',
  });
  res.json({ success: true, ...result });
}

module.exports = {
  dashboard: asyncHandler(dashboard),
  deepDive: asyncHandler(deepDive),
  periods: asyncHandler(periods),
  geoOptions: asyncHandler(geoOptions),
  analytics: asyncHandler(analytics),
  trend: asyncHandler(trend),
  executiveSummary: asyncHandler(executiveSummary),
  rankInsights: asyncHandler(rankInsights),
  indicatorPerformance: asyncHandler(indicatorPerformance),
  importFile: asyncHandler(importFile),
  syncDistrictOutcome: asyncHandler(syncDistrictOutcome),
  syncBlockOutcome: asyncHandler(syncBlockOutcome),
  ingestDistrictOutcome: asyncHandler(ingestDistrictOutcome),
  ingestBlockOutcome: asyncHandler(ingestBlockOutcome),
};
