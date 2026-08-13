const router = require("express").Router();

const {
    syncSAPtoDB
} = require("../../controllers/Broiler/sap/sapSyncController");


// /api/broiler/sap/ 
router.post("/sync-sap-to-db", syncSAPtoDB);


module.exports = router;