const axios = require("axios");
const { query } = require("../../config/db");

// -------------------------------------------------
// GET ALL PLANTS
// -------------------------------------------------
exports.getAllPlantsFromDB = async (req, res) => {
  try {
    const result = await query("SELECT * FROM broiler.plant ORDER BY plant_id ASC");
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("Get All Plants Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getAllPlants = async (req, res) => {
  try {
    let url = `${process.env.BROILER_SAP_BASE_URL}/mobile_app/shed_ready/get_plant?sap-client=500`;

    let config = {
      method: "get",
      maxBodyLength: Infinity,
      url: url,
      auth: {
        username: process.env.BROILER_SAP_USERNAME,
        password: process.env.BROILER_SAP_PASSWORD
      }
    };

    const response = await axios.request(config);

    if (response.status !== 200) {
      throw new Error("SAP returned non-200 status");
    }

    const formattedData =
      response.data?.map(({ Key, Text, Name_co, Street, Str_suppl1, Str_suppl2, City1, Post_code1, Gstin }) => ({
        plant_id: Key,
        plant_name: Text,
        company: Name_co,
        street: Street,
        str1: Str_suppl1,
        str2: Str_suppl2,
        city: City1,
        pincode: Post_code1,
        gst: Gstin
      })) || [];

    return res.json({ success: true, data: formattedData });
  } catch (err) {
    // SAP is unreachable – fall back to local DB
    console.warn("SAP unavailable for getAllPlants, falling back to DB:", err.message);
    try {
      const result = await query("SELECT * FROM broiler.plant ORDER BY plant_id ASC");
      // query() swallows DB errors and returns undefined – treat that as empty
      return res.json({ success: true, data: result || [], source: "db" });
    } catch (dbErr) {
      console.error("DB fallback also failed:", dbErr);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
};

// -------------------------------------------------
// GET BY plant_id
// -------------------------------------------------
exports.getByPlantId = async (req, res) => {
  const { plant_id } = req.params;

  try {
    const result = await query(
      "SELECT * FROM plants WHERE plant_id = $1",
      [plant_id]
    );

    if (!result || result.length === 0) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    res.json({ success: true, data: result[0] });
  } catch (err) {
    console.error("Get By Plant ID Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// -------------------------------------------------
// BULK INSERT WITHOUT DUPLICATES (UPSERT)
// -------------------------------------------------
exports.insertAllPlants = async (req, res) => {
  const plants = req.body;

  if (!Array.isArray(plants)) {
    return res.status(400).json({ success: false, message: "Invalid input" });
  }

  try {
    for (const p of plants) {
      if (!p.plant_id || !p.name) continue;

      await query(
        `
        INSERT INTO plants (plant_id, name)
        VALUES ($1, $2)
        ON CONFLICT (plant_id)
        DO UPDATE SET name = EXCLUDED.name;
        `,
        [p.plant_id, p.name]
      );
    }

    res.json({ success: true, message: "Inserted/Updated successfully" });
  } catch (err) {
    console.error("Bulk Insert Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
