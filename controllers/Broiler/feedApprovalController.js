const { query } = require("../../config/db"); 
const TABLE_NAME = "feed_approval"; 

const getInsertUpdateColumns = (body) => {
    const columns = Object.keys(body).filter(key => 
        key !== 'id' && key !== 'created_at' && key !== 'updated_at'
    );
    return columns;
};

exports.create = async (req, res) => {
    try {
        const data = req.body;
        
        const columns = getInsertUpdateColumns(data);
        const values = columns.map(col => data[col]);
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        const columnNames = columns.map(col => `"${col}"`).join(', ');

        const sql = `
            INSERT INTO "${TABLE_NAME}" (${columnNames})
            VALUES (${placeholders})
            RETURNING *;
        `;

        const result = await query(sql, values);

        res.status(201).json({ 
            status: true, 
            message: "Feed approval record created successfully", 
            data: result[0] 
        });

    } catch (error) {
        console.error("Error creating Feed approval record:", error);
        res.status(500).json({ 
            status: false, 
            message: "Error creating Feed approval record", 
            error: error.message 
        });
    }
};

exports.getAll = async (req, res) => {
    try {
        const result = await query(`SELECT * FROM "${TABLE_NAME}" ORDER BY created_at DESC`); 

        if (result.length === 0) {
            return res.status(200).json({ status: true, message: "The Feed approval list is empty", data: [] });
        }

        res.status(200).json({ status: true, data: result });
    } catch (error) {
        console.error("Error fetching Feed approval records:", error);
        res.status(500).json({ status: false, message: "Error fetching Feed approval records", error: error.message });
    }
};

exports.getOne = async (req, res) => {
    try {
        const { id } = req.params; 

        const result = await query(`SELECT * FROM "${TABLE_NAME}" WHERE id = $1`, [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Feed approval record with ID ${id} not found` });
        }

        res.status(200).json({ status: true, data: result[0] });

    } catch (error) {
        console.error("Error fetching single Feed approval record:", error);
        res.status(500).json({ status: false, message: "Error fetching Feed approval record", error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        
        const columns = getInsertUpdateColumns(data);
        const setClauses = columns.map((col, index) => `"${col}" = $${index + 1}`).join(', ');
        
        const values = columns.map(col => data[col]); 
        values.push(id); 

        const sql = `
            UPDATE "${TABLE_NAME}"
            SET ${setClauses}, "updated_at" = CURRENT_TIMESTAMP
            WHERE id = $${values.length} 
            RETURNING *; 
        `;
        
        const result = await query(sql, values);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Feed approval record with ID ${id} not found for update` });
        }

        res.status(200).json({ 
            status: true, 
            message: "Feed approval record updated successfully", 
            data: result[0] 
        });

    } catch (error) {
        console.error("Error updating Feed approval record:", error);
        res.status(500).json({ 
            status: false, 
            message: "Error updating Feed approval record", 
            error: error.message 
        });
    }
};

exports.remove = async (req, res) => {
    try {
        const { id } = req.params; 
        
        const result = await query(`DELETE FROM "${TABLE_NAME}" WHERE id = $1 RETURNING id`, [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Feed approval record with ID ${id} not found for deletion` });
        }

        res.status(200).json({ status: true, message: `Feed approval record with ID ${id} deleted successfully` });

    } catch (error) {
        console.error("Error deleting Feed approval record:", error);
        res.status(500).json({ status: false, message: "Error deleting Feed approval record", error: error.message });
    }
};