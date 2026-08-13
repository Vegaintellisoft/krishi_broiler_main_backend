// controllers/masterSync.js

const { query } = require("../../../config/db");
const uniqueKeys = require("./uniqueKeys");
const broilerMasterData = require("../sap/broilerMaster.json");
const broilerOtherData = require("../sap/broilerSAP.json");
const MAX_CHUNK = 1000;

function normalizePayload(body) {
    if (!body) return [];

    if (Array.isArray(body)) {
        const merged = Object.assign({}, ...body.filter(Boolean));
        return Object.values(merged).filter(v => typeof v === "object");
    }
    else if (typeof body === "object") {
        // if keys are numeric and values objects, map them
        // If body has top-level keys like created_at,id, ignore them
        const rows = [];
        for (const k of Object.keys(body)) {
            if (/^\d+$/.test(k) && typeof body[k] === "object") rows.push(body[k]);
        }

        if (rows.length) return rows;

        const vals = Object.values(body).filter(v => typeof v === "object");
        if (vals.length > 0) return vals;
        return [body];
    }

    return [];
}

function buildUpsertQuery(table, rows, keyFields) {

    const colsSet = new Set();
    rows.forEach(r => Object.keys(r).forEach(c => colsSet.add(c)));
    const cols = [...colsSet];

    const values = [];
    const rowPlaceholders = rows.map((r, rowIndex) => {
        const ph = cols.map((c, colIndex) => {
            values.push(r[c] === undefined ? null : r[c]);
            return `$${values.length}`;
        });
        return `(${ph.join(", ")})`;
    });

    const conflictCols = keyFields.map(c => `"${c}"`).join(", ");

    // update clause: update all non-key columns
    const nonKeyCols = cols.filter(c => !keyFields.includes(c));
    const updateClause = nonKeyCols.length
        ? nonKeyCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(", ") + ", updated_at = CURRENT_TIMESTAMP"
        : 'updated_at = CURRENT_TIMESTAMP';

    const columnList2 = cols.map(c => `"${c}"`).join(", ");
    const sql2 = `
    INSERT INTO "${table}" (${columnList2})
    VALUES ${rowPlaceholders.join(", ")}
    ON CONFLICT (${conflictCols})
    DO UPDATE SET ${updateClause}
  `;

    return { sql: sql2, values, cols };
}

exports.broilerMasterInsert = async (req, res) => {
    const { name } = req.params;
    if (!uniqueKeys[name]) {
        return res.status(400).json({ error: "Invalid API call. Unknown master name." });
    }

    const rows = normalizePayload(req.body);
    if (!rows.length) return res.status(400).json({ error: "No valid records found in payload." });

    const keyFields = uniqueKeys[name];

    for (const r of rows) {
        for (const k of keyFields) {
            if (!(k in r)) {
                return res.status(400).json({ error: `Missing key field '${k}' in one or more rows for ${name}` });
            }
        }
    }

    try {
        await query("BEGIN");
        // insert in chunks
        for (let i = 0; i < rows.length; i += MAX_CHUNK) {
            const chunk = rows.slice(i, i + MAX_CHUNK);
            const { sql, values } = buildUpsertQuery(name, chunk, keyFields);
            // execute
            await query(sql, values);
        }
        await query("COMMIT");
        res.json({ message: `${rows.length} records processed for ${name}` });
    } catch (err) {
        await query("ROLLBACK");
        console.error("Master sync error:", err);
        res.status(500).json({ error: "Database error while processing" });
    }
};


exports.getAllBroilerMaster = async (req, res) => {
    const { name } = req.params;
    const { plant } = req.query;

    if (!broilerMasterData[name] && !broilerOtherData[name]) {
        return res.status(400).json({ status: false, error: `Invalid API call. Unknown master name: ${name}.` });
    }

    try {
        let sql = `SELECT * FROM broiler.${name}`;
        let values = [];

        if (plant) {
            sql += ` WHERE plant = $1`;
            values.push(plant);
        }

        sql += ` ORDER BY id ASC`;

        const result = await query(sql, values);

        if (!result || result.length === 0) {
            return res.status(404).json({ status: false, message: `No records found for ${name}` });
        }

        res.status(200).json({
            status: true,
            message: `${result.length} records fetched from ${name}`,
            data: result
        });
    } catch (error) {
        console.error(`Error fetching data for ${name}:`, error);
        res.status(500).json({
            status: false,
            error: "Database error while fetching records."
        });
    }
};

exports.getMaterials = async (req, res) => {
  const { plant, start } = req.query;

  try {
    let sql = `SELECT * FROM broiler.material`;
    const conditions = [];
    const values = [];

    if(start === "MD") {
      conditions.push(`stock <> '0'`);
    }

    if (plant) {
      conditions.push(`plant = $${values.length + 1}`);
      values.push(plant);
    }

    if (start) {
      conditions.push(`material_id LIKE $${values.length + 1}`);
      values.push(`${start}%`);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ');
    }

    sql += ` ORDER BY id ASC`;

    const result = await query(sql, values);

    if (!result || result.length === 0) {
      return res.status(404).json({
        status: false,
        message: `No records found for materials`,
      });
    }

    res.status(200).json({
      status: true,
      message: `${result.length} records fetched from materials`,
      data: result,
    });
  } catch (error) {
    console.error(`Error fetching data for materials:`, error);
    res.status(500).json({
      status: false,
      error: "Database error while fetching records.",
    });
  }
};