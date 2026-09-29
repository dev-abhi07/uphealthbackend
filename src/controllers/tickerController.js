const tickerService = require('../services/tickerService');
const { asyncHandler } = require('../middleware/errorHandler');

/** Public: active tickers for a dashboard marquee. */
const listPublic = asyncHandler(async (req, res) => {
  const dashboard =
    req.query.dashboard ||
    req.query.dashboard_code ||
    req.query.dashboard_id ||
    null;
  const tickers = await tickerService.listActiveTickers({
    dashboardCode: dashboard,
  });
  res.json({
    success: true,
    dashboard: dashboard || null,
    count: tickers.length,
    tickers,
  });
});

/** Admin: dropdown of sub-dashboards. */
const listDashboards = asyncHandler(async (req, res) => {
  const dashboards = await tickerService.listDashboards({
    activeOnly: req.query.all !== '1' && req.query.all !== 'true',
  });
  res.json({ success: true, dashboards });
});

/** Admin: list all tickers (filterable). */
const listAdmin = asyncHandler(async (req, res) => {
  const data = await tickerService.listTickersAdmin({
    dashboardCode: req.query.dashboard || req.query.dashboard_code,
    isActive: req.query.is_active,
    q: req.query.q || req.query.search,
    page: req.query.page,
    pageSize: req.query.page_size || req.query.limit,
  });
  res.json({ success: true, ...data });
});

const getOne = asyncHandler(async (req, res) => {
  const ticker = await tickerService.getTickerById(req.params.id);
  res.json({ success: true, ticker });
});

const create = asyncHandler(async (req, res) => {
  const ticker = await tickerService.createTicker(req.body || {}, req.user?.sub);
  res.status(201).json({ success: true, ticker });
});

const update = asyncHandler(async (req, res) => {
  const ticker = await tickerService.updateTicker(
    req.params.id,
    req.body || {},
    req.user?.sub
  );
  res.json({ success: true, ticker });
});

const remove = asyncHandler(async (req, res) => {
  const hard =
    req.query.hard === '1' ||
    req.query.hard === 'true' ||
    req.body?.hard === true;
  const result = await tickerService.deleteTicker(req.params.id, {
    soft: !hard,
  });
  res.json({ success: true, ...result });
});

module.exports = {
  listPublic,
  listDashboards,
  listAdmin,
  getOne,
  create,
  update,
  remove,
};
