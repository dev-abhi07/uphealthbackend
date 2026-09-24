const express = require('express');
const multer = require('multer');
const { authenticate, authorize } = require('../middleware/auth');
const uploadController = require('../controllers/uploadController');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  // Statewide facility templates are ~1–2MB empty; filled sheets can grow
  limits: { fileSize: 32 * 1024 * 1024 },
});

// Entire STATE upload workflow — not for DU / BU / FU
router.use(authenticate, authorize('state_admin'));

// Selection cascade: Indicator → Source → Level → Period → Download
router.get('/indicators', uploadController.listIndicators);
router.get('/indicators/:code/sources', uploadController.listSources);
router.get('/indicators/:code/levels', uploadController.listLevels);
router.get('/indicators/:code/columns', uploadController.previewColumns);
router.get('/periods', uploadController.listPeriods);

// Legacy aliases
router.get('/templates', uploadController.list);
router.get('/templates/:code/download', uploadController.download);

// Generate sheet (same as download; statewide: source_code, level, period)
router.get('/generate/:code', uploadController.download);

router.post(
  '/',
  upload.single('file'),
  (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          message: 'Excel file too large (max 32MB)',
        });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          success: false,
          message: 'Excel file required (multipart field name must be: file)',
        });
      }
      return res.status(400).json({ success: false, message: err.message });
    }
    return next(err);
  },
  uploadController.upload
);
router.get('/batches', uploadController.batches);
router.get('/batches/:id', uploadController.batchDetail);

module.exports = router;
