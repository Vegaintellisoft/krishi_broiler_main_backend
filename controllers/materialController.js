const { query } = require("../config/db");


exports.getAll = async (req, res) => {
    try {
        const result = await query("SELECT * FROM material WHERE status IN (1, 2) ORDER BY created_at DESC");

        if (result.length === 0) {
            return res.status(401).json({ status: false, message: "The materials list is empty" });
        }

        res.status(200).json({ status: true, data: result });
    } catch (error) {
        console.log(error);
        res.status(500).json({ status: false, message: "Error while fetching materials", error: error });
    }
}

exports.addMaterial = async (req, res) => {
    const { name, material_code, hsn_code, status, cgst, sgst, e_way_bill, is_taxable, eway_exemption_notify } = req.body;

    // console.log(req.body)

    if (!name || !hsn_code || status === undefined || !cgst || !sgst || !e_way_bill) {
        return res.status(400).json({
            status: false,
            message: "Missing required fields: name, hsn_code, status",
        });
    }

    let d_cgst = parseFloat(cgst);
    let d_sgst = parseFloat(sgst);

    console.log(d_cgst, d_sgst)

    // let d_e_way_bill = e_way_bill === "1"

    try {
        const queryText = `
            INSERT INTO Material (name, hsn_code, material_code, status, cgst, sgst,
             e_way_bill, is_taxable, eway_exemption_notify, created_at, updated_at)
            VALUES ($1, $2, $3, $4,$5,$6,$7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *;
        `;
        const values = [name, hsn_code, material_code, status, d_cgst, d_sgst, e_way_bill, is_taxable, eway_exemption_notify];
        const result = await query(queryText, values);

        res.status(201).json({
            status: true,
            message: "Material added successfully",
            data: result[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while adding material",
            error: error.message,
        });
    }
};

exports.updateMaterial = async (req, res) => {
    const { updatedMaterialId } = req.params;
    const { name, material_code, hsn_code, status, cgst, sgst, e_way_bill, is_taxable, eway_exemption_notify } = req.body;

    console.log(name, hsn_code, status, cgst, sgst, e_way_bill, material_code)

    if (
        !name ||
        !hsn_code ||
        cgst === undefined ||
        sgst === undefined
    ) {
        return res.status(400).json({
            status: false,
            message: "Missing required fields: name, hsn_code, cgst, sgst",
        });
    }


    let d_cgst = parseFloat(cgst);
    let d_sgst = parseFloat(sgst);

    // let d_e_way_bill = e_way_bill === "1"

    try {
        const queryText = `
            UPDATE Material
            SET name = $1, hsn_code = $2, status=$3, cgst=$4, sgst=$5, 
            e_way_bill=$6, material_code=$7, is_taxable=$8, eway_exemption_notify=$9,
            updated_at = CURRENT_TIMESTAMP
            WHERE id = $10
            RETURNING *;
        `;
        const values = [name, hsn_code, status, d_cgst, d_sgst, e_way_bill, material_code, is_taxable, eway_exemption_notify, updatedMaterialId];

        const result = await query(queryText, values);

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: "material not found",
            });
        }

        res.status(200).json({
            status: true,
            message: "material updated successfully",
            data: result[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while updating material",
            error: error.message,
        });
    }
};

exports.deleteMaterial = async (req, res) => {
    const { id } = req.params;

    try {
        const queryText = `
            UPDATE Material
            SET status = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *;
        `;
        const values = [0, id];

        const result = await query(queryText, values);

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: "material not found",
            });
        }

        res.status(200).json({
            status: true,
            message: "material Deleted successfully",
            data: result[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while deleting material",
            error: error.message,
        });
    }
};