const express = require("express");
const router = express.Router();
const {
  getGeofenceConfig,
  saveGeofenceConfig,
  deleteGeofenceConfig
} = require("../../controllers/Broiler/geofenceConfigController");

// /api/broiler/geofence-config
router.get("/:plant_id", getGeofenceConfig);
router.post("/save", saveGeofenceConfig);
router.delete("/delete/:plant_id", deleteGeofenceConfig);

module.exports = router;
