const path = require('path');
const rankingService = require('../ranking/rankingService');
const rankingDeepDiveService = require('../ranking/rankingDeepDiveService');
const rankingAnalyticsService = require('../ranking/rankingAnalyticsService');
const rankingExecutiveSummaryService = require('../ranking/rankingExecutiveSummaryService');
const rankingExecutiveInsightsService = require('../ranking/rankingExecutiveInsightsService');
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
  }
  data.user_scope = scopeMeta(scope);
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
      ...attachScopedRankings(data, scope, rawLevel),
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

  // Table / Deep Dive view
  // e.g. view=table&level=division&period=2026-01&panel_tab=indicators&table_mode=division
  if (uiView === 'table') {
    let tableLevel = String(tableMode || rawLevel || 'division').toLowerCase();
    // Scoped users: open table at their geo tier (division → districts under division)
    if (scope?.level === 'district' || scope?.level === 'block') tableLevel = 'district';
    else if (scope?.level === 'division' && tableLevel === 'division') tableLevel = 'district';
    if (!['division', 'district'].includes(tableLevel)) {
      return res.status(400).json({
        success: false,
        message: 'For view=table, level/table_mode must be division or district',
      });
    }
    const filter = String(req.query.filter || 'all').toLowerCase();
    if (!['all', 'aspirational', 'high_priority'].includes(filter)) {
      return res.status(400).json({
        success: false,
        message: 'filter must be one of: all, aspirational, high_priority',
      });
    }

    const data = await rankingDeepDiveService.getDeepDiveDashboard({
      view: 'table',
      level: rawLevel,
      tableMode: tableLevel,
      period: req.query.period,
      indicatorCode: req.query.indicator_code || req.query.indicator || 'RANK_COMPOSITE',
      filter,
      division: req.query.division,
      district: req.query.district,
      block: req.query.block || req.query.block_name,
      divCode: req.query.div_code || ( /^\d+$/.test(String(req.query.parent_area_id || ''))
        ? req.query.parent_area_id
        : null),
      panelTab: req.query.panel_tab || 'indicators',
      labels: req.query.labels,
      analyticsCompare: req.query.analytics_compare || 'timeperiod',
      analyticsMode: req.query.analytics_mode || 'month',
      breakupOnly:
        req.query.breakup_only === '1' ||
        req.query.breakup_only === 'true' ||
        req.query.breakupOnly === '1',
    });
    return res.json({
      success: true,
      ...attachScopedRankings(data, scope, tableLevel),
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
  if (scope?.level === 'block') mapLevel = 'block';
  else if (scope?.level === 'district' && mapLevel === 'division') mapLevel = 'district';

  const opts = {
    period: req.query.period,
    district: req.query.district,
    divCode: req.query.div_code,
    division: req.query.division,
    parentAreaId: /^\d+$/.test(String(req.query.parent_area_id || ''))
      ? req.query.parent_area_id
      : null,
    tableMode,
    mapLevel,
    indicatorCode: req.query.indicator_code || req.query.indicator || null,
  };

  // Drill-down: map stays on division, table shows districts under div_code
  // e.g. level=division&table_mode=district&div_code=14595
  const data = await rankingService.getRankingDashboard(opts);
  const scoped = attachScopedRankings(data, scope, mapLevel);
  res.json({
    success: true,
    view: 'map',
    panel_tab: req.query.panel_tab || null,
    labels: req.query.labels === '1' || req.query.labels === 'true' || req.query.labels === 1,
    analytics: {
      compare: req.query.analytics_compare || null,
      mode: req.query.analytics_mode || null,
    },
    ...scoped,
  });
}

async function deepDive(req, res) {
  const scope = await withUserScope(req);
  const viewRaw = String(req.query.view || req.query.geo_level || req.query.level || 'division').toLowerCase();
  const tableMode = String(req.query.table_mode || '').toLowerCase() || null;
  const view =
    viewRaw === 'table'
      ? String(tableMode || req.query.level || 'division').toLowerCase()
      : viewRaw;

  if (!['division', 'district', 'table'].includes(viewRaw) && !['division', 'district'].includes(view)) {
    return res.status(400).json({
      success: false,
      message: 'view must be division, district, or table',
    });
  }
  const filter = String(req.query.filter || 'all').toLowerCase();
  if (!['all', 'aspirational', 'high_priority'].includes(filter)) {
    return res.status(400).json({
      success: false,
      message: 'filter must be one of: all, aspirational, high_priority',
    });
  }

  const data = await rankingDeepDiveService.getDeepDiveDashboard({
    view: viewRaw === 'table' ? 'table' : view,
    level: req.query.level || req.query.geo_level,
    tableMode: tableMode || (viewRaw === 'table' ? null : view),
    period: req.query.period,
    indicatorCode: req.query.indicator_code || req.query.indicator || 'RANK_COMPOSITE',
    filter,
    division: req.query.division,
    district: req.query.district,
    block: req.query.block || req.query.block_name,
    divCode: req.query.div_code || (/^\d+$/.test(String(req.query.parent_area_id || ''))
      ? req.query.parent_area_id
      : null),
    panelTab: req.query.panel_tab || 'indicators',
    labels: req.query.labels,
    analyticsCompare: req.query.analytics_compare || 'timeperiod',
    analyticsMode: req.query.analytics_mode || 'month',
  });
  res.json({
    success: true,
    ...attachScopedRankings(data, scope, tableMode || view),
  });
}

async function periods(req, res) {
  const rows = await rankingService.listRankingPeriods();
  res.json({ success: true, count: rows.length, periods: rows });
}

async function geoOptions(req, res) {
  const scope = await withUserScope(req);
  const parsed = rankingAnalyticsService.parseFrontendAnalyticsQuery(req.query);
  const data = await rankingAnalyticsService.getGeoOptions({
    division: req.query.division || req.query.div_code || parsed.division,
    district: req.query.district || req.query.district_id || parsed.district,
  });
  res.json({ success: true, ...data, user_scope: scopeMeta(scope) });
}

async function analytics(req, res) {
  const scope = await withUserScope(req);
  const data = await runAnalyticsFromQuery(req.query);
  res.json({
    success: true,
    ...attachScopedRankings(data, scope, req.query.level || 'district'),
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

module.exports = {
  dashboard: asyncHandler(dashboard),
  deepDive: asyncHandler(deepDive),
  periods: asyncHandler(periods),
  geoOptions: asyncHandler(geoOptions),
  analytics: asyncHandler(analytics),
  executiveSummary: asyncHandler(executiveSummary),
  rankInsights: asyncHandler(rankInsights),
  indicatorPerformance: asyncHandler(indicatorPerformance),
  importFile: asyncHandler(importFile),
};
