const authService = require('../services/authService');
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

const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  const result = await authService.login(username, password);

  // Record login in user activity log (does not change login response)
  const userId = result.user?.id;
  if (userId) {
    await userLogService.logActivitySafe(
      userId,
      {
        event_type: 'login',
        action_name: 'user_login',
        page: '/login',
        page_title: 'Login',
        action_payload: {
          username: result.user.username,
          roles: (result.user.roles || []).map((r) => r.code || r),
        },
      },
      clientMeta(req)
    );
  }

  res.json({ success: true, ...result });
});

const me = asyncHandler(async (req, res) => {
  const profile = await authService.getProfile(req.user.sub);
  res.json({
    success: true,
    user: profile,
    scope: profile.scope,
  });
});

const changePassword = asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const result = await authService.changePassword(
    req.user.sub,
    current_password,
    new_password
  );
  await userLogService.logActivitySafe(
    req.user.sub,
    {
      event_type: 'action',
      action_name: 'change_password',
      page: '/change-password',
      page_title: 'Change Password',
    },
    clientMeta(req)
  );
  res.json({ success: true, ...result });
});

const logout = asyncHandler(async (req, res) => {
  await userLogService.logActivitySafe(
    req.user?.sub,
    {
      event_type: 'logout',
      action_name: 'user_logout',
      page: '/logout',
      page_title: 'Logout',
      action_payload: {
        username: req.user?.username || null,
      },
    },
    clientMeta(req)
  );
  res.json({
    success: true,
    message: 'Logged out. Please discard the token on client.',
  });
});

/** Lists seeded division / district / block / state demo logins. */
const demoAccounts = asyncHandler(async (req, res) => {
  const data = await authService.listDemoAccounts();
  res.json({ success: true, ...data });
});

module.exports = {
  login,
  me,
  changePassword,
  logout,
  demoAccounts,
};
