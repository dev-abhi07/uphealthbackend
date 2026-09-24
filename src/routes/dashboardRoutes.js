const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/overview', dashboardController.overview);
router.get('/by-indicators', dashboardController.byIndicators);
router.get('/by-type', dashboardController.byType);
router.get('/by-domain', dashboardController.byDomain);
router.get('/filter', dashboardController.filter); // ?view=type|domain
router.get('/performance', dashboardController.performance);

// backward-compatible alias
router.get('/kpis', dashboardController.byIndicators);

module.exports = router;
