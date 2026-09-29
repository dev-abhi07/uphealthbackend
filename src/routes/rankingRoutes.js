const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const rankingController = require('../ranking/rankingController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024 },
});

router.use(authenticate);

router.get('/periods', rankingController.periods);
router.get('/geo-options', rankingController.geoOptions);
router.get('/analytics', rankingController.analytics);
router.get('/trend', rankingController.trend);
router.get('/executive-summary', rankingController.executiveSummary);
router.get('/rank-insights', rankingController.rankInsights);
router.get('/indicator-performance', rankingController.indicatorPerformance);
router.get('/dashboard', rankingController.dashboard);
router.get('/deep-dive', rankingController.deepDive);
router.post('/import', upload.single('file'), rankingController.importFile);
router.post('/outcome/district/sync', rankingController.syncDistrictOutcome);
router.post('/outcome/district/ingest', rankingController.ingestDistrictOutcome);
router.post('/outcome/block/sync', rankingController.syncBlockOutcome);
router.post('/outcome/block/ingest', rankingController.ingestBlockOutcome);

module.exports = router;
