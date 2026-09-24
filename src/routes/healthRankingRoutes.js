const express = require('express');
const { authenticate, asyncHandler } = require('../middleware/auth');
const rankingTableExportService = require('../ranking/rankingTableExportService');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/health-ranking/table/export
 * ?period=2026-01&indicator_id=RANK_COMPOSITE&level=division&multi=1
 */
router.get(
  '/table/export',
  asyncHandler(async (req, res) => {
    const data = await rankingTableExportService.getTableExportWorkbook({
      period: req.query.period,
      indicatorId: req.query.indicator_id || req.query.indicatorId || 'RANK_COMPOSITE',
      level: req.query.level || 'district',
      multi: req.query.multi,
      user: req.user,
    });
    res.json({ success: true, data });
  })
);

module.exports = router;
