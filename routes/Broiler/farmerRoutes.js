const express = require("express");
const router = express.Router();
const {
    getAllFarmer,
    getAllFarmerByPlant,
    getFarmer,
    getFarmerLocation,
    getFarmerLocationsByPlant,
    getCustomer,
    getNearbyFarmers,
    getAllFarmerLocation,
    createFarmerLocation,
    updateFarmerLocation,
    deleteFarmerLocation
} = require("../../controllers/Broiler/farmerController");


//  /api/broiler/farmer

router.get("/getAll", getAllFarmer);
router.get("/get-by-plant/:plant_id", getAllFarmerByPlant);
router.get("/get-by-farmer", getFarmer);
router.get("/get-farmer-location", getFarmerLocation);
router.get("/get-customer/:name", getCustomer);
router.get("/nearby", getNearbyFarmers);

// Farmer Location master CRUD
router.get("/farmer-location/getAll", getAllFarmerLocation);
router.get("/farmer-location/get-by-plant/:plant_id", getFarmerLocationsByPlant);
router.post("/farmer-location/create", createFarmerLocation);
router.put("/farmer-location/update/:id", updateFarmerLocation);
router.delete("/farmer-location/delete/:id", deleteFarmerLocation);

module.exports = router;
