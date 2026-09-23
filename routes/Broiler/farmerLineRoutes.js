const express = require("express");
const router = express.Router();
const {
    getAllFarmerLine,
    createFarmerLine,
    updateFarmerLine,
    deleteFarmerLine,
    getUserLines,
    syncPlantFarmersToLineHandler,
    syncAllLinesHandler,
    autoAddFarmerHandler,
} = require("../../controllers/Broiler/farmerLineController");

//  /api/broiler/farmer-line

router.get("/getAll", getAllFarmerLine);
router.get("/user-lines", getUserLines);
router.post("/create", createFarmerLine);
router.put("/update/:id", updateFarmerLine);
router.delete("/delete/:id", deleteFarmerLine);

// Auto-sync farmers into lines
router.post("/sync-plant-farmers", syncPlantFarmersToLineHandler);
router.post("/sync-all-lines", syncAllLinesHandler);
router.post("/auto-add-farmer", autoAddFarmerHandler);

module.exports = router;