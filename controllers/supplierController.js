const { query } = require("../config/db");


exports.getAll = async (req, res) => {
    try {
        const result = await query("SELECT * FROM supplier WHERE status=1 ORDER BY created_at DESC");

        if (result.length === 0) {
            return res.status(401).json({ status: false, message: "The suppliers list is empty" });
        }

        res.status(200).json({status: true, data: result});
    } catch (error) {
        console.log(error);
        res.status(500).json({status: false, message: "Error while fetching suppliers", error: error});
    }
}

exports.addSupplier = async (req, res) => {
    const { supplier_id, name, status } = req.body;

    if (!name || status === undefined) {
        return res.status(400).json({
            status: false,
            message: "Missing required fields: name, status",
        });
    }

    try {
        const queryText = `
            INSERT INTO Supplier (supplier_id, name, status, created_at, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *;
        `;
        const values = [supplier_id, name, status];
        const result = await query(queryText, values);

        res.status(201).json({
            status: true,
            message: "Supplier added successfully",
            data: result[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while adding supplier",
            error: error.message,
        });
    }
};

exports.updateSupplier = async (req, res) => {
    const { updatedSupplierId } = req.params;
    const { supplier_id, name, status } = req.body;

    console.log(req.body)
    
    if (!supplier_id || !name || status === undefined) {
        return res.status(400).json({
            status: false,
            message: "Missing required fields: name, status",
        });
    }

    try {
        const queryText = `
            UPDATE Supplier
            SET supplier_id = $1, name = $2, status = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING *;
        `;
        const values = [supplier_id, name, status, updatedSupplierId];

        const result = await query(queryText, values);
        console.log(result)

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: "supplier not found",
            });
        }

        res.status(200).json({
            status: true,
            message: "Supplier updated successfully",
            data: result[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while updating supplier",
            error: error.message,
        });
    }
};

exports.deleteSupplier = async (req, res) => {
    const { id } = req.params;

    try {
        const queryText = `
            UPDATE Supplier
            SET status = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *;
        `;
        const values = [0, id];

        const result = await query(queryText, values);

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: "supplier not found",
            });
        }

        res.status(200).json({
            status: true,
            message: "Supplier Deleted successfully",
            data: result[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while deleting supplier",
            error: error.message,
        });
    }
};