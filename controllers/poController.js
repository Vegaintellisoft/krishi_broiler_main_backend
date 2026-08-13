const { query } = require("../config/db");

exports.addPO = async (req, res) => {
    const { po_no, supplier__id, bill_no,
        rr_no, materials, user_id, status, po_date, rr_date, supplier_invoice_date } = req.body;

    if (!po_no || !supplier__id || !materials) {
        return res.status(400).json({
            status: false,
            message: "Missing required fields: po_no, supplier__id, materials",
        });
    }

    if (!Array.isArray(materials) || materials.length === 0) {
        return res.status(400).json({
            status: false,
            message: "Materials must be a non-empty array.",
        });
    }

    try {
        const queryText = `
            INSERT INTO PO (po_no, supplier__id, bill_no, rr_no, 
            materials, user_id, status, po_date, rr_date, supplier_invoice_date, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *;
        `;

        const values = [po_no, supplier__id, bill_no, rr_no,
            JSON.stringify(materials), user_id, status, po_date, rr_date, supplier_invoice_date];

        const result = await query(queryText, values);

        if (result && result.length > 0) {
            res.status(201).json({
                status: true,
                message: "Purchase Order added successfully",
                data: result[0],
            });
        } else {
            res.status(500).json({
                status: false,
                message: "Error adding Purchase Order. No data returned from the database.",
            });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while adding Purchase Order",
            error: error.message,
        });
    }
};

exports.updatePO = async (req, res) => {
    const { id } = req.params;
    const { po_no, supplier__id, bill_no, rr_no, materials, status, po_date, rr_date, supplier_invoice_date } = req.body;

    // console.log(status)

    if (!po_no || !supplier__id || !materials) {
        return res.status(400).json({
            status: false,
            message: "Missing required fields: po_no, supplier__id, materials",
        });
    }

    if (!Array.isArray(materials) || materials.length === 0) {
        return res.status(400).json({
            status: false,
            message: "Materials must be a non-empty array.",
        });
    }

    try {
        const poCheckResult = await query("SELECT * FROM PO WHERE id = $1", [id]);

        if (poCheckResult.length === 0) {
            return res.status(404).json({
                status: false,
                message: "PO not found with the provided ID",
            });
        }

        const queryText = `
            UPDATE PO 
            SET po_no = $1, supplier__id = $2, bill_no = $3, 
            rr_no = $4, materials = $5, status=$6, 
            po_date = $7, rr_date = $8, supplier_invoice_date = $9,
            updated_at = CURRENT_TIMESTAMP
            WHERE id = $10
            RETURNING *;
        `;

        const values = [po_no, supplier__id, bill_no, rr_no, JSON.stringify(materials), status, po_date, rr_date, supplier_invoice_date, id];

        const result = await query(queryText, values);

        if (result && result.length > 0) {
            res.status(200).json({
                status: true,
                message: "Purchase Order updated successfully",
                data: result[0],
            });
        } else {
            res.status(500).json({
                status: false,
                message: "Error updating Purchase Order. No data returned from the database.",
            });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while updating Purchase Order",
            error: error.message,
        });
    }
};



// exports.getAll = async (req, res) => {
//     try {
//         const { user_id } = req.params;

//         let poQuery;
//         let params = [];

//         if (!user_id) {
//             // Case 1: user_id is null → return all
//             poQuery = "SELECT * FROM PO ORDER BY created_at DESC";
//         } else {
//             // Check user role from driver table
//             const driverResult = await query("SELECT role FROM driver WHERE id = $1", [user_id]);

//             if (driverResult.length === 0) {
//                 return res.status(404).json({ status: false, message: "User not found" });
//             }

//             const userRole = driverResult[0].role;

//             if (userRole === 'admin') {
//                 // Case 2: Admin → return all
//                 poQuery = "SELECT * FROM PO ORDER BY created_at DESC";
//             } else {
//                 // Case 3: Normal user → return only their POs
//                 poQuery = "SELECT * FROM PO WHERE user_id = $1 ORDER BY created_at DESC";
//                 params = [user_id];
//             }
//         }

//         const result = await query(poQuery, params);

//         if (result.length === 0) {
//             return res.status(404).json({ status: false, message: "The po list is empty" });
//         }

//         const fullData = await Promise.all(result.map(async (r) => {
//             const supplierResult = await query("SELECT * FROM supplier WHERE id = $1", [r.supplier__id]);
//             const supplierName = supplierResult?.length > 0 ? supplierResult[0]?.name : 'Unknown Supplier';

//             const materials = r.materials || [];
//             const materialCount = materials.length;

//             return {
//                 ...r,
//                 supplier_name: supplierName,
//                 material_count: materialCount
//             };
//         }));

//         res.status(200).json({ status: true, data: fullData });

//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ status: false, message: "Error while fetching po", error: error.message });
//     }
// };



exports.getAll = async (req, res) => {
    try {
        const { user_id } = req.params;

        // If no user_id → send everything
        if (!user_id) {
            const result = await query(`
                SELECT p.*, s.name AS supplier_name,
                TO_CHAR(p.po_date, 'YYYY-MM-DD') AS po_date,
                    TO_CHAR(p.rr_date, 'YYYY-MM-DD') AS rr_date,
                    TO_CHAR(p.supplier_invoice_date, 'YYYY-MM-DD') AS supplier_invoice_date,
                       jsonb_array_length(p.materials) AS material_count
                FROM PO p
                LEFT JOIN supplier s ON p.supplier__id = s.id
                ORDER BY p.created_at DESC
            `);

            if (!result.length) {
                return res.status(404).json({ status: false, message: "The po list is empty" });
            }

            return res.status(200).json({ status: true, data: result });
        }

        // Check user role
        const driverResult = await query(
            "SELECT role FROM driver WHERE id = $1",
            [user_id]
        );

        if (!driverResult.length) {
            return res.status(404).json({ status: false, message: "User not found" });
        }

        const role = driverResult[0].role;

        // Admin → return all PO
        if (role === "admin") {
            const result = await query(`
                SELECT p.*, s.name AS supplier_name,
                TO_CHAR(p.po_date, 'YYYY-MM-DD') AS po_date,
                    TO_CHAR(p.rr_date, 'YYYY-MM-DD') AS rr_date,
                    TO_CHAR(p.supplier_invoice_date, 'YYYY-MM-DD') AS supplier_invoice_date,
                       jsonb_array_length(p.materials) AS material_count
                FROM PO p
                LEFT JOIN supplier s ON p.supplier__id = s.id
                ORDER BY p.created_at DESC
            `);

            return res.json({ status: true, data: result });
        }

        // Non-admin → return their PO + admin-created PO
        const adminIds = await query(
            "SELECT id FROM driver WHERE role = 'admin'"
        );

        const adminIdList = adminIds.map(a => a.id);  // array of admin IDs

        const result = await query(
            `
            SELECT p.*, s.name AS supplier_name,
            TO_CHAR(p.po_date, 'YYYY-MM-DD') AS po_date,
                    TO_CHAR(p.rr_date, 'YYYY-MM-DD') AS rr_date,
                    TO_CHAR(p.supplier_invoice_date, 'YYYY-MM-DD') AS supplier_invoice_date,
                   jsonb_array_length(p.materials) AS material_count
            FROM PO p
            LEFT JOIN supplier s ON p.supplier__id = s.id
            WHERE p.user_id = ANY($1::int[]) 
               OR p.user_id = $2
            ORDER BY p.created_at DESC
            `,
            [adminIdList, user_id]
        );

        if (!result.length) {
            return res.status(404).json({ status: false, message: "The po list is empty" });
        }

        return res.json({ status: true, data: result });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error while fetching PO",
            error: error.message
        });
    }
};


exports.deletePO = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ status: false, message: "PO ID is required" });
        }

        const result = await query("DELETE FROM PO WHERE id = $1 RETURNING id", [id]);


        if (result.length === 0) {
            return res.status(404).json({ status: false, message: "PO not found" });
        }

        res.status(200).json({ status: true, message: "PO deleted successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ status: false, message: "Error while deleting po", error: error });
    }
}