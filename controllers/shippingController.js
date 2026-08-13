const { query } = require("../config/db");

exports.getAll = async (req, res) => {
    try {
        const result = await query("SELECT * FROM Shipping_Address ORDER BY created_at DESC");

        if (result.length === 0) {
            return res.status(401).json({ status: false, message: "The shipping list is empty" });
        }

        res.status(200).json({ status: true, data: result });
    } catch (error) {
        console.log(error);
        res.status(500).json({ status: false, message: "Error while fetching shipping data" });
    }
}


exports.addShipping = async (req, res) => {
    const { sap_code, sap_name, address } = req.body;

    if (!sap_code || !sap_name || !address) {
        return res.status(400).json({
            status: false,
            message: "Missing required fields: sap_code, sap_name, address",
        });
    }
    const { door_no, company, street, city, district, state, pincode, gst_in } = address;

    if (!city || !state) {
        return res.status(400).json({
            status: false,
            message: "Address is incomplete. Missing fields in address.",
        });
    }
    const parts = [door_no, company, street, city, district, state, pincode, gst_in];
    // console.log(parts)

    const full_address = parts.filter(Boolean).join(", ");

    const shippingAddress = { ...address, full_address };

    // console.log(shippingAddress)

    try {
        const queryText = `
            INSERT INTO Shipping_Address (sap_code, sap_name, address, created_at, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *;
        `;
        const values = [sap_code, sap_name, shippingAddress];
        const result = await query(queryText, values);

        res.status(201).json({
            status: true,
            message: "Shipping address added successfully",
            data: result[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while adding shipping address",
            error: error.message,
        });
    }
};

exports.updateShipping = async (req, res) => {
    const { updatedShippingId } = req.params;
    const { sap_code, sap_name, address } = req.body;

    if (!sap_code || !sap_name || !address) {
        return res.status(400).json({
            status: false,
            message: "Missing required fields: sap_code, sap_name, address",
        });
    }

    const { door_no, company, street, city, district, state, pincode, gst_in } = address;

    if (!city || !state) {
        return res.status(400).json({
            status: false,
            message: "Address is incomplete. Missing fields in address.",
        });
    }

    const parts = [door_no, company, street, city, district, state, pincode, gst_in];
    // console.log(parts)

    const full_address = parts.filter(Boolean).join(", ");

    const shippingAddress = { ...address, full_address };

    // console.log(shippingAddress)

    try {
        const queryText = `
            UPDATE Shipping_Address
            SET sap_code = $1, sap_name = $2, address = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING *;
        `;
        const values = [sap_code, sap_name, shippingAddress, updatedShippingId];

        const result = await query(queryText, values);

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: "Shipping address not found",
            });
        }

        res.status(200).json({
            status: true,
            message: "Shipping address updated successfully",
            data: result[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while updating shipping address",
            error: error.message,
        });
    }
};


exports.deleteShipping = async (req, res) => {
    const { shippingId } = req.params;

    if (!shippingId) {
        return res.status(400).json({
            status: false,
            message: "Missing required parameter: shippingId",
        });
    }

    try {
        const queryText = `
            DELETE FROM Shipping_Address
            WHERE id = $1
            RETURNING *;
        `;
        const values = [shippingId];
        const result = await query(queryText, values);

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: "Shipping address not found or already deleted",
            });
        }

        res.status(200).json({
            status: true,
            message: "Shipping address deleted successfully",
            data: result[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while deleting shipping address",
            error: error.message,
        });
    }
};
