const express = require('express');
const { authenticate } = require('../middleware/auth');
const tickerController = require('../controllers/tickerController');

const router = express.Router();

// Any logged-in user can read dashboards + active marquees
router.use(authenticate);

router.get('/dashboards', tickerController.listDashboards);
router.get('/', tickerController.listPublic);

module.exports = router;
