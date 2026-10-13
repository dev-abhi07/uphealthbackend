const userLogService = require('../services/userLogService');
const { asyncHandler } = require('../middleware/errorHandler');

function clientMeta(req) {
  const xf = req.headers['x-forwarded-for'];
  const ip = xf
    ? String(xf).split(',')[0].trim()
    : req.ip || req.socket?.remoteAddress || null;
  return {
    ip,
    userAgent: req.headers['user-agent'] || null,
  };
}

function userIdFromReq(req) {
  const id = req.user?.sub ?? req.user?.id;
  if (id == null) {
    const err = new Error('Authentication required');
    err.status = 401;
    throw err;
  }
  return Number(id);
}

function parsePageNum(req) {
  const pageNumRaw = req.query.page_num ?? req.query.p ?? req.query.page;
  if (pageNumRaw != null && /^\d+$/.test(String(pageNumRaw).trim())) {
    return Number(pageNumRaw);
  }
  return 1;
}

/** POST /api/user-logs — any logged-in user logs page/action/time */
const create = asyncHandler(async (req, res) => {
  const userId = userIdFromReq(req);
  const result = await userLogService.logEvents(userId, req.body || {}, clientMeta(req));
  res.status(201).json({ success: true, ...result });
});

/** POST /api/user-logs/batch — alias for batch body { events: [] } */
const createBatch = asyncHandler(async (req, res) => {
  const userId = userIdFromReq(req);
  const body = req.body || {};
  if (!Array.isArray(body.events)) {
    return res.status(400).json({
      success: false,
      message: 'Body must be { events: [ ... ] }',
    });
  }
  const result = await userLogService.logEvents(userId, body, clientMeta(req));
  res.status(201).json({ success: true, ...result });
});

/**
 * GET /api/admin/user-logs
 * Step 1 — list users (grouped by name). Click a row → call userDetail.
 */
const listAdmin = asyncHandler(async (req, res) => {
  const data = await userLogService.listLogs({
    userId: req.query.user_id || req.query.userId,
    username: req.query.username,
    eventType: req.query.event_type || req.query.type,
    page: req.query.page_path || req.query.path || req.query.route || null,
    sessionId: req.query.session_id || req.query.sessionId,
    from: req.query.from || req.query.date_from,
    to: req.query.to || req.query.date_to,
    q: req.query.q || req.query.search,
    pageNum: parsePageNum(req),
    pageSize: req.query.page_size || req.query.limit || 25,
    groupBy: req.query.group_by || req.query.groupBy || 'name',
    // List screen: no nested logs (0). Pass logs_per_user=N to embed.
    logsPerUser: req.query.logs_per_user ?? req.query.logsPerUser ?? 0,
  });
  res.json({ success: true, ...data });
});

/**
 * GET /api/admin/user-logs/user/:userId
 * Step 2 — after click on a user name, show that user's activity logs.
 */
const userDetail = asyncHandler(async (req, res) => {
  const data = await userLogService.listLogsForUser(req.params.userId, {
    eventType: req.query.event_type || req.query.type,
    page: req.query.page_path || req.query.path || req.query.route || null,
    sessionId: req.query.session_id || req.query.sessionId,
    from: req.query.from || req.query.date_from,
    to: req.query.to || req.query.date_to,
    q: req.query.q || req.query.search,
    pageNum: parsePageNum(req),
    pageSize: req.query.page_size || req.query.limit || 50,
    timeSource: req.query.source || req.query.time_source || 'leave',
  });
  res.json({ success: true, ...data });
});

/** GET /api/admin/user-logs/summary — system_admin aggregates */
const summaryAdmin = asyncHandler(async (req, res) => {
  const data = await userLogService.summary({
    from: req.query.from || req.query.date_from,
    to: req.query.to || req.query.date_to,
    userId: req.query.user_id || req.query.userId,
    username: req.query.username,
    q: req.query.q || req.query.search,
  });
  res.json({ success: true, ...data });
});

/** GET /api/admin/user-logs/time-summary — time spent by user / page / day */
const timeSummaryAdmin = asyncHandler(async (req, res) => {
  const data = await userLogService.timeSummary({
    from: req.query.from || req.query.date_from,
    to: req.query.to || req.query.date_to,
    userId: req.query.user_id || req.query.userId,
    username: req.query.username,
    q: req.query.q || req.query.search,
    source: req.query.source || req.query.time_source || 'leave',
  });
  res.json({ success: true, ...data });
});

module.exports = {
  create,
  createBatch,
  listAdmin,
  userDetail,
  summaryAdmin,
  timeSummaryAdmin,
};
