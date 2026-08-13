const router = require("express").Router();
const { broilerMasterInsert, getAllBroilerMaster, getMaterials } = require('../../../controllers/Broiler/masters/masterSync')

// /api/broiler/master
router.post("/:name", broilerMasterInsert);
router.get("/getAll/:name", getAllBroilerMaster);
router.get("/get-materials", getMaterials);

module.exports = router;