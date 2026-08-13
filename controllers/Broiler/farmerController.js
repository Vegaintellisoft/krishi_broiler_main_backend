const axios = require("axios");
const { query } = require("../../config/db");

// -------------------------------------------------
// GET ALL FARMER
// -------------------------------------------------
exports.getAllFarmer = async (req, res) => {
  try {
    const result = await query("SELECT * FROM broiler.farmer");
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("Get All farmer Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// -------------------------------------------------
// GET ALL FARMER BY PLANT
// -------------------------------------------------
exports.getAllFarmerByPlant = async (req, res) => {
  const { plant_id } = req.params;

  try {
    const result = await query(
      "SELECT * FROM broiler.farmer WHERE plant = $1",
      [plant_id]
    );

    if (!result || result.length === 0) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    res.json({ success: true, data: result });

  } catch (err) {
    console.error("Get All farmer Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getFarmer = async (req, res) => {
  try {
    const { plant } = req.query;

    if (!plant) {
      return res.status(400).json({
        success: false,
        message: "plant is required"
      });
    }

    let url = `${process.env.BROILER_SAP_BASE_URL}/zdaily_mor?sap-client=500&werks=${plant}`;

    let config = {
      method: "get",
      maxBodyLength: Infinity,
      url: url,
      auth: {
        username: process.env.BROILER_SAP_USERNAME,
        password: process.env.BROILER_SAP_PASSWORD
      }
    };

    // console.log("get url", url);

    const response = await axios.request(config);

    if (response.status !== 200) {
      throw new Error("SAP returned non-200 status");
    }

    const formattedData =
      response.data?.map(({ werks, lifnr, name1, telephone, street, street2, street3, zzlineN, postlcode }) => ({
        plant_id: werks,
        farmer_supplier: lifnr,
        farmer_name: name1,
        telephone,
        street,
        street2,
        street3,
        district: zzlineN,
        pincode: postlcode
      })) || [];

    // console.log("Extracted Data:", formattedData);

    const suppliers = formattedData.map(f => f.farmer_supplier);
    const result = await query(
      `SELECT farmer_supplier, farmer_no, farm_length, farm_width, farm_chick_house_capacity, line_no
        FROM broiler.farmer 
        WHERE farmer_supplier = ANY($1)`,
      [suppliers]
    );

    const farmerMap = {};
    (result || []).forEach(row => {
      farmerMap[row.farmer_supplier] = row;
    });

    const enrichedData = formattedData.map(farmer => ({
      ...farmer,
      ...farmerMap[farmer.farmer_supplier]
    }));

    // console.log(enrichedData)

    return res.json({
      success: true,
      data: enrichedData
    });

  } catch (error) {
    // SAP is unreachable – fall back to local DB
    console.warn("SAP unavailable for getFarmer, falling back to DB:", error.message);
    try {
      const { plant } = req.query;
      const dbResult = await query(
        `SELECT farmer_supplier, farmer_no, farmer_name, farm_length, farm_width,
                farm_chick_house_capacity, line_no, plant AS plant_id
         FROM broiler.farmer
         WHERE plant = $1`,
        [plant]
      );
      return res.json({ success: true, data: dbResult || [], source: "db" });
    } catch (dbErr) {
      console.error("DB fallback also failed for getFarmer:", dbErr);
      return res.status(500).json({
        success: false,
        message: "Internal server error"
      });
    }
  }
};


exports.getCustomer = async (req, res) => {
  try {
    const { name } = req.params;

    const filters = {
      all: null,
      F: (kunnr) => typeof kunnr === "string" && kunnr.startsWith("FSZ"),
      C: (kunnr) => typeof kunnr === "string" && kunnr.startsWith("D"),
    };

    if (!(name in filters)) {
      return res.status(400).json({
        success: false,
        message: "Invalid type. Must be 'all', 'F', or 'C'."
      });
    }

    const url = `${process.env.BROILER_SAP_BASE_URL}/customer?sap-client=500`;

    const config = {
      method: "get",
      maxBodyLength: Infinity,
      url,
      auth: {
        username: process.env.BROILER_SAP_USERNAME,
        password: process.env.BROILER_SAP_PASSWORD
      }
    };

    const response = await axios.request(config);

    if (response.status !== 200) {
      return res.status(500).json({
        success: false,
        message: "SAP error"
      });
    }

    const rows = response.data || [];
    const filterFn = filters[name];
    const filteredRows = filterFn ? rows.filter((row) => filterFn(row.kunnr)) : rows;

    const formattedData = filteredRows.map(
      ({ kunnr, name1, sortl, strSuppl1, strSuppl2, ort01, pstlz, stcd1, smtp_addr, telf1 }) => ({
        customer_no: kunnr,
        customer_name: name1,
        customer_short_name: sortl,
        street1: strSuppl1,
        street2: strSuppl2,
        city: ort01,
        pincode: pstlz,
        gst_no: stcd1 || "",
        email: smtp_addr || "",
        telephone: telf1 || ""
      })
    );

    return res.json({
      success: true,
      data: formattedData
    });

  } catch (error) {
    console.error("Error in getCustomer SAP call, falling back to local DB:", error.message);

    try {
      const dbFarmers = await query("SELECT farmer_supplier AS customer_no, farmer_name AS customer_name, place AS city FROM broiler.farmer");
      const { name } = req.params;
      const filters = {
        all: null,
        F: (kunnr) => typeof kunnr === "string" && kunnr.startsWith("FSZ"),
        C: (kunnr) => typeof kunnr === "string" && kunnr.startsWith("D"),
      };
      const filterFn = filters[name];
      const filteredRows = filterFn ? dbFarmers.filter((row) => filterFn(row.customer_no)) : dbFarmers;

      return res.json({
        success: true,
        data: filteredRows || []
      });
    } catch (dbErr) {
      console.error("Database fallback error in getCustomer:", dbErr.message);
      return res.json({
        success: true,
        data: []
      });
    }
  }
};



// -------------------------------------------------
// GET FARMER LOCATIONS DETAILS
// -------------------------------------------------

exports.getFarmerLocation = async (req, res) => {
  try {
    const { farmer } = req.query;

    if (!farmer) {
      return res.status(400).json({
        success: false,
        message: "farmer is required"
      });
    }

    const result = await query(
      "SELECT * FROM broiler.farmer_location WHERE farmer_no = $1",
      [farmer]
    );

    if (!result || result.length === 0) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    return res.json({
      success: true,
      data: result[0]
    });

  } catch (error) {
    console.error("Error in getFarmerLocation:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// -------------------------------------------------
// GET NEARBY FARMERS BY GPS AND RADIUS
// -------------------------------------------------
exports.getNearbyFarmers = async (req, res) => {
  try {
    const { lat, lng, plant, radius } = req.query;

    if (!lat || !lng || !plant) {
      return res.status(400).json({
        success: false,
        message: "lat, lng, and plant are required"
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    
    // Fetch radius config from database or fallback to default
    let radiusMeters = 1000;
    if (radius) {
      radiusMeters = parseInt(radius);
    } else {
      const configRes = await query(
        "SELECT radius_meters FROM broiler.geofence_config WHERE plant = $1",
        [plant]
      );
      if (configRes && configRes.length > 0) {
        radiusMeters = parseInt(configRes[0].radius_meters);
      }
    }

    // Highly optimized Haversine SQL query utilizing indexes
    const sql = `
      SELECT *, 
        (6371000 * acos(
          LEAST(1.0, GREATEST(-1.0, 
            cos(radians($1)) * cos(radians(lat)) * cos(radians(long) - radians($2)) +
            sin(radians($1)) * sin(radians(lat))
          ))
        )) AS distance_meters
      FROM broiler.farmer_location
      WHERE plant = $3 AND lat IS NOT NULL AND long IS NOT NULL
      ORDER BY distance_meters ASC
    `;

    const allFarmers = await query(sql, [latitude, longitude, plant]);
    
    // Filter by configured radius
    const nearby = (allFarmers || []).filter(f => f.distance_meters <= radiusMeters);

    return res.json({
      success: true,
      data: nearby,
      configured_radius: radiusMeters
    });

  } catch (error) {
    console.error("Error in getNearbyFarmers:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};


// -------------------------------------------------
// GET ALL FARMER LOCATIONS BY PLANT
// -------------------------------------------------

exports.getFarmerLocationsByPlant = async (req, res) => {
  try {
    const { plant_id } = req.params;

    if (!plant_id) {
      return res.status(400).json({
        success: false,
        message: "plant_id is required"
      });
    }

    const result = await query(
      "SELECT * FROM broiler.farmer_location WHERE plant = $1",
      [plant_id]
    );

    return res.json({
      success: true,
      data: result || []
    });

  } catch (error) {
    console.error("Error in getFarmerLocationsByPlant:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};


// ----- Farmer Location CRUD -----
// Generic over the table's columns so changes to `broiler.farmer_location`
// don't require a controller edit.

const FARMER_LOCATION_TABLE = "broiler.farmer_location";
const FARMER_LOCATION_SKIP = new Set(["id", "created_at", "updated_at"]);
const isSafeColumn = (col) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col);

const pickColumns = (body) =>
  Object.keys(body || {}).filter((c) => isSafeColumn(c) && !FARMER_LOCATION_SKIP.has(c));

exports.getAllFarmerLocation = async (req, res) => {
  try {
    const result = await query(`SELECT * FROM ${FARMER_LOCATION_TABLE} ORDER BY id DESC`);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error in getAllFarmerLocation:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.createFarmerLocation = async (req, res) => {
  try {
    const data = req.body || {};
    const cols = pickColumns(data);

    if (cols.length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields provided" });
    }

    // Duplicate check on the natural key (plant + farmer_no)
    if (data.plant && data.farmer_no) {
      const dup = await query(
        `SELECT id FROM ${FARMER_LOCATION_TABLE} WHERE plant = $1 AND farmer_no = $2 LIMIT 1`,
        [data.plant, data.farmer_no]
      );
      if (dup.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Duplicate found: a farmer location for plant ${data.plant} and farmer ${data.farmer_no} already exists.`,
        });
      }
    }

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const values = cols.map((c) => data[c]);

    const sql = `
      INSERT INTO ${FARMER_LOCATION_TABLE} (${cols.map((c) => `"${c}"`).join(", ")})
      VALUES (${placeholders})
      RETURNING *
    `;

    const result = await query(sql, values);
    return res.status(201).json({
      success: true,
      message: "Farmer location created",
      data: result[0],
    });
  } catch (error) {
    console.error("Error in createFarmerLocation:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.updateFarmerLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body || {};

    if (!id) {
      return res.status(400).json({ success: false, message: "id is required" });
    }

    const cols = pickColumns(data);

    if (cols.length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields to update" });
    }

    // Duplicate check on the natural key (plant + farmer_no), excluding the row being edited
    if (data.plant && data.farmer_no) {
      const dup = await query(
        `SELECT id FROM ${FARMER_LOCATION_TABLE}
         WHERE plant = $1 AND farmer_no = $2 AND id <> $3
         LIMIT 1`,
        [data.plant, data.farmer_no, id]
      );
      if (dup.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Duplicate found: a farmer location for plant ${data.plant} and farmer ${data.farmer_no} already exists.`,
        });
      }
    }

    const setClause = cols.map((c, i) => `"${c}" = $${i + 1}`).join(", ");
    const values = cols.map((c) => data[c]);
    values.push(id);

    const sql = `
      UPDATE ${FARMER_LOCATION_TABLE}
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${values.length}
      RETURNING *
    `;

    const result = await query(sql, values);

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Farmer location with id ${id} not found`,
      });
    }

    return res.json({
      success: true,
      message: "Farmer location updated",
      data: result[0],
    });
  } catch (error) {
    console.error("Error in updateFarmerLocation:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.deleteFarmerLocation = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, message: "id is required" });
    }

    const result = await query(
      `DELETE FROM ${FARMER_LOCATION_TABLE} WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Farmer location with id ${id} not found`,
      });
    }

    return res.json({
      success: true,
      message: `Farmer location with id ${id} deleted`,
    });
  } catch (error) {
    console.error("Error in deleteFarmerLocation:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};