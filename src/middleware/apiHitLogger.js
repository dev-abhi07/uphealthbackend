/**
 * Global API hit logger.
 * Does NOT modify request/response — only writes to user_activity_log after response finishes.
 */
const jwt = require('jsonwebtoken');
const config = require('../config');
const userLogService = require('../services/userLogService');

const SKIP_PREFIXES = [
  '/health',
  '/api/user-logs',
  '/api/admin/user-logs',
];

function shouldSkip(req) {
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  if (SKIP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return true;
  }
  // Dedicated login/logout events already recorded in authController
  const method = String(req.method || '').toUpperCase();
  if (method === 'POST' && (path === '/api/auth/login' || path === '/api/auth/logout')) {
    return true;
  }
  return false;
}

function resolveUserId(req) {
  if (req.user?.sub != null) return Number(req.user.sub);
  if (req.user?.id != null) return Number(req.user.id);
  const header = req.headers.authorization || '';
  const [type, token] = header.split(' ');
  if (type !== 'Bearer' || !token) return null;
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    if (payload?.sub != null) return Number(payload.sub);
    if (payload?.id != null) return Number(payload.id);
  } catch (_) {
    /* invalid/expired — skip log */
  }
  return null;
}

function safeQuery(query = {}) {
  const out = {};
  const block = new Set([
    'password',
    'current_password',
    'new_password',
    'token',
    'authorization',
  ]);
  for (const [k, v] of Object.entries(query)) {
    if (block.has(String(k).toLowerCase())) continue;
    if (v == null) continue;
    const s = String(v);
    out[k] = s.length > 120 ? `${s.slice(0, 117)}...` : s;
  }
  return out;
}

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

/**
 * Express middleware — register early; logs after authenticate has set req.user (on finish).
 */
function apiHitLogger(req, res, next) {
  if (shouldSkip(req)) return next();

  const started = Date.now();
  res.on('finish', () => {
    try {
      const userId = resolveUserId(req);
      if (!userId || !Number.isFinite(userId)) return;

      const path = String(req.originalUrl || req.url || '').split('?')[0];
      const method = String(req.method || 'GET').toUpperCase();
      const durationMs = Date.now() - started;

      // Fire-and-forget — never affects response
      userLogService
        .logActivitySafe(
          userId,
          {
            event_type: 'api_hit',
            action_name: `${method} ${path}`.slice(0, 120),
            page: path.slice(0, 255),
            page_title: 'API',
            duration_ms: durationMs,
            period_label: req.query?.period || req.query?.period_label || null,
            view_mode: req.query?.view || req.query?.view_mode || null,
            geo_level: req.query?.geo_level || req.query?.level || null,
            action_payload: {
              method,
              path,
              status: res.statusCode,
              query: safeQuery(req.query),
            },
          },
          clientMeta(req)
        )
        .catch(() => {});
    } catch (_) {
      /* never break response */
    }
  });

  return next();
}

module.exports = { apiHitLogger };
