const dashboardService = require('../services/dashboardService');
const { asyncHandler } = require('../middleware/errorHandler');

function pickFilters(query) {
  return {
    period: query.period || '2026-05',
    geo_level: query.geo_level || 'district',
    division_id: query.division_id,
    district_id: query.district_id,
    block_id: query.block_id,
    band_size: query.band_size,
    section: query.section || query.type || query.domain,
  };
}

/** Unified filter: ?view=type|domain  (screenshot tabs) */
const filter = asyncHandler(async (req, res) => {
  const view = String(req.query.view || req.query.filter || 'type').toLowerCase();
  const filters = pickFilters(req.query);
  if (view === 'domain') {
    const data = await dashboardService.getByDomain(filters);
    return res.json({ success: true, ...data });
  }
  const data = await dashboardService.getByType(filters);
  return res.json({ success: true, ...data });
});

const overview = asyncHandler(async (req, res) => {
  const data = await dashboardService.getOverview(pickFilters(req.query));
  res.json({ success: true, ...data });
});

const byIndicators = asyncHandler(async (req, res) => {
  const data = await dashboardService.getByIndicators(pickFilters(req.query));
  res.json({ success: true, ...data });
});

const byType = asyncHandler(async (req, res) => {
  const data = await dashboardService.getByType(pickFilters(req.query));
  res.json({ success: true, ...data });
});

const byDomain = asyncHandler(async (req, res) => {
  const data = await dashboardService.getByDomain(pickFilters(req.query));
  res.json({ success: true, ...data });
});

const performance = asyncHandler(async (req, res) => {
  const data = await dashboardService.getPerformance(pickFilters(req.query));
  res.json({ success: true, ...data });
});

module.exports = {
  overview,
  byIndicators,
  byType,
  byDomain,
  performance,
  filter,
};
