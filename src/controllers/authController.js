const authService = require('../services/authService');
const { asyncHandler } = require('../middleware/errorHandler');

const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  const result = await authService.login(username, password);
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
  res.json({ success: true, ...result });
});

const logout = asyncHandler(async (req, res) => {
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
