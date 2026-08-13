// controllers/reportController.js
const { default: axios } = require("axios");
const { query } = require("../config/db");
const qs = require("qs");
const { convertToSAP } = require("../services/sapConvert");

const SAP_BASE_URL = process.env.SAP_BASE_URL;
const SAP_USERNAME = process.env.SAP_USERNAME;
const SAP_PASSWORD = process.env.SAP_PASSWORD;


exports.getDetailedReport = async (req, res) => {
    try {
        // --- 1. Handle Date Filtering ---
        // Get dates from query params or default to today
        let { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            const today = new Date();
            // Format to YYYY-MM-DD for SQL 'BETWEEN' clause
            const todayString = today.toISOString().split('T')[0];
            startDate = startDate || todayString;
            endDate = endDate || todayString;
        }

        // --- 2. Construct the Main SQL Query ---
        // This query unnests the materials JSONB and joins all necessary tables.
        const reportQuery = `
            SELECT
                dc.id as s_no,
                dc.created_at AS doc_date,
                dc.is_send_sap,
                dc.status,
                dc.reason,
                dc.doc_no,
                sl.address ->> 'full_address' AS "address",
                sa.address ->> 'full_address' AS "to",
                dc.truck_no,
                ewb.ewbno AS e_way_bill_no,
                ewb.distance,
                
                -- Unnested material data from delivery_challan's JSONB
                material_details.name AS materials,
                (material_details.quantity)::numeric AS quantity,
                material_details.mat_id,
                material_details."noOfBags" AS no_of_bags,
                mat.hsn_code as material_hsn,
                mat.hsn_code,
                mat.id AS material_number,

                -- Data from joined PO and Material tables for calculation
                po_material.supplier__id,
                (po_material.price)::numeric AS base_price,
                mat.hsn_code,
                (mat.cgst)::numeric AS cgst_rate,
                (mat.sgst)::numeric AS sgst_rate,
            
                dc.status,
                dc.reason
            FROM
                public.delivery_challan AS dc
            
            -- This is the key part: it expands the JSONB array into separate rows
            CROSS JOIN LATERAL jsonb_to_recordset(dc.materials::jsonb) AS material_details(id int, mat_id text, name text, quantity text, "noOfBags" text, unit_name text)
            
            -- Standard joins for related info
            LEFT JOIN source_location sl ON dc.dispatch_from_id = sl.id
            LEFT JOIN public.shipping_address AS sa ON dc.ship_to__id = sa.id
            LEFT JOIN public.ewaybill AS ewb ON dc.doc_no = ewb.doc_id
            
            -- Join to get material info like HSN code and tax rates
            -- Assumes a 'material' table exists with this data
            LEFT JOIN public.material AS mat ON (material_details.mat_id)::integer = mat.id
            
            -- Join to get the price from the original PO
            -- This sub-select is needed to find the specific material within the PO's JSONB array
            LEFT JOIN (
                SELECT 
                    p.rr_no,
                    p.supplier__id,
                    (po_mat ->> 'mat_id') AS mat_id,
                    (po_mat ->> 'price') AS price
                FROM public.po p, jsonb_array_elements(p.materials) AS po_mat
            ) AS po_material ON dc.rr_no = po_material.rr_no AND material_details.mat_id = po_material.mat_id
            
            WHERE
                -- Filter by the specified date range
                dc.created_at::date BETWEEN $1 AND $2
            
            ORDER BY
                dc.id ASC;
        `;

        const result = await query(reportQuery, [startDate, endDate]);

        // console.log(result)

        // --- FIX: Add a robust check for the result and its 'rows' property ---
        if (!result || !result || result.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No report data found for the selected date range.',
                data: []
            });
        }
        const rows = result;

        // --- 3. Process Results and Perform Calculations ---
        const reportData = rows.map(item => {
            // console.log("=========> ", item)
            const quantity = Number(item.quantity) || 0;
            const basePrice = Number(item.base_price) || 0;
            const cgstRate = Number(item.cgst_rate) || 0;
            const sgstRate = Number(item.sgst_rate) || 0;

            const taxableValue = basePrice * quantity;
            const cgstAmount = taxableValue * (cgstRate / 100);
            const sgstAmount = taxableValue * (sgstRate / 100);
            const gross = taxableValue + cgstAmount + sgstAmount;
            const totalTaxRate = cgstRate + sgstRate;
            const rateInclTax = basePrice * (1 + (totalTaxRate / 100));

            return {
                s_no: item.s_no,
                doc_date: new Date(item.doc_date).toLocaleDateString('en-GB'),
                doc_no: item.doc_no,
                supplier_id: item.supplier__id,
                is_send_sap: item.is_send_sap,
                to: item.to,
                address: item.address,
                truck_no: item.truck_no,
                materials: item.materials,
                hsn_code: item.hsn_code,
                material_number: item.material_number,
                quantity: quantity.toFixed(3),
                rate_incl_tax: rateInclTax.toFixed(2),
                tax_rate: totalTaxRate.toFixed(2),
                taxable_value: taxableValue.toFixed(2),
                cgst: cgstAmount.toFixed(2),
                sgst: sgstAmount.toFixed(2),
                gross: gross.toFixed(2),
                e_way_bill_no: item.e_way_bill_no,
                distance: item.distance,
                status: item.status == 1 ? "Active" : "Cancelled",
                reason: item?.reason || "-"
            };
        });


        // console.log(reportData)

        res.status(200).json({ success: true, data: reportData });

    } catch (error) {
        console.error('Error fetching report:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred while generating the report.',
            error: error.message
        });
    }
};


async function getDCReportById(dcId) {
    const reportQuery = `
        SELECT
            dc.id as s_no,
            dc.created_at AS doc_date,
            dc.doc_no,
            dc.token_no,
            dc.status,
            dc.reason,
            po_material.supplier__id AS supplier_id,
            s.name AS supplier_name,
            sl.address ->> 'full_address' AS "address",
            sa.address ->> 'full_address' AS "to",
            sa.sap_name AS branch_name,
            dc.truck_no,
            dc.rr_no,
            ewb.ewbno AS e_way_bill_no,
            ewb.distance,
            po_material.po_no as "po_number",
            po_material.bill_no as bill_number,
            po_material.po_date,
            po_material.rr_date,
            po_material.supplier_invoice_date,

            material_details.name AS materials,
            (material_details.quantity)::numeric AS quantity,
            material_details.mat_id,
            material_details.unit_name,
           material_details."noOfBags" AS no_of_bags,
            mat.hsn_code,
            mat.id AS material_number,
            mat.material_code,
            (po_material.price)::numeric AS base_price,
            (mat.cgst)::numeric AS cgst_rate,
            (mat.sgst)::numeric AS sgst_rate
        FROM public.delivery_challan dc
        CROSS JOIN LATERAL jsonb_to_recordset(dc.materials::jsonb)
            AS material_details(id int, mat_id text, name text, quantity text, "noOfBags" text, unit_name text)
        LEFT JOIN shipping_address sa ON dc.ship_to__id = sa.id
        LEFT JOIN source_location sl ON dc.dispatch_from_id = sl.id
        LEFT JOIN ewaybill ewb ON dc.token_no  = ewb.doc_id
        LEFT JOIN material mat ON (material_details.mat_id)::integer = mat.id
        LEFT JOIN (
            SELECT p.rr_no,
                    p.po_no, 
                    p.bill_no,
                    p.supplier__id,
                   (po_mat ->> 'mat_id') AS mat_id,
                   (po_mat ->> 'price') AS price,
                   TO_CHAR(p.po_date, 'YYYY-MM-DD') AS po_date,
                    TO_CHAR(p.rr_date, 'YYYY-MM-DD') AS rr_date,
                    TO_CHAR(p.supplier_invoice_date, 'YYYY-MM-DD') AS supplier_invoice_date

            FROM po p, jsonb_array_elements(p.materials) AS po_mat
        ) AS po_material
            ON dc.rr_no = po_material.rr_no 
           AND material_details.mat_id = po_material.mat_id
        LEFT JOIN supplier s
            ON po_material.supplier__id = s.id
        WHERE dc.id = $1
        ORDER BY dc.id ASC
    `;

    const rows = await query(reportQuery, [dcId]);
    return rows;
}


exports.sendDataToSap = async (req, res) => {
    try {
        const { dcId } = req.params;

        if (!dcId) {
            return res.status(400).json({ status: false, message: "dcId is required" });
        }

        const dcRows = await getDCReportById(dcId);

        if (!dcRows.length) {
            return res.status(404).json({ status: false, message: "No DC rows found for SAP upload" });
        }

        const rowErrors = [];

        for (const row of dcRows) {
            const sapPayload = convertToSAP(row);

            const qsString = qs.stringify(
                { "sap-client": "500", ...sapPayload },
                { encode: true }
            );

            const finalUrl = `${SAP_BASE_URL}?${qsString}`;

            console.log("SAP Request URL >>>>>>> ", finalUrl);

            try {
                const response = await axios.post(finalUrl, null, {
                    auth: { username: SAP_USERNAME, password: SAP_PASSWORD },
                    headers: { Accept: "application/json" }
                });
                console.log("SAP RESPONSE [status:", response.status, "]:", response.data);
            } catch (rowErr) {
                const status = rowErr.response?.status;
                const contentType = rowErr.response?.headers?.["content-type"] || "";
                const rawData = rowErr.response?.data;

                // If SAP returns HTML, extract just the first 500 chars for readability
                const sapErrorBody = typeof rawData === "string" && rawData.trim().startsWith("<")
                    ? rawData.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)
                    : rawData;

                console.error(
                    `SAP Row Error [DC ${dcId}, mat: ${row.material_number}] HTTP ${status}:`,
                    sapErrorBody || rowErr.message
                );

                rowErrors.push({
                    material: row.material_number,
                    httpStatus: status,
                    sapMessage: sapErrorBody || rowErr.message
                });
            }
        }

        if (rowErrors.length === dcRows.length) {
            // ALL rows failed — don't mark as sent
            return res.status(500).json({
                status: false,
                message: "SAP upload failed for all rows",
                errors: rowErrors
            });
        }

        // At least some rows succeeded — mark DC as sent
        await query(
            `UPDATE delivery_challan SET is_send_sap = true WHERE id = $1`,
            [dcId]
        );

        if (rowErrors.length > 0) {
            return res.json({
                status: true,
                message: `Partially uploaded to SAP (${dcRows.length - rowErrors.length}/${dcRows.length} rows succeeded)`,
                errors: rowErrors
            });
        }

        return res.json({ status: true, message: "Uploaded to SAP" });

    } catch (err) {
        const status = err.response?.status;
        const rawData = err.response?.data;
        const sapErrorBody = typeof rawData === "string" && rawData.trim().startsWith("<")
            ? rawData.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)
            : rawData;

        console.error(`SAP Upload Failed [HTTP ${status}]:`, sapErrorBody || err.message);
        return res.status(500).json({
            status: false,
            message: "SAP upload failed",
            httpStatus: status,
            sapError: sapErrorBody || err.message
        });
    }
};



exports.getSapPayload = async (req, res) => {
    try {
        const { dcId } = req.params;

        console.log("dc id :", dcId)

        const dcRows = await getDCReportById(dcId);

        console.log(dcRows)

        if (dcRows.length > 0) {
            for (const row of dcRows) {
                const sapPayload = convertToSAP(row);

                console.log("SAP PAYLOAD: +++++++++++++++==========> ", sapPayload)
                res.send({ sapPayload })
            }

        } else {
            console.log("No DC rows found for SAP upload.");
            return res.send({ error: "Erorr" })
        }

    } catch (sapErr) {
        console.error("SAP Auto-Send Failed:", sapErr.response?.data || sapErr.message);
    }
}