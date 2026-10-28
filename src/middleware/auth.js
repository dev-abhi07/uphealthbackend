const jwt = require('jsonwebtoken');
const config = require('../config');
const authService = require('../services/authService');
const { asyncHandler } = require('./errorHandler');

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [type, token] = header.split(' ');

  if (type !== 'Bearer' || !token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Send Authorization: Bearer <token>',
    });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    });
  }

  const sessionId = payload?.sid;
  if (!sessionId) {
    return res.status(401).json({
      success: false,
      code: 'SESSION_REVOKED',
      message:
        'Your session was ended. Please sign in again.',
    });
  }

  const active = await authService.isSessionActive(payload.sub, sessionId);
  if (!active) {
    return res.status(401).json({
      success: false,
      code: 'SESSION_REVOKED',
      message:
        'Session revoked. You were logged out because this account signed in from another device or browser (session limit reached). Please sign in again.',
    });
  }

  // Fire-and-forget last-seen (do not block the request)
  authService.touchSession(sessionId);

  req.user = payload;
  return next();
});

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const roles = req.user.roles || [];
    const ok = allowedRoles.some((r) => roles.includes(r));
    if (!ok) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${allowedRoles.join(' | ')}`,
      });
    }
    return next();
  };
}

module.exports = {
  authenticate,
  authorize,
  asyncHandler,
};
