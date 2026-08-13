const express = require("express");
const router = express.Router();
const {
    getAllPlants,
    getByPlantId,
    insertAllPlants,
} = require("../../controllers/Broiler/plantController");

// /api/broiler/plant
router.get("/getAll", getAllPlants);
router.get("/get/:plant_id", getByPlantId);
router.post("/insert", insertAllPlants);

module.exports = router;
