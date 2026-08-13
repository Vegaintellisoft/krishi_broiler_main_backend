const { query } = require("../config/db");

exports.getAll = async (req, res) => {
    try {
        const result = await query(`
            SELECT 
                sl.*, 
                a.first_name, 
                a.last_name
            FROM source_location sl
            LEFT JOIN admin a 
                ON sl.admin_id = a.id
            ORDER BY sl.created_at DESC
        `);

        if (result.length === 0) {
            return res.status(401).json({
                status: false,
                message: "The from location list is empty"
            });
        }

        res.status(200).json({ status: true, data: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while fetching source data"
        });
    }
};



exports.addSourceLocation = async (req, res) => {
    const { name: source_name, address, admin_id } = req.body;

    if (!source_name || !address || !admin_id) {
        return res.status(400).json({
            status: false,
            message: "Missing required fields: source_name, address",
        });
    }
    const { door_no, company, street, city, district, state, pincode, gst_in } = address;
    if (!city || !state || !gst_in) {
        return res.status(400).json({
            status: false,
            message: "Address is incomplete. Missing fields in address.",
        });
    }
    const parts = [door_no, company, street, city, district, state, pincode, gst_in];
    const full_address = parts.filter(Boolean).join(", ");

    const sourceAddress = { ...address, full_address };

    try {
        const queryText = `
            INSERT INTO source_location (name, address, admin_id, created_at, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *;
        `;
        const values = [source_name, sourceAddress, admin_id];
        const result = await query(queryText, values);

        res.status(201).json({
            status: true,
            message: "From address added successfully",
            data: result[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while adding From address",
            error: error.message,
        });
    }
};

exports.updateSourceLocation = async (req, res) => {
    const { updatedSourceId } = req.params;
    const { name: source_name, address, admin_id } = req.body;

    if (!source_name || !address || !admin_id) {
        return res.status(400).json({
            status: false,
            message: "Missing required fields: source_name, address",
        });
    }

    const { door_no, company, street, city, district, state, pincode, gst_in } = address;

    if (!city || !state || !gst_in) {
        return res.status(400).json({
            status: false,
            message: "Address is incomplete. Missing fields in address.",
        });
    }

    const parts = [door_no, company, street, city, district, state, pincode, gst_in];
    const full_address = parts.filter(Boolean).join(", ");

    const sourceAddress = { ...address, full_address };

    try {
        const queryText = `
            UPDATE source_location
            SET name = $1, address = $2, admin_id = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING *;
        `;
        const values = [source_name, sourceAddress, admin_id, updatedSourceId];

        const result = await query(queryText, values);

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: "Source Address not found",
            });
        }

        res.status(200).json({
            status: true,
            message: "Source Address updated successfully",
            data: result[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while updating Source Address",
            error: error.message,
        });
    }
};


exports.deleteSourceLocation = async (req, res) => {
    const { sourceId } = req.params;

    if (!sourceId) {
        return res.status(400).json({
            status: false,
            message: "Missing required parameter: sourceId",
        });
    }

    try {
        const queryText = `
            DELETE FROM source_location
            WHERE id = $1
            RETURNING *;
        `;
        const values = [sourceId];
        const result = await query(queryText, values);

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: "Source address not found or already deleted",
            });
        }

        res.status(200).json({
            status: true,
            message: "Source address deleted successfully",
            data: result[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while deleting source address",
            error: error.message,
        });
    }
};
