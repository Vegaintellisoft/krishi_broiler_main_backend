const { query } = require("../config/db");



exports.addUnit = async (req, res) => {
    const { unit, description } = req.body;

    console.log(req.body);

    if (!unit || !description) {
        return res.status(400).json({
            status: false,
            message: "Missing required fields: unit, description",
        });
    }

    try {
        const queryText = `
            INSERT INTO unit (unit, description)
            VALUES ($1, $2)
            RETURNING *;
        `;
        
        const values = [unit, description];

        const result = await query(queryText, values);

        if (result && result.length > 0) {
            res.status(201).json({
                status: true,
                message: "Unit added successfully",
                data: result[0],
            });
        } else {
            res.status(500).json({
                status: false,
                message: "Error adding Unit. No data returned from the database.",
            });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while adding Unit",
            error: error.message,
        });
    }
};


exports.getAll= async (req, res) => {
    try {
        const result = await query("SELECT * FROM unit");

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: "No units found" });
        }

        res.status(200).json({
            status: true,
            data: result,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while fetching units",
            error: error.message,
        });
    }
};


exports.updateUnit = async (req, res) => {
    const { id } = req.params;
    const { unit, description } = req.body;

    if (!unit || !description) {
        return res.status(400).json({
            status: false,
            message: "Missing required fields: unit, description",
        });
    }

    try {
        const unitCheckResult = await query("SELECT * FROM unit WHERE id = $1", [id]);

        if (unitCheckResult.length === 0) {
            return res.status(404).json({
                status: false,
                message: "Unit not found with the provided ID",
            });
        }

        const queryText = `
            UPDATE unit 
            SET unit = $1, description = $2
            WHERE id = $3
            RETURNING *;
        `;
        
        const values = [unit, description, id];

        const result = await query(queryText, values);

        if (result && result.length > 0) {
            res.status(200).json({
                status: true,
                message: "Unit updated successfully",
                data: result[0],
            });
        } else {
            res.status(500).json({
                status: false,
                message: "Error updating Unit. No data returned from the database.",
            });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while updating Unit",
            error: error.message,
        });
    }
};


exports.deleteUnit = async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ status: false, message: "Unit ID is required" });
    }

    try {
        const unitCheckResult = await query("SELECT * FROM unit WHERE id = $1", [id]);

        if (unitCheckResult.length === 0) {
            return res.status(404).json({
                status: false,
                message: "Unit not found with the provided ID",
            });
        }

        const result = await query("DELETE FROM unit WHERE id = $1 RETURNING id", [id]);

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: "Error deleting Unit. Unit not found",
            });
        }

        res.status(200).json({
            status: true,
            message: "Unit deleted successfully",
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while deleting Unit",
            error: error.message,
        });
    }
};


