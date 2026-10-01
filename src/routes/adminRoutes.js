const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const adminUserController = require('../controllers/adminUserController');
const tickerController = require('../controllers/tickerController');
const userLogController = require('../controllers/userLogController');

const router = express.Router();

// All admin routes require login
router.use(authenticate);

// Ticker dashboard list — any role (division / district / block / state / system)
// FE also calls underscore form: /api/admin/ticker_dashboards
router.get('/ticker-dashboards', tickerController.listDashboards);
router.get('/ticker_dashboards', tickerController.listDashboards);

// Everything below: system_admin only
router.use(authorize('system_admin'));

router.get('/roles', adminUserController.listRoles);
router.get('/geo-options', adminUserController.geoOptions);

router.get('/users', adminUserController.listUsers);
router.post('/users', adminUserController.createUser);
router.get('/users/:id', adminUserController.getUser);
router.put('/users/:id', adminUserController.updateUser);
router.patch('/users/:id/active', adminUserController.setActive);
router.post('/users/:id/reset-password', adminUserController.resetPassword);

// User activity logs
// summary / time-summary / user detail / user list
router.get('/user-logs/summary', userLogController.summaryAdmin);
router.get('/user-logs/time-summary', userLogController.timeSummaryAdmin);
router.get('/user-logs/user/:userId', userLogController.userDetail);
router.get('/user-logs', userLogController.listAdmin);

// Ticker CRUD (create / update / delete / admin list) — system_admin only
router.get('/tickers', tickerController.listAdmin);
router.post('/tickers', tickerController.create);
router.get('/tickers/:id', tickerController.getOne);
router.put('/tickers/:id', tickerController.update);
router.delete('/tickers/:id', tickerController.remove);

module.exports = router;
