const { query } = require("../../config/db");

const TABLE = "broiler.farmer_line_master";

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

const checkDuplicateFarmers = async (farmer_ids, excludeId = null) => {
  const existing = await query(
    `SELECT id, line_id, farmer_ids FROM ${TABLE}` + (excludeId ? " WHERE id <> $1" : ""),
    excludeId ? [excludeId] : []
  );

  const assignedFarmers = {};
  for (const row of existing) {
    const fids = typeof row.farmer_ids === 'string' ? JSON.parse(row.farmer_ids) : row.farmer_ids;
    if (Array.isArray(fids)) {
      for (const fid of fids) {
        assignedFarmers[fid] = row.line_id;
      }
    }
  }

  for (const fid of farmer_ids) {
    if (assignedFarmers[fid]) {
      return {
        isDuplicate: true,
        message: `Farmer ${fid} is already assigned to Line ID "${assignedFarmers[fid]}".`
      };
    }
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

    // Validate no duplicate farmers
    const dupCheck = await checkDuplicateFarmers(farmer_ids);
    if (dupCheck.isDuplicate) {
      return res.status(409).json({ success: false, message: dupCheck.message });
    }

    const sql = `
      INSERT INTO ${TABLE} (line_farm_id, line_id, name, plant, farmer_ids, user_ids)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const result = await query(sql, [
      line_farm_id,
      line_id,
      name,
      plant,
      JSON.stringify(farmer_ids),
      JSON.stringify(user_ids),
    ]);

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

    // Validate no duplicate farmers
    const dupCheck = await checkDuplicateFarmers(farmer_ids, id);
    if (dupCheck.isDuplicate) {
      return res.status(409).json({ success: false, message: dupCheck.message });
    }

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
      JSON.stringify(farmer_ids),
      JSON.stringify(user_ids),
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

    // Filter lines where user_ids contains the user_id
    const userLines = result.filter(row => {
      let uids = [];
      try {
        uids = typeof row.user_ids === 'string' ? JSON.parse(row.user_ids) : row.user_ids;
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
