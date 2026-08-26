const { query } = require("../config/db");

function parseDateForDb(val) {
    if (!val) return null;
    const str = String(val).trim();
    if (!str) return null;
    // If format is DD/MM/YYYY or DD-MM-YYYY
    const ddmmyyyy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddmmyyyy) {
        const day = ddmmyyyy[1].padStart(2, '0');
        const month = ddmmyyyy[2].padStart(2, '0');
        const year = ddmmyyyy[3];
        return `${year}-${month}-${day}`;
    }
    // If format is YYYY-MM-DD or ISO
    const yyyymmdd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (yyyymmdd) {
        const year = yyyymmdd[1];
        const month = yyyymmdd[2].padStart(2, '0');
        const day = yyyymmdd[3].padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
    }
    return null;
}

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
        const cleanPoDate = parseDateForDb(po_date);
        const cleanRrDate = parseDateForDb(rr_date);
        const cleanInvoiceDate = parseDateForDb(supplier_invoice_date);
        const cleanStatus = status !== undefined && status !== null && status !== '' ? parseInt(status, 10) : 1;
        const cleanUserId = user_id ? parseInt(user_id, 10) : null;
        const cleanSupplierId = parseInt(supplier__id, 10);

        const queryText = `
            INSERT INTO PO (po_no, supplier__id, bill_no, rr_no, 
            materials, user_id, status, po_date, rr_date, supplier_invoice_date, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *;
        `;

        const values = [
            String(po_no).trim(),
            cleanSupplierId,
            bill_no ? String(bill_no).trim() : null,
            rr_no ? String(rr_no).trim() : null,
            JSON.stringify(materials),
            cleanUserId,
            cleanStatus,
            cleanPoDate,
            cleanRrDate,
            cleanInvoiceDate
        ];

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
            message: error.message || "Error while adding Purchase Order",
            error: error.message,
        });
    }
};

exports.updatePO = async (req, res) => {
    const { id } = req.params;
    const { po_no, supplier__id, bill_no, rr_no, materials, status, po_date, rr_date, supplier_invoice_date } = req.body;

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

        const cleanPoDate = parseDateForDb(po_date);
        const cleanRrDate = parseDateForDb(rr_date);
        const cleanInvoiceDate = parseDateForDb(supplier_invoice_date);
        const cleanStatus = status !== undefined && status !== null && status !== '' ? parseInt(status, 10) : 1;
        const cleanSupplierId = parseInt(supplier__id, 10);

        const queryText = `
            UPDATE PO 
            SET po_no = $1, supplier__id = $2, bill_no = $3, 
            rr_no = $4, materials = $5, status=$6, 
            po_date = $7, rr_date = $8, supplier_invoice_date = $9,
            updated_at = CURRENT_TIMESTAMP
            WHERE id = $10
            RETURNING *;
        `;

        const values = [
            String(po_no).trim(),
            cleanSupplierId,
            bill_no ? String(bill_no).trim() : null,
            rr_no ? String(rr_no).trim() : null,
            JSON.stringify(materials),
            cleanStatus,
            cleanPoDate,
            cleanRrDate,
            cleanInvoiceDate,
            id
        ];

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
            message: error.message || "Error while updating Purchase Order",
            error: error.message,
        });
    }
};

exports.getAll = async (req, res) => {
    try {
        const result = await query(`
            SELECT p.*, s.name AS supplier_name,
                TO_CHAR(p.po_date, 'YYYY-MM-DD') AS po_date,
                TO_CHAR(p.rr_date, 'YYYY-MM-DD') AS rr_date,
                TO_CHAR(p.supplier_invoice_date, 'YYYY-MM-DD') AS supplier_invoice_date,
                jsonb_array_length(p.materials) AS material_count
            FROM PO p
            LEFT JOIN supplier s ON p.supplier__id = s.id
            ORDER BY 
                CASE 
                    WHEN p.status = 3 THEN 1  -- Active
                    WHEN p.status = 1 THEN 2  -- Pending
                    WHEN p.status = 2 THEN 3  -- In-Transit
                    WHEN p.status = 4 THEN 4  -- Close
                    ELSE 5
                END ASC,
                p.created_at DESC
        `);

        return res.json({ status: true, data: result || [] });
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
};
