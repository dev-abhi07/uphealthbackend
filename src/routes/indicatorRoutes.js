const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const {
  listMasterIndicators,
  getMasterIndicator,
} = require('../indicators/indicatorService');

const router = express.Router();

/** Master KPI catalog — IND001–IND037 + definition fields */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const indicators = await listMasterIndicators({ activeOnly: true });
    res.json({
      success: true,
      count: indicators.length,
      indicators,
    });
  })
);

router.get(
  '/:code',
  authenticate,
  asyncHandler(async (req, res) => {
    const ind = await getMasterIndicator(req.params.code);
    if (!ind) {
      return res.status(404).json({
        success: false,
        message: `Unknown indicator: ${req.params.code}`,
      });
    }
    res.json({ success: true, indicator: ind });
  })
);

module.exports = router;
