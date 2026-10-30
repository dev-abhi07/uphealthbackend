const express = require('express');
const fs = require('fs');
const { authenticate, asyncHandler } = require('../middleware/auth');
const rankingTableExportService = require('../ranking/rankingTableExportService');

const router = express.Router();

router.use(authenticate);

function exportQuery(req) {
  return {
    period: req.query.period || req.body?.period,
    indicatorId:
      req.query.indicator_id ||
      req.query.indicatorId ||
      req.body?.indicator_id ||
      req.body?.indicatorId ||
      'RANK_COMPOSITE',
    level: req.query.level || req.body?.level || 'district',
    multi: req.query.multi ?? req.body?.multi,
    filename: req.query.filename || req.body?.filename,
    user: req.user,
  };
}

/**
 * GET /api/health-ranking/table/export
 * ?period=2026-01&indicator_id=RANK_COMPOSITE&level=division&multi=1
 * Returns JSON sheet payloads (legacy / debugging).
 */
router.get(
  '/table/export',
  asyncHandler(async (req, res) => {
    const data = await rankingTableExportService.getTableExportWorkbook(
      exportQuery(req)
    );
    res.json({ success: true, data });
  })
);

/**
 * POST /api/health-ranking/table/export/file
 * Body/query: period, indicator_id, level, multi?, filename?
 * Generates .xlsx on the server and returns a short-lived download URL.
 */
router.post(
  '/table/export/file',
  asyncHandler(async (req, res) => {
    const data = await rankingTableExportService.createTableExportDownload(
      exportQuery(req)
    );
    res.json({
      success: true,
      data: {
        ...data,
        download_url: `${req.baseUrl}/table/export/download/${data.job_id}`,
      },
    });
  })
);

/**
 * GET /api/health-ranking/table/export/file
 * Same as POST — convenient for simple clients.
 */
router.get(
  '/table/export/file',
  asyncHandler(async (req, res) => {
    const data = await rankingTableExportService.createTableExportDownload(
      exportQuery(req)
    );
    res.json({
      success: true,
      data: {
        ...data,
        download_url: `${req.baseUrl}/table/export/download/${data.job_id}`,
      },
    });
  })
);

/**
 * GET /api/health-ranking/table/export/download/:jobId
 * Streams the generated .xlsx (authenticated; owner-scoped when possible).
 */
router.get(
  '/table/export/download/:jobId',
  asyncHandler(async (req, res) => {
    const meta = rankingTableExportService.takeExportFile(req.params.jobId, {
      userId: req.user?.sub || req.user?.id || null,
    });
    if (!meta) {
      return res.status(404).json({
        success: false,
        message: 'Export expired or not found. Please generate again.',
      });
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${meta.filename}"`
    );
    res.setHeader('Cache-Control', 'no-store');

    const stream = fs.createReadStream(meta.filePath);
    res.on('finish', () => {
      rankingTableExportService.removeExportFile(req.params.jobId);
    });
    stream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: err.message });
      } else {
        res.destroy(err);
      }
    });
    stream.pipe(res);
  })
);

module.exports = router;
