const userAdminService = require('../services/userAdminService');
const { asyncHandler } = require('../middleware/errorHandler');

const listUsers = asyncHandler(async (req, res) => {
  const data = await userAdminService.listUsers({
    q: req.query.q || req.query.search,
    role: req.query.role,
    geoLevel: req.query.geo_level,
    isActive: req.query.is_active,
    page: req.query.page,
    pageSize: req.query.page_size || req.query.limit,
  });
  res.json({ success: true, ...data });
});

const getUser = asyncHandler(async (req, res) => {
  const user = await userAdminService.getUserById(req.params.id);
  res.json({ success: true, user });
});

const createUser = asyncHandler(async (req, res) => {
  const user = await userAdminService.createUser(req.body || {}, req.user?.sub);
  res.status(201).json({ success: true, user });
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await userAdminService.updateUser(
    req.params.id,
    req.body || {},
    req.user?.sub
  );
  res.json({ success: true, user });
});

const setActive = asyncHandler(async (req, res) => {
  const active =
    req.body?.is_active !== undefined
      ? req.body.is_active
      : req.body?.active !== undefined
        ? req.body.active
        : true;
  const user = await userAdminService.setUserActive(
    req.params.id,
    active === true || active === 'true' || active === 1,
    req.user?.sub
  );
  res.json({ success: true, user });
});

const resetPassword = asyncHandler(async (req, res) => {
  const password = req.body?.password || req.body?.new_password;
  const result = await userAdminService.resetPassword(req.params.id, password);
  res.json({ success: true, ...result });
});

const listRoles = asyncHandler(async (req, res) => {
  const roles = await userAdminService.listRoles();
  res.json({ success: true, roles });
});

const geoOptions = asyncHandler(async (req, res) => {
  const data = await userAdminService.listGeoOptions({
    divisionId: req.query.division_id,
    districtId: req.query.district_id,
  });
  res.json({ success: true, ...data });
});

module.exports = {
  listUsers,
  getUser,
  createUser,
  updateUser,
  setActive,
  resetPassword,
  listRoles,
  geoOptions,
};
