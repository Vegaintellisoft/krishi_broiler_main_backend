const { query } = require("../../config/db");

const TABLE = "broiler.line_farm_master";
const SKIP_FIELDS = new Set(["id", "created_at", "updated_at"]);
const isSafeColumn = (col) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col);

const pickColumns = (body) =>
  Object.keys(body || {}).filter((c) => isSafeColumn(c) && !SKIP_FIELDS.has(c));

// -------------------------------------------------
// GET ALL
// -------------------------------------------------
exports.getAllLineFarm = async (req, res) => {
  try {
    const result = await query(`SELECT * FROM ${TABLE} ORDER BY id DESC`);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error in getAllLineFarm:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// -------------------------------------------------
// CREATE
// -------------------------------------------------
exports.createLineFarm = async (req, res) => {
  try {
    const data = req.body || {};
    const cols = pickColumns(data);

    if (cols.length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields provided" });
    }

    // Duplicate check on line_id
    if (data.line_id) {
      const dupLineId = await query(
        `SELECT id FROM ${TABLE} WHERE LOWER(TRIM(line_id)) = LOWER(TRIM($1)) LIMIT 1`,
        [data.line_id]
      );
      if (dupLineId.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Duplicate: Line Id "${data.line_id}" already exists.`,
        });
      }
    }

    // Duplicate check on name
    if (data.name) {
      const dupName = await query(
        `SELECT id FROM ${TABLE} WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
        [data.name]
      );
      if (dupName.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Duplicate: Name "${data.name}" already exists.`,
        });
      }
    }

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const values = cols.map((c) => data[c]);

    const sql = `
      INSERT INTO ${TABLE} (${cols.map((c) => `"${c}"`).join(", ")})
      VALUES (${placeholders})
      RETURNING *
    `;

    const result = await query(sql, values);
    return res.status(201).json({
      success: true,
      message: "Line farm record created",
      data: result[0],
    });
  } catch (error) {
    console.error("Error in createLineFarm:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// -------------------------------------------------
// UPDATE
// -------------------------------------------------
exports.updateLineFarm = async (req, res) => {
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

    // Duplicate check on line_id (excluding current record)
    if (data.line_id) {
      const dupLineId = await query(
        `SELECT id FROM ${TABLE} WHERE LOWER(TRIM(line_id)) = LOWER(TRIM($1)) AND id <> $2 LIMIT 1`,
        [data.line_id, id]
      );
      if (dupLineId.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Duplicate: Line Id "${data.line_id}" already exists.`,
        });
      }
    }

    // Duplicate check on name (excluding current record)
    if (data.name) {
      const dupName = await query(
        `SELECT id FROM ${TABLE} WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND id <> $2 LIMIT 1`,
        [data.name, id]
      );
      if (dupName.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Duplicate: Name "${data.name}" already exists.`,
        });
      }
    }

    const setClause = cols.map((c, i) => `"${c}" = $${i + 1}`).join(", ");
    const values = cols.map((c) => data[c]);
    values.push(id);

    const sql = `
      UPDATE ${TABLE}
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${values.length}
      RETURNING *
    `;

    const result = await query(sql, values);

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Line farm record with id ${id} not found`,
      });
    }

    return res.json({
      success: true,
      message: "Line farm record updated",
      data: result[0],
    });
  } catch (error) {
    console.error("Error in updateLineFarm:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// -------------------------------------------------
// DELETE
// -------------------------------------------------
exports.deleteLineFarm = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, message: "id is required" });
    }

    const result = await query(
      `DELETE FROM ${TABLE} WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Line farm record with id ${id} not found`,
      });
    }

    return res.json({
      success: true,
      message: `Line farm record with id ${id} deleted`,
    });
  } catch (error) {
    console.error("Error in deleteLineFarm:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
