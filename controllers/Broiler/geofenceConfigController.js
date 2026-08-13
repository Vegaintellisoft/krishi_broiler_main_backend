const { query } = require("../../config/db");

// -------------------------------------------------
// GET GEOFENCE CONFIG BY PLANT ID
// -------------------------------------------------
exports.getGeofenceConfig = async (req, res) => {
  const { plant_id } = req.params;

  try {
    const result = await query(
      "SELECT * FROM broiler.geofence_config WHERE plant = $1",
      [plant_id]
    );

    // If config doesn't exist for this plant, return default configuration
    if (!result || result.length === 0) {
      return res.json({
        success: true,
        data: {
          plant: plant_id,
          radius_meters: 1000,
          gps_accuracy_threshold: 100,
          max_retries: 3
        }
      });
    }

    res.json({ success: true, data: result[0] });
  } catch (err) {
    console.error("Get Geofence Config Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// -------------------------------------------------
// CREATE OR UPDATE GEOFENCE CONFIG
// -------------------------------------------------
exports.saveGeofenceConfig = async (req, res) => {
  const { plant, radius_meters, gps_accuracy_threshold, max_retries } = req.body;

  if (!plant) {
    return res.status(400).json({ success: false, message: "plant is required" });
  }

  const radius = radius_meters ? parseInt(radius_meters) : 1000;
  const accuracy = gps_accuracy_threshold ? parseInt(gps_accuracy_threshold) : 100;
  const retries = max_retries ? parseInt(max_retries) : 3;

  try {
    const result = await query(
      `INSERT INTO broiler.geofence_config (plant, radius_meters, gps_accuracy_threshold, max_retries, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (plant) 
       DO UPDATE SET 
         radius_meters = EXCLUDED.radius_meters, 
         gps_accuracy_threshold = EXCLUDED.gps_accuracy_threshold, 
         max_retries = EXCLUDED.max_retries,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [plant, radius, accuracy, retries]
    );

    res.json({ success: true, message: "Geofence config saved successfully", data: result[0] });
  } catch (err) {
    console.error("Save Geofence Config Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// -------------------------------------------------
// DELETE GEOFENCE CONFIG
// -------------------------------------------------
exports.deleteGeofenceConfig = async (req, res) => {
  const { plant_id } = req.params;

  try {
    await query(
      "DELETE FROM broiler.geofence_config WHERE plant = $1",
      [plant_id]
    );

    res.json({ success: true, message: `Geofence config for plant ${plant_id} deleted` });
  } catch (err) {
    console.error("Delete Geofence Config Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
