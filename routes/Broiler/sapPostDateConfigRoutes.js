const router = require('express').Router();
const { getConfig, updateConfig } = require('../../controllers/Broiler/sapPostDateConfigController');


// /api/broiler/sap-post-date-config
router.get('/', getConfig);
router.put('/', updateConfig);

module.exports = router;
