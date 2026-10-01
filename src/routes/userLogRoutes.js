const express = require('express');
const { authenticate } = require('../middleware/auth');
const userLogController = require('../controllers/userLogController');

const router = express.Router();

router.use(authenticate);

/** Log one event or { events: [] } */
router.post('/', userLogController.create);
router.post('/batch', userLogController.createBatch);

module.exports = router;
