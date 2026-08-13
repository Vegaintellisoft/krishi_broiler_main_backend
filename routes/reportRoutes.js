// routes/reportRoutes.js

const express = require('express');
const { getDetailedReport, sendDataToSap, getSapPayload } = require('../controllers/reportController');
const router = express.Router();

/**
 * @route   GET /api/reports
 * @desc    Get a detailed report of dispatched materials
 * @access  Public (or add authentication middleware)
 * @query   startDate (Optional, YYYY-MM-DD) - The start of the date range.
 * @query   endDate (Optional, YYYY-MM-DD) - The end of the date range.
 * @note    If no dates are provided, the report defaults to the current day.
 */

router.get('/getall', getDetailedReport);
router.post('/send-to-sap/:dcId', sendDataToSap);

router.get("/getsapPayload/:dcId", getSapPayload)

module.exports = router;