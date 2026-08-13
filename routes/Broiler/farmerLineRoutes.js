const express = require("express");
const router = express.Router();
const {
    getAllFarmerLine,
    createFarmerLine,
    updateFarmerLine,
    deleteFarmerLine,
    getUserLines
} = require("../../controllers/Broiler/farmerLineController");

//  /api/broiler/farmer-line

router.get("/getAll", getAllFarmerLine);
router.get("/user-lines", getUserLines);
router.post("/create", createFarmerLine);
router.put("/update/:id", updateFarmerLine);
router.delete("/delete/:id", deleteFarmerLine);

module.exports = router;
