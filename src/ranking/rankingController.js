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
  normalizeName,
  namesMatch,
  divisionNamesMatch,
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

function isScopedGeoUser(scope) {
  return Boolean(scope && !scope.isStateAdmin && !scope.unrestricted);
}

/** Recompute top/bottom + MoM change cards from scoped ranking (same response keys). */
function recomputeExecutiveCards(data, topN = 3) {
  if (!data || !Array.isArray(data.ranking) || !data.ranking.length) return data;
  const byBestRank = [...data.ranking].sort(
    (a, b) => (Number(a.rank) || 9999) - (Number(b.rank) || 9999)
  );
  data.top_performers = byBestRank.slice(0, topN);
  data.bottom_performers = [...byBestRank]
    .sort((a, b) => (Number(b.rank) || 0) - (Number(a.rank) || 0))
    .slice(0, topN)
    .reverse();

  const withChange = (data.performance_change || []).filter((r) => r.change != null);
  const toChangeCard = (r) => {
    const hist = Array.isArray(r.history) ? r.history : [];
    const current = hist[hist.length - 1] || null;
    const previous = hist.length >= 2 ? hist[hist.length - 2] : null;
    return {
      name: r.name,
      short_name: r.short_name,
      change: r.change,
      previous: previous
        ? {
            period: previous.period,
            period_display: previous.period_display,
            value: previous.value,
          }
        : null,
      current: {
        period: current?.period || null,
        period_display: current?.period_display || null,
        value: r.score,
      },
    };
  };
  data.highest_increase = [...withChange]
    .sort((a, b) => Number(b.change) - Number(a.change))
    .slice(0, topN)
    .map(toChangeCard);
  data.lowest_decrease = [...withChange]
    .sort((a, b) => Number(a.change) - Number(b.change))
    .slice(0, topN)
    .map(toChangeCard);

  // Re-paint TOP/BOTTOM bar colors after geo scope (TOP always green)
  if (Array.isArray(data.performance_change) && data.performance_change.length) {
    const byRank = [...data.performance_change].sort(
      (a, b) => (Number(a.rank) || 9999) - (Number(b.rank) || 9999)
    );
    const topSet = new Set(byRank.slice(0, topN).map((r) => r.name));
    const bottomSet = new Set(byRank.slice(-topN).map((r) => r.name));
    data.performance_change = data.performance_change.map((r) => {
      let color_band = 'moderate';
      if (topSet.has(r.name)) color_band = 'top';
      else if (bottomSet.has(r.name)) color_band = 'bottom';
      const color =
        color_band === 'top'
          ? '#1f9d55'
          : color_band === 'bottom'
            ? '#d62828'
            : '#f0a202';
      return { ...r, band: color_band, color_band, color };
    });
  }
  return data;
}

function attachScopedRankings(data, scope, geoLevel) {
  if (!data || typeof data !== 'object') return data;
  const parentLevel = data.content_geo_level || geoLevel;
  if (Array.isArray(data.rankings)) {
    data.rankings = filterRankingsByScope(data.rankings, scope, parentLevel);
  }
  if (Array.isArray(data.ranking)) {
    data.ranking = filterRankingsByScope(data.ranking, scope, parentLevel);
    data.count = data.ranking.length;
  }

  // Executive summary extras
  if (data.map && Array.isArray(data.map.ranking)) {
    data.map.ranking = filterRankingsByScope(data.map.ranking, scope, parentLevel);
  }
  if (Array.isArray(data.district_ranking)) {
    data.district_ranking = filterRankingsByScope(
      data.district_ranking,
      scope,
      'district'
    );
  }
  if (Array.isArray(data.division_ranking)) {
    data.division_ranking = filterRankingsByScope(
      data.division_ranking,
      scope,
      'division'
    );
  }
  if (Array.isArray(data.block_ranking)) {
    data.block_ranking = filterRankingsByScope(data.block_ranking, scope, 'block');
  }
  if (Array.isArray(data.child_ranking)) {
    const childLevel =
      data.child_geo_level ||
      (parentLevel === 'division' ? 'district' : parentLevel === 'district' ? 'block' : parentLevel);
    data.child_ranking = filterRankingsByScope(
      data.child_ranking,
      scope,
      childLevel
    );
    data.child_count = data.child_ranking.length;
  }
  if (Array.isArray(data.areas)) {
    data.areas = filterRankingsByScope(data.areas, scope, parentLevel).map((area) => {
      const childLevel = data.child_geo_level || 'block';
      const children = data.child_geo_level
        ? filterRankingsByScope(area.children || [], scope, childLevel)
        : [];
      return { ...area, children, children_count: children.length };
    });
  }
  if (Array.isArray(data.performance_change)) {
    data.performance_change = filterRankingsByScope(
      data.performance_change,
      scope,
      parentLevel
    );
  }
  if (Array.isArray(data.child_performance_change)) {
    const childLevel = data.child_geo_level || 'block';
    data.child_performance_change = filterRankingsByScope(
      data.child_performance_change,
      scope,
      childLevel
    );
  }

  // Division/district login: top/bottom 3 + change cards from scoped geo only
  if (isScopedGeoUser(scope)) {
    recomputeExecutiveCards(data, 3);
  }

  // Keep gauge / overall in sync with scoped ranking (division avg of districts)
  // Do not overwrite when summary is already district/block-selected.
  if (
    isScopedGeoUser(scope) &&
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
    // Freehand compare: do not filter series to home geo
    return res.json({
      success: true,
      ...applyPanelTabShape(data, 'all', { defaultTab: 'all' }),
      user_scope: scopeMeta(scope),
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
      scope,
      topN: req.query.top_n ? Number(req.query.top_n) : 3,
      historyMonths: req.query.history_months ? Number(req.query.history_months) : 3,
    });
    return res.json({
      success: true,
      ...attachScopedRankings(data, scope, data.content_geo_level || level),
      user_scope: scopeMeta(scope),
    });
  }

  // Table / Deep Dive view
  // e.g. view=table&level=district&table_mode=district&period=2026-07
  // Division/District tabs = statewide (like state/sysadmin). Block tab stays scoped.
  if (uiView === 'table') {
    let tableLevel = String(tableMode || rawLevel || 'division').toLowerCase();
    // Block login always stays on blocks; otherwise honour FE table_mode
    if (scope?.level === 'block') {
      tableLevel = 'block';
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

    const statewideTable =
      tableLevel === 'division' || tableLevel === 'district';

    const district = statewideTable
      ? req.query.district ||
        req.query.district_name ||
        req.query.selected_district ||
        null
      : req.query.district ||
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

    // Statewide table: never fall back to login division/district ids
    const data = await rankingDeepDiveService.getDeepDiveDashboard({
      view: 'table',
      level: tableLevel,
      tableMode: tableLevel,
      period: req.query.period,
      indicatorCode: req.query.indicator_code || req.query.indicator || 'RANK_COMPOSITE',
      filter,
      division: statewideTable
        ? req.query.division || null
        : req.query.division || scope?.divisionName || null,
      district,
      block,
      divCode: statewideTable
        ? req.query.div_code || null
        : req.query.div_code ||
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
      breakupOnly:
        (req.query.breakup_only === '1' ||
          req.query.breakup_only === 'true' ||
          req.query.breakupOnly === '1') &&
        !(scope?.level === 'district' && tableLevel === 'block' && !block),
    });

    // Statewide Division/District table — same full-state list as state/sysadmin
    if (statewideTable) {
      const tableScope =
        scope && isScopedGeoUser(scope)
          ? { ...scope, peerStatewideTable: true }
          : scope;
      return res.json({
        success: true,
        ...applyPanelTabShape(
          attachScopedRankings(data, tableScope, tableLevel),
          req.query.panel_tab,
          { defaultTab: 'indicators' }
        ),
      });
    }

    // District/block users on Block tab: flat blocks for assigned district
    if (scope?.level === 'district' && tableLevel === 'block' && !block) {
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
  // (division user → peer division map by default; district/block drilldown)
  // (district user → peer district map by default; level=block → blocks)
  if (scope?.level === 'block') {
    mapLevel = 'block';
  } else if (scope?.level === 'district') {
    mapLevel = rawLevel === 'block' ? 'block' : 'district';
  } else if (scope?.level === 'division') {
    if (rawLevel === 'block' && (req.query.district || req.query.dt_lgd || req.query.district_lgd)) {
      mapLevel = 'block';
    } else if (
      rawLevel === 'district' ||
      tableMode === 'district' ||
      req.query.district ||
      req.query.dt_lgd ||
      req.query.district_lgd
    ) {
      mapLevel = 'district';
    } else {
      mapLevel = 'division';
    }
  }

  // Division / district peer maps; drilldowns use district or block
  let effectiveTableMode = tableMode;
  if (scope?.level === 'division') {
    if (mapLevel === 'block') {
      effectiveTableMode = 'block';
    } else if (mapLevel === 'district') {
      effectiveTableMode = 'district';
    } else {
      effectiveTableMode = 'division';
    }
  }
  if (scope?.level === 'district') {
    effectiveTableMode = mapLevel === 'block' ? 'block' : 'district';
  }

  // Statewide peer maps: do not filter by home division/district geo codes.
  const peerDistrictMap =
    scope?.level === 'district' && mapLevel === 'district';
  const peerDivisionMap =
    scope?.level === 'division' && mapLevel === 'division';
  const peerMap = peerDistrictMap || peerDivisionMap;

  const opts = {
    period: req.query.period,
    // Prefer explicit district name; area_id must be LGD (Pilibhit=173) or master id (59)
    // Peer division map: do not pass area_id as district filter.
    district: peerDivisionMap
      ? null
      : req.query.district ||
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
    divCode: peerMap
      ? null
      : req.query.div_code ||
        (scope?.divisionCode ? String(scope.divisionCode) : null),
    division: peerMap
      ? null
      : req.query.division || scope?.divisionName || null,
    parentAreaId: peerMap
      ? null
      : /^\d+$/.test(String(req.query.parent_area_id || ''))
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

  // Division peer map: ranking = all divisions; SUMMARY = selected peer or home
  if (peerDivisionMap && scope.divisionName) {
    const askedDivisionName = String(
      req.query.division || req.query.div_code || ''
    ).trim();
    const askedIsPeer =
      Boolean(req.query._peer_division_select) ||
      (askedDivisionName &&
        !divisionNamesMatch(askedDivisionName, scope.divisionName) &&
        String(askedDivisionName) !== String(scope.divisionCode || '') &&
        String(askedDivisionName) !== String(scope.divisionId || ''));
    const summaryDivision = askedIsPeer
      ? askedDivisionName
      : scope.divisionName;
    // Numeric div_code only — FE may send division name as div_code for peers
    const rawDivCode = String(req.query.div_code || '').trim();
    const summaryDivCode = askedIsPeer
      ? /^\d+$/.test(rawDivCode)
        ? rawDivCode
        : null
      : scope.divisionCode;
    const divSummary = await rankingService.getDivisionDashboard({
      period: opts.period,
      division: summaryDivision,
      divCode: summaryDivCode,
      indicatorCode: opts.indicatorCode,
      skipOutcomeSync: true,
    });
    if (divSummary && divSummary.has_data) {
      data = {
        ...data,
        overall_composite_score: divSummary.overall_composite_score,
        overall_composite_label: divSummary.overall_composite_label,
        state_overall_composite_score:
          divSummary.state_overall_composite_score ?? data.state_overall_composite_score,
        indicators: divSummary.indicators,
        by_type: divSummary.by_type,
        by_domain: divSummary.by_domain,
        selected_division: divSummary.selected_division,
        division: summaryDivision,
        div_code: summaryDivCode || divSummary.div_code || null,
        summary_scope: 'division',
      };
    }
  }

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

  if (scope?.level === 'division') {
    scoped.locked_division = {
      id: scope.divisionId,
      name: scope.divisionName,
      code: scope.divisionCode,
      district_count: (scope.districtNamesInDivision || []).length,
      districts: scope.districtNamesInDivision || [],
    };
    const mineDiv = (scoped.ranking || []).find((r) => r.is_user_area);
    if (mineDiv || scope.divisionName) {
      scoped.user_division_rank = mineDiv
        ? {
            name: mineDiv.name,
            rank: mineDiv.rank,
            score: mineDiv.score != null ? mineDiv.score : mineDiv.value,
            code: scope.divisionCode,
            area_id:
              mineDiv.area_id != null ? mineDiv.area_id : scope.divisionCode,
            division_id: scope.divisionId,
          }
        : {
            name: scope.divisionName,
            rank: null,
            score: null,
            code: scope.divisionCode,
            area_id: scope.divisionCode,
            division_id: scope.divisionId,
          };
    }

    // When drilled into districts/blocks, also attach statewide division peers for Rank Bucket
    if (mapLevel !== 'division') {
      try {
        const peerDash = await rankingService.getRankingDashboard({
          period: opts.period,
          mapLevel: 'division',
          tableMode: 'division',
          indicatorCode: opts.indicatorCode,
        });
        const peerList = Array.isArray(peerDash?.ranking) ? peerDash.ranking : [];
        scoped.panel_ranking = peerList.map((row) => {
          const isUserArea =
            divisionNamesMatch(row.name || row.division, scope.divisionName) ||
            (scope.divisionCode != null &&
              String(row.area_id ?? row.div_code ?? '') ===
                String(scope.divisionCode)) ||
            (scope.divisionId != null &&
              String(row.division_id ?? row.id ?? '') ===
                String(scope.divisionId));
          return { ...row, is_user_area: Boolean(isUserArea) };
        });
        scoped.panel_geo_level = 'division';
        const mine = scoped.panel_ranking.find((r) => r.is_user_area);
        if (mine) {
          scoped.user_division_rank = {
            name: mine.name,
            rank: mine.rank,
            score: mine.score != null ? mine.score : mine.value,
            code: scope.divisionCode,
            area_id: mine.area_id != null ? mine.area_id : scope.divisionCode,
            division_id: scope.divisionId,
          };
        }
      } catch (_) {
        /* ranking already scoped */
      }
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

    // Rank Bucket panel: statewide district peers (map paint stays blocks).
    try {
      const peerDash = await rankingService.getRankingDashboard({
        period: opts.period,
        mapLevel: 'district',
        tableMode: 'district',
        indicatorCode: opts.indicatorCode,
      });
      const peerList = Array.isArray(peerDash?.ranking) ? peerDash.ranking : [];
      const panelRanking = peerList.map((row) => {
        const lgd =
          row.district_lgd != null
            ? row.district_lgd
            : row.lgd_code != null
              ? row.lgd_code
              : row.area_id;
        const isUserArea =
          namesMatch(row.name || row.district, scope.districtName) ||
          (scope.districtLgd != null &&
            lgd != null &&
            String(lgd) === String(scope.districtLgd)) ||
          (scope.districtId != null &&
            row.district_id != null &&
            String(row.district_id) === String(scope.districtId));
        return { ...row, is_user_area: Boolean(isUserArea) };
      });
      scoped.panel_ranking = panelRanking;
      scoped.panel_geo_level = 'district';
      const mine = panelRanking.find((r) => r.is_user_area);
      scoped.user_district_rank = mine
        ? {
            name: mine.name,
            rank: mine.rank,
            score: mine.score != null ? mine.score : mine.value,
            lgd: scope.districtLgd,
            area_id: mine.area_id != null ? mine.area_id : scope.districtLgd,
            district_id: scope.districtId,
          }
        : {
            name: scope.districtName,
            rank: null,
            score: null,
            lgd: scope.districtLgd,
            area_id: scope.districtLgd,
            district_id: scope.districtId,
          };
    } catch (_) {
      /* keep block ranking only if peer fetch fails */
    }
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
  // Analytic View freehand: statewide division/district/block lists for all roles.
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
  // Freehand compare for all logins — keep requested geo series as-is
  res.json({
    success: true,
    ...data,
    user_scope: scopeMeta(scope),
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
    scope,
    topN: req.query.top_n ? Number(req.query.top_n) : 3,
    historyMonths: req.query.history_months ? Number(req.query.history_months) : 3,
  });
  const scopeGeo = data.content_geo_level || level;
  res.json({
    success: true,
    ...attachScopedRankings(data, scope, scopeGeo),
  });
}

async function rankInsights(req, res) {
  const scope = await withUserScope(req);
  let mode = String(req.query.mode || req.query.level || 'division').toLowerCase();
  if (scope?.level === 'district' || scope?.level === 'block') mode = 'district';
  else if (scope?.level === 'division') mode = 'division';
  const data = await rankingExecutiveInsightsService.getRankInsights({
    period: req.query.period || req.query.analytics_period,
    mode,
    scope,
  });
  res.json({ success: true, ...data, user_scope: scopeMeta(scope) });
}

async function indicatorPerformance(req, res) {
  const scope = await withUserScope(req);
  let mode = String(req.query.mode || req.query.level || 'district').toLowerCase();
  if (scope?.level === 'district' || scope?.level === 'block') mode = 'district';
  else if (scope?.level === 'division') mode = 'division';
  const data = await rankingExecutiveInsightsService.getIndicatorPerformanceMatrix({
    period: req.query.period || req.query.analytics_period,
    mode,
    scope,
  });
  res.json({ success: true, ...data, user_scope: scopeMeta(scope) });
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
