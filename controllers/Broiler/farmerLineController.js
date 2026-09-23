const axios = require("axios");
const { query } = require("../../config/db");

const TABLE = "broiler.farmer_line_master";
const LINE_FARM_TABLE = "broiler.line_farm_master";
const FARMER_TABLE = "broiler.farmer";

// -------------------------------------------------
// HELPER: FETCH PLANT FARMERS (SAP with DB fallback)
// -------------------------------------------------
const fetchPlantFarmerIds = async (plant) => {
  const plantStr = String(plant).trim();

  // 1. Try SAP first for live data
  try {
    const url = `${process.env.BROILER_SAP_BASE_URL}/zdaily_mor?sap-client=500&werks=${plantStr}`;
    const res = await axios.get(url, {
      auth: {
        username: process.env.BROILER_SAP_USERNAME,
        password: process.env.BROILER_SAP_PASSWORD,
      },
      timeout: 15000,
    });
    if (Array.isArray(res.data) && res.data.length > 0) {
      const sapIds = res.data.map((r) => String(r.lifnr)).filter(Boolean);
      if (sapIds.length > 0) {
        return [...new Set(sapIds)];
      }
    }
  } catch (err) {
    console.warn(`SAP fetch failed for plant ${plantStr}, falling back to local DB:`, err.message);
  }

  // 2. Fallback to local DB
  const dbRows = await query(
    `SELECT farmer_supplier FROM ${FARMER_TABLE} WHERE plant::text = $1::text`,
    [plantStr]
  );
  const dbIds = (dbRows || []).map((f) => String(f.farmer_supplier)).filter(Boolean);
  return [...new Set(dbIds)];
};

// -------------------------------------------------
// GET ALL
// -------------------------------------------------
exports.getAllFarmerLine = async (req, res) => {
  try {
    const result = await query(`SELECT * FROM ${TABLE} ORDER BY id DESC`);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error in getAllFarmerLine:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// -------------------------------------------------
// CHECK DUPLICATE FARMERS
// Ensures no internal duplicate farmer IDs in the array
// -------------------------------------------------
const checkDuplicateFarmers = (farmer_ids) => {
  if (!Array.isArray(farmer_ids)) return { isDuplicate: false };
  const seen = new Set();
  for (const fid of farmer_ids) {
    const key = String(fid);
    if (seen.has(key)) {
      return {
        isDuplicate: true,
        message: `Duplicate farmer ID "${key}" found in the selection.`
      };
    }
    seen.add(key);
  }
  return { isDuplicate: false };
};

// -------------------------------------------------
// CREATE
// -------------------------------------------------
exports.createFarmerLine = async (req, res) => {
  try {
    const { line_farm_id, line_id, name, plant, farmer_ids, user_ids } = req.body;

    if (!line_farm_id) return res.status(400).json({ success: false, message: "line_farm_id is required" });
    if (!Array.isArray(farmer_ids) || farmer_ids.length === 0)
      return res.status(400).json({ success: false, message: "At least one farmer is required" });
    if (!Array.isArray(user_ids) || user_ids.length === 0)
      return res.status(400).json({ success: false, message: "At least one user is required" });

    // Validate internal duplicates
    const dupCheck = checkDuplicateFarmers(farmer_ids);
    if (dupCheck.isDuplicate) {
      return res.status(409).json({ success: false, message: dupCheck.message });
    }

    const cleanFarmerIds = [...new Set(farmer_ids.map(String))];
    const cleanUserIds = [...new Set(user_ids)];

    const sql = `
      INSERT INTO ${TABLE} (line_farm_id, line_id, name, plant, farmer_ids, user_ids)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [
      line_farm_id,
      line_id,
      name,
      plant,
      JSON.stringify(cleanFarmerIds),
      JSON.stringify(cleanUserIds),
    ];

    const result = await query(sql, values);
    return res.status(201).json({ success: true, message: "Farmer line record created", data: result[0] });
  } catch (error) {
    console.error("Error in createFarmerLine:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// -------------------------------------------------
// UPDATE
// -------------------------------------------------
exports.updateFarmerLine = async (req, res) => {
  try {
    const { id } = req.params;
    const { line_farm_id, line_id, name, plant, farmer_ids, user_ids } = req.body;

    if (!id) return res.status(400).json({ success: false, message: "id is required" });

    const dupCheck = checkDuplicateFarmers(farmer_ids);
    if (dupCheck.isDuplicate) {
      return res.status(409).json({ success: false, message: dupCheck.message });
    }

    const cleanFarmerIds = [...new Set((farmer_ids || []).map(String))];
    const cleanUserIds = [...new Set(user_ids || [])];

    const sql = `
      UPDATE ${TABLE}
      SET line_farm_id = $1, line_id = $2, name = $3, plant = $4,
          farmer_ids = $5, user_ids = $6, updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING *
    `;
    const result = await query(sql, [
      line_farm_id,
      line_id,
      name,
      plant,
      JSON.stringify(cleanFarmerIds),
      JSON.stringify(cleanUserIds),
      id,
    ]);

    if (result.length === 0)
      return res.status(404).json({ success: false, message: `Record with id ${id} not found` });

    return res.json({ success: true, message: "Farmer line record updated", data: result[0] });
  } catch (error) {
    console.error("Error in updateFarmerLine:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// -------------------------------------------------
// DELETE
// -------------------------------------------------
exports.deleteFarmerLine = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: "id is required" });

    const result = await query(`DELETE FROM ${TABLE} WHERE id = $1 RETURNING id`, [id]);

    if (result.length === 0)
      return res.status(404).json({ success: false, message: `Record with id ${id} not found` });

    return res.json({ success: true, message: `Farmer line record with id ${id} deleted` });
  } catch (error) {
    console.error("Error in deleteFarmerLine:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// -------------------------------------------------
// SYNC ALL PLANT FARMERS TO A SPECIFIC LINE (auto-add)
// Internal helper: called after a new line is created or on-demand
// -------------------------------------------------
exports.syncPlantFarmersToLine = async (line_farm_id) => {
  // 1. Get the line_farm record to find plant + line details
  const lineFarmRows = await query(
    `SELECT * FROM ${LINE_FARM_TABLE} WHERE id = $1 LIMIT 1`,
    [line_farm_id]
  );
  if (!lineFarmRows || lineFarmRows.length === 0) {
    return { success: false, message: `Line farm ${line_farm_id} not found` };
  }
  const lineFarm = lineFarmRows[0];
  const plant = lineFarm.plant;

  // 2. Get all farmers from that plant (SAP live + DB fallback)
  const allPlantFarmerIds = await fetchPlantFarmerIds(plant);

  if (allPlantFarmerIds.length === 0) {
    return { success: true, message: "No farmers found in this plant", added: 0, total: 0 };
  }

  // 3. Find existing record for this line_farm_id
  const existingRecord = await query(
    `SELECT id, farmer_ids FROM ${TABLE} WHERE line_farm_id::text = $1::text LIMIT 1`,
    [String(line_farm_id)]
  );

  let currentLineFarmerIds = [];
  if (existingRecord && existingRecord.length > 0) {
    let fids = [];
    try {
      fids = typeof existingRecord[0].farmer_ids === 'string'
        ? JSON.parse(existingRecord[0].farmer_ids)
        : (existingRecord[0].farmer_ids || []);
    } catch (e) { fids = []; }
    currentLineFarmerIds = (Array.isArray(fids) ? fids : []).map(String);
  }

  // 4. Determine which farmers need to be added
  const farmersToAdd = allPlantFarmerIds.filter((fid) => !currentLineFarmerIds.includes(fid));

  // 5. Merge all farmers (preserving current + adding new)
  const mergedFarmerIds = [...new Set([...currentLineFarmerIds, ...allPlantFarmerIds])];

  // 6. Update or Insert
  if (existingRecord && existingRecord.length > 0) {
    await query(
      `UPDATE ${TABLE} SET farmer_ids = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [JSON.stringify(mergedFarmerIds), existingRecord[0].id]
    );
  } else {
    await query(
      `INSERT INTO ${TABLE} (line_farm_id, line_id, name, plant, farmer_ids, user_ids)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        line_farm_id,
        lineFarm.line_id,
        lineFarm.name,
        plant,
        JSON.stringify(mergedFarmerIds),
        JSON.stringify([]),
      ]
    );
  }

  return {
    success: true,
    added: farmersToAdd.length,
    total: mergedFarmerIds.length,
    farmerIds: farmersToAdd,
  };
};

// -------------------------------------------------
// AUTO SYNC PLANT FARMERS FROM A LIST (e.g. from SAP getFarmer)
// Ensures all farmers in the list are added to all lines of that plant
// -------------------------------------------------
exports.autoSyncPlantFarmersFromList = async (plant, farmerList) => {
  if (!plant || !Array.isArray(farmerList) || farmerList.length === 0) {
    return { success: false, message: "plant and farmerList are required" };
  }

  const plantStr = String(plant).trim();
  const cleanList = [...new Set(farmerList.map(String).filter(Boolean))];

  // 1. Find all farmer_line_master records for this plant
  const lines = await query(
    `SELECT id, farmer_ids FROM ${TABLE} WHERE plant::text = $1::text`,
    [plantStr]
  );

  let updatedLines = 0;
  let totalAdded = 0;

  for (const line of lines) {
    let fids = [];
    try {
      fids = typeof line.farmer_ids === 'string' ? JSON.parse(line.farmer_ids) : (line.farmer_ids || []);
    } catch (e) { fids = []; }
    fids = (Array.isArray(fids) ? fids : []).map(String);

    const missing = cleanList.filter((id) => !fids.includes(id));
    if (missing.length > 0) {
      const merged = [...new Set([...fids, ...missing])];
      await query(
        `UPDATE ${TABLE} SET farmer_ids = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [JSON.stringify(merged), line.id]
      );
      updatedLines++;
      totalAdded += missing.length;
    }
  }

  return { success: true, updatedLines, totalAdded };
};

// -------------------------------------------------
// AUTO ADD A SPECIFIC FARMER TO ALL LINES OF A PLANT
// -------------------------------------------------
exports.autoAddFarmerToPlantLines = async (farmer_supplier, plant) => {
  if (!farmer_supplier || !plant) {
    return { success: false, message: "farmer_supplier and plant are required" };
  }

  return await exports.autoSyncPlantFarmersFromList(plant, [farmer_supplier]);
};

// -------------------------------------------------
// SYNC SINGLE LINE - HTTP endpoint
// POST /api/broiler/farmer-line/sync-plant-farmers
// Body: { line_farm_id }
// -------------------------------------------------
exports.syncPlantFarmersToLineHandler = async (req, res) => {
  try {
    const { line_farm_id } = req.body;
    if (!line_farm_id) {
      return res.status(400).json({ success: false, message: "line_farm_id is required" });
    }
    const result = await exports.syncPlantFarmersToLine(line_farm_id);
    if (!result.success) {
      return res.status(404).json(result);
    }
    return res.json({
      success: true,
      message:
        result.added > 0
          ? `Auto-added ${result.added} new farmer(s) to this line (Total: ${result.total})`
          : `All ${result.total} plant farmers are already in this line`,
      added: result.added,
      total: result.total,
    });
  } catch (error) {
    console.error("Error in syncPlantFarmersToLineHandler:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// -------------------------------------------------
// SYNC ALL LINES - HTTP endpoint
// POST /api/broiler/farmer-line/sync-all-lines
// -------------------------------------------------
exports.syncAllLinesHandler = async (req, res) => {
  try {
    const allLineFarms = await query(`SELECT id, line_id, name, plant FROM ${LINE_FARM_TABLE}`);
    let totalAdded = 0;
    const summaries = [];

    for (const lf of allLineFarms) {
      try {
        const r = await exports.syncPlantFarmersToLine(lf.id);
        totalAdded += r.added || 0;
        summaries.push({ line_id: lf.line_id, added: r.added || 0, total: r.total || 0 });
      } catch (err) {
        console.warn(`Failed to sync line ${lf.line_id}:`, err.message);
      }
    }

    return res.json({
      success: true,
      message: `Sync complete across all lines. Added ${totalAdded} farmers total.`,
      details: summaries,
      totalAdded,
    });
  } catch (error) {
    console.error("Error in syncAllLinesHandler:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// -------------------------------------------------
// AUTO ADD FARMER - HTTP endpoint
// POST /api/broiler/farmer-line/auto-add-farmer
// Body: { farmer_supplier, plant }
// -------------------------------------------------
exports.autoAddFarmerHandler = async (req, res) => {
  try {
    const { farmer_supplier, plant } = req.body;
    if (!farmer_supplier || !plant) {
      return res.status(400).json({ success: false, message: "farmer_supplier and plant are required" });
    }
    const result = await exports.autoAddFarmerToPlantLines(farmer_supplier, plant);
    return res.json(result);
  } catch (error) {
    console.error("Error in autoAddFarmerHandler:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// -------------------------------------------------
// GET ASSIGNED LINES BY USER & PLANT
// -------------------------------------------------
exports.getUserLines = async (req, res) => {
  try {
    const { plant, user_id } = req.query;
    if (!plant) return res.status(400).json({ success: false, message: "plant is required" });
    if (!user_id) return res.status(400).json({ success: false, message: "user_id is required" });

    const result = await query(
      `SELECT * FROM ${TABLE} WHERE plant::text = $1::text ORDER BY id DESC`,
      [plant]
    );

    const userLines = result.filter((row) => {
      let uids = [];
      try {
        uids = typeof row.user_ids === "string" ? JSON.parse(row.user_ids) : row.user_ids;
      } catch (err) {
        console.warn("Failed to parse user_ids:", row.user_ids);
      }
      return Array.isArray(uids) && uids.map(String).includes(String(user_id));
    });

    return res.json({ success: true, data: userLines });
  } catch (error) {
    console.error("Error in getUserLines:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};