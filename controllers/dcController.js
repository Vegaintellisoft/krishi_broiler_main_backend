const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const qs = require("qs");
const ejs = require('ejs');
const QRCode = require('qrcode');

const generateEwayQrDataUri = async (ewayData) => {
    if (!ewayData || !ewayData.e_way_bill_no) return '';
    try {
        const qrText = `${ewayData.e_way_bill_no} | ${ewayData.date || ''} | ${ewayData.valid || ''}`;
        return await QRCode.toDataURL(qrText, { width: 150, margin: 1 });
    } catch (err) {
        console.error('Error generating e-way QR code:', err);
        return '';
    }
};
const { format, startOfWeek, endOfWeek } = require('date-fns');
const { query } = require("../config/db");
const { fetchEWayBillNumber, cancelEway } = require("../services/ewayBillGeneration");
const { getStateCodeByName } = require("../services/getStateCode");
const { convertToSAP } = require('../services/sapConvert');
const { default: axios } = require('axios');
const { getChromiumPath, getKrishiLogoDataUri } = require('../services/helper');
const { asset, runtime } = require('../utils/paths');

// ---------------- SAP CONFIG -----------------
const SAP_BASE_URL = process.env.SAP_BASE_URL;
const SAP_USERNAME = process.env.SAP_USERNAME;
const SAP_PASSWORD = process.env.SAP_PASSWORD;

function formatDateString(dateStr) {
    if (!dateStr) return null;
    const [datePart, timePart, meridian] = dateStr.split(" ");
    const [day, month, year] = datePart.split("/").map(Number);
    let [hour, minute, second] = timePart.split(":").map(Number);

    if (meridian?.toLowerCase() === "pm" && hour < 12) hour += 12;
    if (meridian?.toLowerCase() === "am" && hour === 12) hour = 0;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}


exports.getAll = async (req, res) => {
    console.log("=============> : ", req.params)
    try {
        const { location_id } = req.params;

        let result;

        if (!location_id || location_id === 'null') {
            result = await query(`
                SELECT 
                    dc.*, 
                    sa.sap_code, 
                    sa.sap_name, 
                    sa.address
                FROM 
                    delivery_challan dc
                LEFT JOIN 
                    Shipping_Address sa 
                ON 
                    dc.ship_to__id = sa.id
                ORDER BY 
                    dc.created_at DESC
            `);
        } else {
            result = await query(`
                SELECT 
                    dc.*, 
                    sa.sap_code, 
                    sa.sap_name, 
                    sa.address
                FROM 
                    delivery_challan dc
                LEFT JOIN 
                    Shipping_Address sa 
                ON 
                    dc.ship_to__id = sa.id
                WHERE 
                    dc.dispatch_from_id = $1
                ORDER BY 
                    dc.created_at DESC
            `, [location_id]);
        }

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: 'No delivery challans found'
            });
        }

        res.status(200).json({ status: true, data: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: 'Error while fetching delivery challans',
            error: error.message
        });
    }
};

// exports.getAllById = async (req, res) => {
//     try {
//         const { user_id } = req.params;

//         let queryText = `
//             SELECT 
//                 dc.*, 
//                 sa.sap_code, 
//                 sa.sap_name, 
//                 sa.address
//             FROM 
//                 delivery_challan dc
//             LEFT JOIN 
//                 Shipping_Address sa 
//             ON 
//                 dc.ship_to__id = sa.id
//         `;
//         const queryParams = [];

//         if (user_id) {
//             queryText += ` WHERE dc.user_id = $1`;
//             queryParams.push(user_id);
//         }

//         queryText += ` ORDER BY dc.created_at DESC`;

//         const result = await query(queryText, queryParams);

//         if (result.length === 0) {
//             return res.status(404).json({ status: false, message: 'No delivery challans found' });
//         }

//         res.status(200).json({ status: true, data: result });
//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ status: false, message: 'Error while fetching delivery challans', error: error.message });
//     }
// };


exports.getAllById = async (req, res) => {
    try {
        const { user_id } = req.params;

        // If no user_id → return all DC
        if (!user_id) {
            const result = await query(`
                SELECT dc.*, sa.sap_code, sa.sap_name, sa.address
                FROM delivery_challan dc
                LEFT JOIN Shipping_Address sa ON dc.ship_to__id = sa.id
                ORDER BY dc.created_at DESC
            `);

            if (!result.length) {
                return res.status(404).json({ status: false, message: 'No delivery challans found' });
            }

            return res.json({ status: true, data: result });
        }

        // Check the role of the user
        const userRow = await query(
            `SELECT role FROM driver WHERE id = $1`,
            [user_id]
        );

        if (!userRow.length) {
            return res.status(404).json({ status: false, message: "User not found" });
        }

        const role = userRow[0].role;

        let queryText;
        let params = [];

        if (role === "admin") {
            // Admin → get all DC
            queryText = `
                SELECT dc.*, sa.sap_code, sa.sap_name, sa.address
                FROM delivery_challan dc
                LEFT JOIN Shipping_Address sa ON dc.ship_to__id = sa.id
                ORDER BY dc.created_at DESC
            `;
        } else {
            // User → only their own DC
            queryText = `
                SELECT dc.*, sa.sap_code, sa.sap_name, sa.address
                FROM delivery_challan dc
                LEFT JOIN Shipping_Address sa ON dc.ship_to__id = sa.id
                WHERE dc.user_id = $1
                ORDER BY dc.created_at DESC
            `;
            params = [user_id];
        }

        const result = await query(queryText, params);

        if (!result.length) {
            return res.status(404).json({ status: false, message: 'No delivery challans found' });
        }

        return res.json({ status: true, data: result });

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: false,
            message: "Error while fetching delivery challans",
            error: error.message
        });
    }
};

exports.getDashboardData = async (req, res) => {
    try {
        const { user_id } = req.params;

        if (!user_id) {
            return res.status(400).json({ status: false, message: "User ID is required" });
        }

        // 1. Check User Role
        const userRow = await query(`SELECT role FROM driver WHERE id = $1`, [user_id]);

        if (!userRow.length) {
            return res.status(404).json({ status: false, message: "User not found" });
        }

        const isAdmin = userRow[0].role === "admin";

        // 2. Prepare Date Range for Graph
        const today = new Date();
        const weekStart = startOfWeek(today, { weekStartsOn: 0 });
        const weekEnd = endOfWeek(today, { weekStartsOn: 0 });

        // ---------------------------------------------------------
        // 3. Prepare Queries
        // ---------------------------------------------------------

        // Query A: Weekly Graph Data
        let graphQueryText = `
            SELECT 
                TRIM(TO_CHAR(created_at, 'Dy')) as day, 
                COUNT(*)::int as value 
            FROM delivery_challan 
            WHERE created_at >= $1 AND created_at <= $2
        `;
        let graphParams = [weekStart, weekEnd];

        // Query B: Total All-Time Count
        let countQueryText = `SELECT COUNT(*)::int as total FROM delivery_challan`;
        let countParams = [];

        // Apply filtering if not Admin
        if (!isAdmin) {
            // Modify Graph Query
            graphQueryText += ` AND user_id = $3`;
            graphParams.push(user_id);

            // Modify Total Count Query
            countQueryText += ` WHERE user_id = $1`;
            countParams.push(user_id);
        }

        graphQueryText += ` GROUP BY day`;

        // ---------------------------------------------------------
        // 4. Execute Both Queries in Parallel
        // ---------------------------------------------------------
        const [graphResult, countResult] = await Promise.all([
            query(graphQueryText, graphParams),
            query(countQueryText, countParams)
        ]);

        // ---------------------------------------------------------
        // 5. Format Data
        // ---------------------------------------------------------

        // Format Graph Data (Fill in missing days with 0)
        const daysTemplate = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const finalGraphData = daysTemplate.map(dayName => {
            const found = graphResult.find(r => r.day === dayName);
            return {
                day: dayName,
                value: found ? found.value : 0
            };
        });

        // Get Total Count safely
        const totalDcCount = countResult.length > 0 ? countResult[0].total : 0;

        return res.json({
            status: true,
            data: {
                graphData: finalGraphData,
                totalDcCount: totalDcCount
            }
        });

    } catch (error) {
        console.error("Dashboard Data Error:", error);
        return res.status(500).json({
            status: false,
            message: "Error fetching dashboard data",
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

// exports.getTokenNo = async (req, res) => {
//     try {
//         const { rr_no } = req.query;

//         if (!rr_no) {
//             return res.status(400).json({
//                 status: false,
//                 message: "rr_no is required"
//             });
//         }

//         // 1. Fetch PO based on rr_no
//         const poResult = await query(
//             `SELECT materials FROM po WHERE rr_no = $1 LIMIT 1`,
//             [rr_no]
//         );

//         if (poResult.length === 0) {
//             return res.status(404).json({
//                 status: false,
//                 message: "PO not found for given RR No"
//             });
//         }

//         const poMaterials = poResult[0].materials;

//         if (!Array.isArray(poMaterials) || poMaterials.length === 0) {
//             return res.status(400).json({
//                 status: false,
//                 message: "PO has no materials"
//             });
//         }

//         const firstMaterial = poMaterials[0];
//         const matId = firstMaterial.mat_id;

//         if (!matId) {
//             return res.status(400).json({
//                 status: false,
//                 message: "Material ID missing in PO"
//             });
//         }

//         // 2. Get material taxable status
//         const matResult = await query(
//             `SELECT is_taxable FROM material WHERE id = $1`,
//             [matId]
//         );

//         if (matResult.length === 0) {
//             return res.status(404).json({
//                 status: false,
//                 message: "Material not found"
//             });
//         }

//         const isTaxable = matResult[0].is_taxable === true;

//         // 3. Determine sequence type
//         const type = isTaxable ? "taxable" : "non_taxable";

//         // 4. Get sequence number (NO increment)
//         const seqResult = await query(
//             `SELECT next_number FROM doc_count WHERE type = $1`,
//             [type]
//         );

//         if (seqResult.length === 0) {
//             return res.status(500).json({
//                 status: false,
//                 message: `doc_count missing type: ${type}`
//             });
//         }

//         const seq = seqResult[0].next_number.toString().padStart(5, "0");

//         // 5. Return the number
//         return res.status(200).json({
//             status: true,
//             rr_no,
//             token_no: seq
//         });


//     } catch (error) {
//         console.error("getNextDocNumberByRR Error:", error);

//         return res.status(500).json({
//             status: false,
//             message: "Internal server error",
//             error: error.message
//         });
//     }
// };


// const getNextDocNumber = async (mat_id) => {
//     if (!mat_id) throw new Error("mat_id is required");

//     const matResult = await query(
//         `SELECT is_taxable FROM material WHERE id = $1`,
//         [mat_id]
//     );

//     if (matResult.length === 0) {
//         throw new Error("Material not found in material table");
//     }

//     const isTaxable = matResult[0].is_taxable === true;

//     // 2. Determine type
//     const type = isTaxable ? "taxable" : "non_taxable";

//     // 3. Read next number from doc_count (DO NOT increment)
//     const result = await query(
//         `SELECT next_number FROM doc_count WHERE type = $1`,
//         [type]
//     );

//     if (result.length === 0) {
//         throw new Error(`doc_count missing type: ${type}`);
//     }

//     const seq = result[0].next_number.toString().padStart(5, "0");

//     return `DC/ERD-GS/${seq}`;
// };


exports.getTokenNo = async (req, res) => {
    try {
        const { rr_no, dispatchFromId } = req.query;

        if (!rr_no) {
            return res.status(400).json({
                status: false,
                message: "rr_no is required"
            });
        }

        // 1. Fetch PO based on rr_no
        const poResult = await query(
            `SELECT materials FROM po WHERE rr_no = $1 LIMIT 1`,
            [rr_no]
        );

        if (poResult.length === 0) {
            return res.status(404).json({
                status: false,
                message: "PO not found for given RR No"
            });
        }

        const poMaterials = poResult[0].materials;

        if (!Array.isArray(poMaterials) || poMaterials.length === 0) {
            return res.status(400).json({
                status: false,
                message: "PO has no materials"
            });
        }

        const firstMaterial = poMaterials[0];
        const matId = firstMaterial.mat_id;

        if (!matId) {
            return res.status(400).json({
                status: false,
                message: "Material ID missing in PO"
            });
        }

        // 2. Get material taxable status
        const matResult = await query(
            `SELECT is_taxable FROM material WHERE id = $1`,
            [matId]
        );

        if (matResult.length === 0) {
            return res.status(404).json({
                status: false,
                message: "Material not found"
            });
        }

        const isTaxable = matResult[0].is_taxable === true;

        // 3. Determine sequence type
        const type = isTaxable ? "taxable" : "non_taxable";

        const fromAddressResult = await query(
            `SELECT address FROM source_location WHERE id = $1`,
            [dispatchFromId]
        );

        const city = fromAddressResult[0]?.address?.city?.trim();
        if (!city) {
            return res.status(400).json({
                status: false,
                message: "City not found"
            });
        }

        // Ensure location row exists (NO increment)
        await query(
            `
            INSERT INTO loc_doc_count (location, next_number)
            VALUES ($1, '{"taxable": 0, "non_taxable": 0}')
            ON CONFLICT (location) DO NOTHING
            `,
            [city]
        );


        // 4. Get sequence number (NO increment)
        // const seqResult = await query(
        //     `SELECT next_number FROM doc_count WHERE type = $1`,
        //     [type]
        // );
        const seqResult = await query(
            `
            SELECT 
            COALESCE((next_number->>$2)::int, 0) + 1 AS next_seq
            FROM loc_doc_count
            WHERE location = $1
            `,
            [city, type]
        );


        if (seqResult.length === 0) {
            return res.status(500).json({
                status: false,
                message: `doc_count missing type: ${type}`
            });
        }

        // const seq = (Number(seqResult[0].next_number) + 1)
        //     .toString()
        //     .padStart(5, "0");
        const seq = (
            seqResult.length > 0 ? seqResult[0].next_seq : 1
        ).toString().padStart(5, "0");


        // 5. Return the number
        return res.status(200).json({
            status: true,
            rr_no,
            token_no: seq
        });


    } catch (error) {
        console.error("getNextDocNumberByRR Error:", error);

        return res.status(500).json({
            status: false,
            message: "Internal server error",
            error: error.message
        });
    }
};


const getNextDocNumber = async (mat_id, city) => {
    if (!mat_id) throw new Error("mat_id is required");
    if (typeof city !== "string" || city.trim() === "") {
        throw new Error("city is required");
    }

    const matResult = await query(
        `SELECT is_taxable FROM material WHERE id = $1`,
        [mat_id]
    );

    if (matResult.length === 0) {
        throw new Error("Material not found in material table");
    }

    // const isTaxable = matResult[0].is_taxable === true;
    const isTaxable = Boolean(matResult[0].is_taxable);

    // 2. Determine type
    const type = isTaxable ? "taxable" : "non_taxable";
    // 2.1 Determine Location Text
    const loc_str = city.trim().charAt(0).toUpperCase();

    console.log(type)
    console.log(loc_str)

    // 3. Read next number from doc_count (DO NOT increment)
    // const result = await query(
    //     `SELECT next_number FROM doc_count WHERE type = $1`,
    //     [type]
    // );
    const result = await query(
        `
        SELECT (next_number->>$2)::int AS current_seq
        FROM loc_doc_count
        WHERE location = $1
        `,
        [city.trim(), type]
    );


    if (result.length === 0 || result[0].current_seq === null) {
        // throw new Error(`doc_count missing type: ${type}`);
        throw new Error(`No counter found for location: ${city}`);
    }

    // const seq = (Number(result[0].next_number) + 1)
    //     .toString()
    //     .padStart(5, "0");
    const seq = (result[0].current_seq + 1)
        .toString()
        .padStart(5, "0");

    //return `DC/ERD-GS/${seq}`;

    const doc_str = isTaxable ? `DC/6/${loc_str}GT/${seq}` : `DC/6/${loc_str}GE/${seq}`;

    return doc_str;
};

// Helper function for Background SAP Sync
const triggerSAPSync = async (dcId) => {
    try {
        const dcRows = await getDCReportById(dcId);

        if (dcRows.length > 0) {
            for (const row of dcRows) {
                const sapPayload = convertToSAP(row);
                console.log("Background SAP Payload================>>>>:", sapPayload);

                const qsString = qs.stringify(
                    { "sap-client": "500", ...sapPayload },
                    { encode: true }
                );

                const finalUrl = `${process.env.SAP_BASE_URL}?${qsString}`;

                let config = {
                    method: 'post',
                    maxBodyLength: Infinity,
                    url: finalUrl,
                    headers: {
                        'Authorization': 'Basic RERJQzpLcmlzaGlQckRAMTIzNDUjQA==',
                        'Cookie': 'SAP_SESSIONID_KSP_500=-aRrLzyc7__nirnv6RaTQxae5u3KxBHwtU5PNnqbrPI%3d; sap-usercontext=sap-client=500'
                    }
                };

                const response = await axios.request(config);
                console.log("Background SAP Response:", response.data);
            }
            await query(`UPDATE delivery_challan SET is_send_sap=true WHERE id=$1`, [dcId]);
        }
    } catch (sapErr) {
        console.error("Background SAP Failed:", sapErr.message);
    }
};

const checkUserDCPermission = async (user_id) => {
    if (!user_id) return true;
    try {
        let userRow = await query(`SELECT role, category FROM public.driver WHERE id = $1`, [user_id]);
        if (userRow.length === 0) {
            userRow = await query(`SELECT role, category FROM public.admin WHERE id = $1`, [user_id]);
        }
        if (userRow.length === 0) return true;

        const { role, category } = userRow[0];
        if (!role) return true;

        if (role.trim().toLowerCase() === 'viewer') {
            return false;
        }

        const roleRes = await query(
            `SELECT permissions FROM public.user_roles WHERE LOWER(TRIM(role_name)) = LOWER(TRIM($1)) AND LOWER(TRIM(category)) = LOWER(TRIM($2))`,
            [role, category || 'Wagon']
        );

        if (roleRes.length > 0) {
            let perms = roleRes[0].permissions;
            if (typeof perms === 'string') {
                try { perms = JSON.parse(perms); } catch (_) {}
            }
            if (perms?.deliveryChallan && perms.deliveryChallan.add === false) {
                return false;
            }
        }
        return true;
    } catch (err) {
        console.error("Error checking DC permission:", err);
        return true;
    }
};

exports.addDC = async (req, res) => {

    const { rr_no, token_no, ship_to__id, dispatchFromId, truck_no, materials, pdfLink, doc_no, user_id, invoicePayload } = req.body;

    if (!rr_no || !token_no || !ship_to__id || !dispatchFromId || !truck_no || !materials) {
        return res.status(400).json({ status: false, message: 'Missing required fields' });
    }

    if (user_id) {
        const canAdd = await checkUserDCPermission(user_id);
        if (!canAdd) {
            return res.status(403).json({ status: false, message: 'Your role does not have permission to add Delivery Challan.' });
        }
    }

    // console.log("Invoice Payload: ", invoicePayload);
    // return;

    try {

        const mat_id = materials[0]?.mat_id;
        const matResult = await query(`SELECT is_taxable, e_way_bill FROM material WHERE id = $1`, [mat_id]);
        if (matResult.length === 0) throw new Error("Material not found");
        const isTaxable = matResult[0].is_taxable;
        const isEwayBillRequired = matResult[0]?.e_way_bill || false;
        const type = isTaxable ? "taxable" : "non_taxable";

        const fromAddressResult = await query('SELECT address FROM source_location WHERE id = $1', [dispatchFromId]);
        // const loc_str = fromAddressResult[0]?.address?.city.trim().charAt(0).toUpperCase() || "X";
        const city = fromAddressResult[0]?.address?.city?.trim();
        const full_from_address = fromAddressResult[0]?.address || {};
        // if (!city) throw new Error("City not found");
        const loc_str = city.charAt(0).toUpperCase() || 'X';
        const tokenPrefix = token_no.substring(0, token_no.lastIndexOf('/') + 1);

        let final_doc_no = "";
        let final_token_no = "";
        let isUnique = false;

        // --- STEP 1: UNIQUE SYNC LOOP ---
        // This loop ensures that both numbers are fresh and identical in count
        while (!isUnique) {
            const seqResult = await query(
                `
                UPDATE loc_doc_count
                SET next_number =
                    jsonb_set(
                        next_number,
                        ARRAY[$2],
                        ((next_number->>$2)::int + 1)::text::jsonb
                    )
                WHERE location = $1
                RETURNING next_number;
                `,
                [city, type]
            );

            if (seqResult.length === 0) {
                throw new Error(`Location not found in loc_doc_count: ${city}`);
            }

            const seqNumber = seqResult[0].next_number[type];
            const seqStr = seqNumber.toString().padStart(5, "0");

            final_doc_no = isTaxable ? `DC/6/${loc_str}GT/${seqStr}` : `DC/6/${loc_str}GE/${seqStr}`;
            final_token_no = `ED/6/${tokenPrefix}${seqStr}`;

            // Check if either number exists in the database
            const checkDuplicate = await query(
                `SELECT id FROM delivery_challan WHERE doc_no = $1 OR token_no = $2`,
                [final_doc_no, final_token_no]
            );

            if (checkDuplicate.length === 0) {
                isUnique = true; // Exit loop if neither exists
            } else {
                console.log(`Conflict detected for ${seqStr}. Incrementing again...`);
            }
        }


        // 5. E-WAY BILL logic (using synchronized numbers)
        if (isEwayBillRequired) {
            const updatedPayload = {
                ...invoicePayload,
                docNo: final_doc_no,
                transDocNo: final_doc_no
            };
            const { ewbNo, ewbDate, ewbValidTill, irn, distance, error } = await fetchEWayBillNumber(updatedPayload);

            if (error) {
                return res.status(500).json({ status: false, message: error });
            }

            const formattedEwbDate = formatDateString(ewbDate);
            const formattedEwbValidTill = formatDateString(ewbValidTill);

            const ewayInsertQry = `
            INSERT INTO public.ewaybill (doc_id, ewbno, ewb_date, ewb_valid_till, irn, distance)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;

            await query(ewayInsertQry, [
                final_token_no,
                ewbNo,
                formattedEwbDate,
                formattedEwbValidTill,
                irn,
                distance,
            ]);
        }


        // 1. Check invalid materials (0 qty or 0 bags)
        const invalidMaterial = materials.some(
            (m) => Number(m.quantity) === 0 || Number(m.noOfBags) === 0
        );

        if (invalidMaterial) {
            const insertQuery = `
                INSERT INTO delivery_challan 
                (rr_no, token_no, ship_to__id, truck_no, materials, dispatch_from_id, user_id, status, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                RETURNING *;
            `;
            const values = [rr_no, final_token_no, ship_to__id, truck_no, JSON.stringify(materials), dispatchFromId, user_id];
            const result = await query(insertQuery, values);

            return res.status(201).json({
                status: true,
                message: "Delivery challan added with status 3 (invalid material)",
                data: result[0]
            });
        }


        // ----- 2. UPDATE PO MATERIALS -----
        const poQuery = `SELECT materials, po_no, bill_no FROM PO WHERE rr_no = $1`;
        const poResult = await query(poQuery, [rr_no]);

        if (poResult.length === 0) {
            return res.status(404).json({ status: false, message: "PO not found." });
        }

        const poMaterials = poResult[0].materials;
        const poDetails = poResult[0];

        const updatedMaterials = poMaterials.map(material => {
            const dispatched = materials.find(d => d.mat_id.toString() === material.mat_id.toString());
            if (dispatched) {
                // FIX: Force Number() to prevent string coercion issues from JSONB or mobile payload
                const newQty = Number(material.quantity) - Number(dispatched.quantity);
                const newBags = Number(material.noOfBags) - Number(dispatched.noOfBags);
                return {
                    ...material,
                    price: Number(material.price),   // FIX: Explicitly protect original PO price (never take from mobile)
                    quantity: newQty < 0 ? 0 : Number(newQty.toFixed(3)),
                    noOfBags: newBags < 0 ? 0 : Math.round(newBags)
                };
            }
            return material;
        });

        await query(`UPDATE PO SET materials = $1 WHERE rr_no = $2`, [JSON.stringify(updatedMaterials), rr_no]);

        // FIX: Use Number() comparison so "0" (string from JSONB) === 0 works correctly
        const allZero = updatedMaterials.every(m => Number(m.quantity) === 0 && Number(m.noOfBags) === 0);
        if (allZero) {
            await query(`UPDATE PO SET status = 4 WHERE rr_no = $1`, [rr_no]);
        }


        // ----- 3. INSERT / UPDATE DC -----
        const check = await query(`SELECT * FROM delivery_challan WHERE token_no = $1`, [final_token_no]);

        let result;
        if (check.length > 0) {
            result = await query(
                `
                UPDATE delivery_challan
                SET doc_no=$1, rr_no=$2, ship_to__id=$3, truck_no=$4,
                    materials=$5, pdf_link=$6, dispatch_from_id=$7,
                    user_id=$8, status=1, updated_at=CURRENT_TIMESTAMP
                WHERE token_no=$9
                RETURNING *;
                `,
                [final_doc_no, rr_no, ship_to__id, truck_no, JSON.stringify(materials), pdfLink, dispatchFromId, user_id, final_token_no]
            );
        } else {
            result = await query(
                `
                INSERT INTO delivery_challan 
                (doc_no, rr_no, token_no, ship_to__id, truck_no, materials, pdf_link,
                 dispatch_from_id, user_id, status, created_at, updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
                RETURNING *;
                `,
                [final_doc_no, rr_no, final_token_no, ship_to__id, truck_no, JSON.stringify(materials), pdfLink, dispatchFromId, user_id]
            );
        }

        const dcData = result[0];


        // ---------------------------------------------------------
        // START PDF RE-GENERATION (With E-Way Info)
        // ---------------------------------------------------------

        try {
            const addressQuery = 'SELECT address FROM shipping_address WHERE id = $1';
            const addressResult = await query(addressQuery, [ship_to__id]);
            const full_address = addressResult.length > 0 ? addressResult[0].address : 'N/A';

            const materialIds = poMaterials.map(m => m.mat_id);
            const materialsQuery = 'SELECT id, name, hsn_code, cgst, sgst, e_way_bill, eway_exemption_notify FROM Material WHERE id = ANY($1)';
            const materialsResult = await query(materialsQuery, [materialIds]);

            let isEwayBill = true;
            let isEwayExemption = true;

            const finalMaterials = await Promise.all(materials.map(async (dispatchedMaterial) => {
                const { mat_id, quantity, noOfBags } = dispatchedMaterial;
                const poMaterial = poMaterials.find(m => m.mat_id.toString() === mat_id.toString());
                const materialInfo = materialsResult.find(m => m.id.toString() === mat_id.toString());

                if (!poMaterial || !materialInfo) return null;

                const orgPrice = poMaterial.price;
                const { hsn_code, cgst, sgst, e_way_bill, eway_exemption_notify } = materialInfo;

                if (e_way_bill == false) isEwayBill = false;
                if (eway_exemption_notify == false) isEwayExemption = false;

                const basic = Number((orgPrice * quantity).toFixed(2));
                const cgstAmount = Number((basic * (cgst / 100)).toFixed(2));
                const sgstAmount = Number((basic * (sgst / 100)).toFixed(2));
                const totalTaxPercent = Number(((cgst + sgst) / 100).toFixed(2));
                const price = Number((orgPrice + (orgPrice * totalTaxPercent)).toFixed(2));
                const total = Number((basic + cgstAmount + sgstAmount).toFixed(2));

                return {
                    ...dispatchedMaterial,
                    name: materialInfo.name,
                    hsn_code, cgst, sgst,
                    price: price,
                    noOfBags: parseInt(noOfBags, 10),
                    basic: basic,
                    cgstAmount: cgstAmount,
                    sgstAmount: sgstAmount,
                    total: total,
                };
            }));

            const ewayFetchQry = `SELECT * FROM public.ewaybill WHERE doc_id = $1 ORDER BY created_at DESC LIMIT 1;`;
            const ewayRes = await query(ewayFetchQry, [final_token_no]);

            const formatDateTime = (date) => {
                if (!date) return '';
                const pad = num => num.toString().padStart(2, '0');
                return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ` +
                    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
            };

            const e_way_data = {
                e_way_bill_no: ewayRes[0]?.ewbno || '',
                type: 'Inward - For Own Use',
                date: ewayRes[0]?.ewb_date ? formatDateTime(new Date(ewayRes[0].ewb_date)) : '',
                valid: ewayRes[0]?.ewb_valid_till ? formatDateTime(new Date(ewayRes[0].ewb_valid_till)) : '',
                transaction_type: 'regular'
            };

            const qr_code_data_uri = await generateEwayQrDataUri(e_way_data);
            e_way_data.qr_code_data_uri = qr_code_data_uri;

            const templateData = {
                rr_no: rr_no,
                token_no: final_token_no,
                ship_to__id: ship_to__id,
                full_address,
                full_from_address: full_from_address.address || full_from_address,
                truck_no: truck_no,
                materials: finalMaterials.filter(m => m !== null),
                po_no: poDetails.po_no,
                bill_no: poDetails.bill_no,
                doc_no: final_doc_no,
                created_at: dcData.created_at,
                updated_at: dcData.updated_at,
                status: 'Active',
                e_way_data,
                qr_code_data_uri,
                isEwayBill,
                isEwayExemption,
                viewMode: false, logo_data_uri: getKrishiLogoDataUri()
            };

            const htmlTemplatePath = asset('templates', 'dc-challan.ejs');
            const htmlContent = await ejs.renderFile(htmlTemplatePath, templateData);
            const reportsDir = runtime('challans');
            if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

            const fileName = `${final_doc_no.split('/')[2]}.pdf`;
            const filePath = path.join(reportsDir, fileName);
            const finalPdfUrl = `${process.env.SERVER_URL}/challans/${fileName}`;

            const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ],
            executablePath: getChromiumPath(),
        });
            const page = await browser.newPage();
            await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.pdf({
                path: filePath,
                format: 'A4',
                printBackground: true,
                margin: { top: '40px', bottom: '40px', left: '40px', right: '40px' },
            });
            await browser.close();

            await query(`UPDATE delivery_challan SET pdf_link=$1 WHERE id=$2`, [finalPdfUrl, dcData.id]);

            dcData.pdf_link = finalPdfUrl; // Update object for response

        } catch (pdfError) {
            console.error("PDF Regeneration failed in addDC:", pdfError);
            // We continue even if PDF fails, as DC is created
        }



        // ---------------------------------------------------------
        // ASYNC SAP PUSH (Fire and Forget)
        // ---------------------------------------------------------

        triggerSAPSync(dcData.id);


        // =====================================================================
        //                           FINAL RESPONSE
        // =====================================================================
        return res.status(201).json({
            status: true,
            message: check.length > 0 ? "Delivery challan updated" : "Delivery challan created",
            data: dcData,
            pdfLink: dcData.pdf_link
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: false,
            message: "Error while adding delivery challan",
            error: error.message
        });
    }
};

exports.generateChallanPDFByData = async (req, res) => {
    try {
        const { dcData } = req.body;

        const userIdToCheck = req.body.user_id || dcData?.user_id;
        if (userIdToCheck) {
            const canAdd = await checkUserDCPermission(userIdToCheck);
            if (!canAdd) {
                return res.status(403).json({ status: false, message: 'Your role does not have permission to add Delivery Challan.' });
            }
        }

        // console.log(dcData);
        // return;

        const addressQuery = 'SELECT address FROM shipping_address WHERE id = $1';
        const addressResult = await query(addressQuery, [dcData.ship_to__id]);
        const full_address = addressResult.length > 0 ? addressResult[0].address : 'N/A';

        // get From Location
        const fromAddressQuery = 'SELECT address FROM source_location WHERE id = $1';
        const fromAddressResult = await query(fromAddressQuery, [dcData.dispatchFromId]);
        const full_from_address = fromAddressResult.length > 0 ? fromAddressResult[0].address : 'N/A';

        // Generate the New Doc Number
        const doc_no = await getNextDocNumber(dcData.materials[0].mat_id, full_from_address?.city);

        // console.log(doc_no);
        // return;

        // Fetch PO details including materials JSONB
        const poQuery = 'SELECT po_no, bill_no, materials FROM PO WHERE rr_no = $1';
        const poResult = await query(poQuery, [dcData.rr_no]);
        if (poResult.length === 0) {
            return res.status(404).json({ status: false, message: 'PO not found.' });
        }

        const poDetails = poResult[0];
        const poMaterials = poDetails.materials || [];

        // Collect all material ids from PO materials
        const materialIds = poMaterials.map(m => m.mat_id);
        const materialsQuery = 'SELECT id, name, hsn_code, cgst, sgst, e_way_bill, eway_exemption_notify FROM Material WHERE id = ANY($1)';
        const materialsResult = await query(materialsQuery, [materialIds]);

        let isEwayBill = true;
        let isEwayExemption = true;
        let total_price = 0;

        const finalMaterials = await Promise.all(dcData.materials.map(async (dispatchedMaterial) => {
            const { mat_id, quantity, noOfBags, unit_name } = dispatchedMaterial;

            // console.log(dispatchedMaterial)

            const poMaterial = poMaterials.find(m => m.mat_id.toString() === mat_id.toString());
            const materialInfo = materialsResult.find(m => m.id.toString() === mat_id.toString());

            if (!poMaterial || !materialInfo) return null;

            const orgPrice = poMaterial.price;
            const { hsn_code, cgst, sgst, e_way_bill, eway_exemption_notify } = materialInfo;

            // console.log("jjjjjjjjjjj----------> :", materialInfo)

            if (e_way_bill == false) {
                isEwayBill = false;
            };

            if (eway_exemption_notify == false) {
                isEwayExemption = false;
            };

            // const noOfBags = (quantity * 1000) / 55;

            const basic = Number((orgPrice * quantity).toFixed(2));
            const cgstAmount = Number((basic * (cgst / 100)).toFixed(2));
            const sgstAmount = Number((basic * (sgst / 100)).toFixed(2));
            const totalTaxPercent = Number(((cgst + sgst) / 100).toFixed(2));
            const price = Number((orgPrice + (orgPrice * totalTaxPercent)).toFixed(2));
            const total = Number((basic + cgstAmount + sgstAmount).toFixed(2));

            total_price = total.toFixed(2);

            const uqcMap = {
                mt: "MTS",
                kg: "KGS"
            };

            const valid_unit_name = uqcMap[unit_name.toLowerCase()] || unit_name.toUpperCase();

            return {
                ...dispatchedMaterial,
                name: materialInfo.name,
                hsn_code,
                cgst,
                sgst,
                e_way_bill,
                price,
                unit_name: valid_unit_name,
                noOfBags: parseInt(noOfBags, 10),
                basic: basic,
                cgstAmount: cgstAmount,
                sgstAmount: sgstAmount,
                total: total,
            };
        }));

        const currentDate = new Date();

        let e_way_data = {}
        let invoicePayload = {}

        // console.log("is eway bill: ------------> ", isEwayBill)

        if (isEwayBill) {

            const cleanFromGstin = (full_from_address.gst_in || '').trim();
            const cleanToGstin = (full_address.gst_in || '').trim();
            const cleanToCity = (full_address.city || '').replace(/,/g, '').trim();
            const cleanFromCity = (full_from_address.city || '').replace(/,/g, '').trim();

            invoicePayload = {
                "supplyType": "I", "subSupplyType": "5", "subSupplyDesc": "For Own Use", "docType": "CHL",
                "docNo": doc_no,
                "docDate": format(new Date(), 'dd/MM/yyyy'),
                "fromGstin": cleanFromGstin,
                "fromTrdName": (full_from_address.company || '').trim(),
                "fromAddr1": `${full_from_address.company || ''}, ${full_from_address.street || ''}`.trim().replace(/^,\s*/, ''),
                "fromAddr2": `${cleanFromCity}, ${full_from_address.state || ''}, ${full_from_address.pincode || ''}`.trim().replace(/^,\s*/, ''),
                "fromPlace": (full_from_address.state || '').trim(),
                "fromPincode": parseInt((full_from_address.pincode || '').toString().trim(), 10),
                "actFromStateCode": getStateCodeByName(full_from_address.state),
                "fromStateCode": getStateCodeByName(full_from_address.state),
                "toGstin": cleanToGstin,
                "toTrdName": (full_from_address.company || full_address.company || '').trim(),
                "toAddr1": `${full_address.company || ''}, ${full_address.door_no || ''}`.trim().replace(/^,\s*/, ''),
                "toAddr2": `${full_address.street || ''}, ${cleanToCity}, ${full_address.state || ''}, ${full_address.pincode || ''}`.trim().replace(/^,\s*/, ''),
                "toPlace": cleanToCity,
                "toPincode": parseInt((full_address.pincode || '').toString().trim(), 10),
                "actToStateCode": getStateCodeByName(full_address.state),
                "toStateCode": getStateCodeByName(full_address.state),
                "transactionType": 1,
                "otherValue": (Math.round(Number(total_price)) - Number(total_price)).toFixed(2),
                "totalValue": Number(finalMaterials[0].basic),
                "cgstValue": parseFloat(finalMaterials[0].cgstAmount),
                "sgstValue": parseFloat(finalMaterials[0].sgstAmount),
                "igstValue": 0,
                "cessValue": 0,
                "cessNonAdvolValue": 0,
                "totInvValue": Math.round(Number(total_price)),
                "transporterId": "",
                "transporterName": "",
                "transDocNo": `${doc_no}`,
                "transMode": "1",
                "transDistance": parseInt(dcData.distance) || 0,
                "transDocDate": format(new Date(), 'dd/MM/yyyy'),
                "vehicleNo": (dcData.truck_no || '').trim(),
                "vehicleType": "R",

                ItemList: finalMaterials.map(item => ({

                    productName: item.name,
                    productDesc: item.name,
                    hsnCode: item.hsn_code,
                    quantity: parseFloat(item.quantity),
                    qtyUnit: item.unit_name,
                    taxableAmount: parseFloat(item.basic),
                    sgstRate: parseFloat(item.sgst),
                    cgstRate: parseFloat(item.cgst),
                    igstRate: 0,
                    cessRate: 0,
                    cessNonAdvol: 0
                }))
            }

        }

        const templateData = {
            rr_no: dcData.rr_no,
            token_no: dcData.token_no,
            ship_to__id: dcData.ship_to__id,
            full_address,
            full_from_address,
            truck_no: dcData.truck_no,
            materials: finalMaterials.filter(m => m !== null),
            po_no: poDetails.po_no,
            bill_no: poDetails.bill_no,
            doc_no: doc_no,
            created_at: currentDate,
            updated_at: currentDate.toLocaleDateString(),
            status: dcData.status === 1 ? 'Approved' : 'Pending',
            e_way_data,
            isEwayBill,
            isEwayExemption,
            viewMode: true
        };

        // console.log(templateData)

        const htmlTemplatePath = asset('templates', 'dc-challan.ejs');
        const htmlContent = await ejs.renderFile(htmlTemplatePath, templateData);

        const reportsDir = runtime('challans');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir);
        }

        const safeDocPart = String(doc_no || "UNKNOWN").split('/')[2] || "NA";
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        const fileName = `${safeDocPart}_${timestamp}.pdf`;
        const filePath = path.join(reportsDir, fileName);
        const ChallanUrl = `${process.env.SERVER_URL}/challans/${fileName}`;

        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ],
            executablePath: getChromiumPath(),
        });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 15000 });

        await page.pdf({
            path: filePath,
            format: 'A4',
            printBackground: true,
            margin: { top: '40px', bottom: '40px', left: '40px', right: '40px' },
        });
        await browser.close();

        return res.status(200).json({
            status: true,
            message: 'PDF generated successfully!',
            dcData: { ...dcData, invoicePayload },
            pdfLink: ChallanUrl,
            doc_no,
            templateData
        });

    } catch (error) {
        console.error('Error generating PDF from body:', error);
        return res.status(500).json({
            status: false,
            message: 'An error occurred while generating the PDF.',
            error: error.message,
        });
    }
};

exports.updateDC = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if ((status === undefined)) {
        return res.status(400).json({ status: false, message: 'Missing required fields' });
    }

    // 0-Deleted, 1-Active, 2-Cancelled, 3-Arrived

    if (![0, 1, 2, 3].includes(status)) {
        return res.status(400).json({ status: false, message: 'Invalid status. Status must be 0, 1, 2, or 3.' });
    }

    try {
        const checkQuery = 'SELECT * FROM public.delivery_challan WHERE id = $1';
        const checkResult = await query(checkQuery, [id]);

        if (checkResult.length === 0) {
            return res.status(404).json({ status: false, message: 'Delivery challan not found' });
        }

        const queryText = `
            UPDATE public.delivery_challan
            SET status = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *;
        `;
        const values = [status, id];
        const result = await query(queryText, values);

        res.status(200).json({
            status: true,
            message: 'Delivery challan updated successfully',
            data: result[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: 'Error while updating delivery challan',
            error: error.message,
        });
    }
};

exports.toggleArrivedStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if ((status === undefined)) {
        return res.status(400).json({ status: false, message: 'Missing required fields' });
    }

    try {
        const checkQuery = 'SELECT * FROM public.delivery_challan WHERE id = $1';
        const checkResult = await query(checkQuery, [id]);

        if (checkResult.length === 0) {
            return res.status(404).json({ status: false, message: 'Delivery challan not found' });
        }

        const queryText = `
            UPDATE public.delivery_challan
            SET is_arrived = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *;
        `;
        const values = [status, id];
        const result = await query(queryText, values);

        res.status(200).json({
            status: true,
            message: 'Delivery challan updated successfully',
            data: result[0],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: 'Error while updating delivery challan',
            error: error.message,
        });
    }
};


const updateDeliveryChallan = async (updateData) => {
    const { doc_no, token_no, ship_to__id, dispatchFromId, truck_no, materials, pdfLink, } = updateData;

    if (!doc_no) {
        throw new Error('doc_no is required for updating challan.');
    }

    // Build dynamic query
    const fields = [];
    const values = [];
    let index = 1;

    if (token_no) {
        fields.push(`token_no = $${index++}`);
        values.push(token_no);
    }

    if (ship_to__id) {
        fields.push(`ship_to__id = $${index++}`);
        values.push(ship_to__id);
    }

    if (dispatchFromId) {
        fields.push(`dispatch_from_id = $${index++}`);
        values.push(dispatchFromId);
    }

    if (truck_no) {
        fields.push(`truck_no = $${index++}`);
        values.push(truck_no);
    }

    if (materials) {
        fields.push(`materials = $${index++}`);
        values.push(JSON.stringify(materials));
    }

    if (pdfLink) {
        fields.push(`pdf_link = $${index++}`);
        values.push(pdfLink);
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);

    const updateQuery = `
        UPDATE delivery_challan
        SET ${fields.join(', ')}
        WHERE doc_no = $${index}
        RETURNING *;
    `;

    values.push(doc_no);

    const result = await query(updateQuery, values);

    if (result.length === 0) {
        throw new Error('Delivery Challan not found or no fields updated.');
    }

    return result[0];
};

exports.generateChallanPDFByViewData = async (req, res) => {
    try {
        const { dcData } = req.body;

        // console.log("-------------------------> DC: ", dcData);
        // return;

        const addressQuery = 'SELECT address FROM shipping_address WHERE id = $1';
        const addressResult = await query(addressQuery, [dcData.ship_to__id]);
        const full_address = addressResult.length > 0 ? addressResult[0].address : 'N/A';

        // get From Location
        const fromAddressQuery = 'SELECT address FROM source_location WHERE id = $1';
        const fromAddressResult = await query(fromAddressQuery, [dcData.dispatch_from_id]);
        const full_from_address = fromAddressResult.length > 0 ? fromAddressResult[0].address : 'N/A';


        // Fetch PO details including materials JSONB
        const poQuery = 'SELECT po_no, bill_no, materials FROM PO WHERE rr_no = $1';
        const poResult = await query(poQuery, [dcData.rr_no]);
        if (poResult.length === 0) {
            return res.status(404).json({ status: false, message: 'PO not found.' });
        }

        const poDetails = poResult[0];
        const poMaterials = poDetails.materials || [];

        // Collect all material ids from PO materials
        const materialIds = poMaterials.map(m => m.mat_id);
        const materialsQuery = 'SELECT id, name, hsn_code, cgst, sgst, e_way_bill, eway_exemption_notify FROM Material WHERE id = ANY($1)';
        const materialsResult = await query(materialsQuery, [materialIds]);

        let isEwayBill = true;
        let isEwayExemption = true;

        const finalMaterials = await Promise.all(dcData.materials.map(async (dispatchedMaterial) => {
            const { mat_id, quantity, noOfBags } = dispatchedMaterial;

            // console.log(dispatchedMaterial)

            const poMaterial = poMaterials.find(m => m.mat_id.toString() === mat_id.toString());
            const materialInfo = materialsResult.find(m => m.id.toString() === mat_id.toString());

            if (!poMaterial || !materialInfo) return null;

            const orgPrice = poMaterial.price;
            const { hsn_code, cgst, sgst, e_way_bill, eway_exemption_notify } = materialInfo;

            // const noOfBags = (quantity * 1000) / 55;

            if (e_way_bill == false) {
                isEwayBill = false;
            };

            if (eway_exemption_notify == false) {
                isEwayExemption = false;
            };

            const basic = Number((orgPrice * quantity).toFixed(2));
            const cgstAmount = Number((basic * (cgst / 100)).toFixed(2));
            const sgstAmount = Number((basic * (sgst / 100)).toFixed(2));
            const totalTaxPercent = Number(((cgst + sgst) / 100).toFixed(2));
            const price = Number((orgPrice + (orgPrice * totalTaxPercent)).toFixed(2));
            const total = Number((basic + cgstAmount + sgstAmount).toFixed(2));

            // const price = Math.round(orgPrice + (orgPrice * totalTaxPercent))
            // const total = Math.ceil(basic + cgstAmount + sgstAmount);

            return {
                ...dispatchedMaterial,
                name: materialInfo.name,
                hsn_code,
                cgst,
                sgst,
                price: price,
                noOfBags: parseInt(noOfBags, 10),
                basic: basic,
                cgstAmount: cgstAmount,
                sgstAmount: sgstAmount,
                total: total,
            };
        }));

        const currentDate = new Date();


        const ewayFetchQry = `
            SELECT * 
            FROM public.ewaybill 
            WHERE doc_id = $1
            ORDER BY created_at DESC
            LIMIT 1;
        `;
        const ewayRes = await query(ewayFetchQry, [dcData.token_no]);

        // console.log("=============> ", ewayRes)

        function formatDateTime(date) {
            const pad = num => num.toString().padStart(2, '0');
            return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ` +
                `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        }

        // ewayRes[0]?.ewb_date = formatDateTime(new Date(ewayRes[0]?.ewb_date));
        // ewayRes[0]?.ewb_valid_till = formatDateTime(new Date(ewayRes[0]?.ewb_valid_till));

        const e_way_data = {
            e_way_bill_no: ewayRes[0]?.ewbno,
            type: 'Inward - For Own Use',
            date: formatDateTime(new Date(ewayRes[0]?.ewb_date)),
            valid: formatDateTime(new Date(ewayRes[0]?.ewb_valid_till)),
            transaction_type: 'regular'
        };

        const qr_code_data_uri = await generateEwayQrDataUri(e_way_data);
        e_way_data.qr_code_data_uri = qr_code_data_uri;

        // console.log(e_way_data)


        const templateData = {
            rr_no: dcData.rr_no,
            token_no: dcData.token_no,
            ship_to__id: dcData.ship_to__id,
            full_address,
            full_from_address,
            truck_no: dcData.truck_no,
            materials: finalMaterials.filter(m => m !== null),
            po_no: poDetails.po_no,
            bill_no: poDetails.bill_no,
            doc_no: dcData.doc_no,
            // created_at: currentDate,
            // updated_at: currentDate.toLocaleDateString(),
            created_at: dcData.created_at,
            updated_at: dcData.updated_at,
            status: dcData.status === 1 ? 'Active' : 'Cancelled',
            e_way_data,
            qr_code_data_uri,
            isEwayBill,
            isEwayExemption,
            viewMode: false, logo_data_uri: getKrishiLogoDataUri()
        };

        // console.log(templateData)

        const htmlTemplatePath = asset('templates', 'dc-challan.ejs');
        const htmlContent = await ejs.renderFile(htmlTemplatePath, templateData);

        const reportsDir = runtime('challans');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir);
        }

        const fileName = `${dcData.doc_no.split('/')[2]}.pdf`;
        const filePath = path.join(reportsDir, fileName);
        const ChallanUrl = `${process.env.SERVER_URL}/challans/${fileName}`;

        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ],
            executablePath: getChromiumPath(),
        });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.pdf({
            path: filePath,
            format: 'A4',
            printBackground: true,
            margin: { top: '40px', bottom: '40px', left: '40px', right: '40px' },
        });
        await browser.close();



        return res.status(200).json({
            status: true,
            message: 'PDF generated successfully!',
            dcData: dcData,
            pdfLink: ChallanUrl,
            templateData
        });

    } catch (error) {
        console.error('Error generating PDF from body:', error);
        return res.status(500).json({
            status: false,
            message: 'An error occurred while generating the PDF.',
            error: error.message,
        });
    }
};

exports.cancelDC = async (req, res) => {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (status === undefined) {
        return res.status(400).json({ status: false, message: "Missing required fields" });
    }

    if (![0, 1, 2].includes(status)) {
        return res.status(400).json({ status: false, message: "Invalid status. Must be 0, 1, or 2." });
    }

    try {
        const checkResult = await query(
            `SELECT * FROM delivery_challan WHERE id = $1`,
            [id]
        );

        if (checkResult.length === 0) {
            return res.status(404).json({ status: false, message: "Delivery challan not found" });
        }

        if (checkResult[0].status === 2) {
            return res.status(400).json({
                status: false,
                message: "Already cancelled"
            });
        }

        // ------------------ UPDATE DC STATUS ------------------
        const updated = await query(
            `
            UPDATE delivery_challan
            SET status=$1, reason=$2, updated_at=CURRENT_TIMESTAMP
            WHERE id=$3
            RETURNING *;
            `,
            [status, reason, id]
        );

        const dcData = updated[0];


        // ======================================================
        //                     SEND CANCEL TO SAP
        // ======================================================
        try {
            const dcRows = await getDCReportById(id);

            if (dcRows.length > 0) {
                for (let row of dcRows) {
                    // override fields BEFORE conversion
                    row.status = 0;
                    row.reason = dcData.reason;

                    let sapPayload = convertToSAP(row);

                    // SPECIAL CASE — ensure cancellation logic is explicit
                    sapPayload.ZSTATUS = "Cancelled";
                    sapPayload.ZREASON = dcData.reason || "-";

                    const qsString = qs.stringify(
                        { "sap-client": "500", ...sapPayload },
                        { encode: true }
                    );

                    const finalUrl = `${SAP_BASE_URL}?${qsString}`;

                    const response = await axios.post(finalUrl, null, {
                        auth: { username: SAP_USERNAME, password: SAP_PASSWORD },
                        headers: { Accept: "application/json" }
                    });

                    console.log("SAP CANCEL SUCCESS:", response.data);
                }

                // Update DB indicating SAP was notified
                await query(`UPDATE delivery_challan SET is_send_sap = true WHERE id = $1`, [id]);
            } else {
                console.log("No DC rows found for SAP cancel.");
            }

        } catch (sapErr) {
            console.error("SAP Cancel Send Failed:", sapErr.response?.data || sapErr.message);
        }


        // ======================================================
        //              CANCEL EWAY BILL
        // ======================================================
        try {
            const tokenNo = checkResult[0].token_no;

            const ewayResult = await query(
                `SELECT ewbno FROM ewaybill WHERE doc_id = $1`,
                [tokenNo]
            );

            if (ewayResult.length > 0) {
                const ewbNo = ewayResult[0].ewbno;

                const cancelPayload = {
                    ewbNo: Number(ewbNo),
                    cancelRsnCode: 2,
                    cancelRank: dcData.reason || "Cancelled DC"
                };

                const ewayRes = await cancelEway(cancelPayload);

                console.log("EWAY CANCEL SUCCESS:", ewayRes);
            } else {
                console.log("No Eway bill found for token:", tokenNo);
            }

        } catch (ewayErr) {
            console.error("Eway cancel failed:", ewayErr.message);
        }


        // ======================================================
        //              Rollback Material Count
        // ======================================================

        const dcRow = checkResult[0];
        const dcMaterials = dcRow.materials;
        const rr_no = dcRow.rr_no;

        const poResult = await query(
            `SELECT materials, status FROM PO WHERE rr_no = $1`,
            [rr_no]
        );

        if (poResult.length === 0) {
            throw new Error("PO not found while rollback");
        }

        const poMaterials = poResult[0].materials;

        const restoredMaterials = poMaterials.map(poMat => {
            const dcMat = dcMaterials.find(
                d => d.mat_id.toString() === poMat.mat_id.toString()
            );

            if (dcMat) {
                return {
                    ...poMat,
                    quantity: Number(poMat.quantity) + Number(dcMat.quantity),
                    noOfBags: Number(poMat.noOfBags) + Number(dcMat.noOfBags)
                };
            }

            return poMat;
        });

        await query(
            `UPDATE PO SET materials = $1 WHERE rr_no = $2`,
            [JSON.stringify(restoredMaterials), rr_no]
        );

        // FIX: Use Number() comparison so "0" (string from JSONB) is handled correctly
        const allZero = restoredMaterials.every(
            m => Number(m.quantity) === 0 && Number(m.noOfBags) === 0
        );

        if (!allZero) {
            await query(`UPDATE PO SET status = 3 WHERE rr_no = $1`, [rr_no]);
        }



        // ======================================================
        //                   FINAL RESPONSE
        // ======================================================
        return res.status(200).json({
            status: true,
            message: "Delivery challan cancelled successfully",
            data: dcData
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: false,
            message: "Error while cancelling delivery challan",
            error: error.message
        });
    }
};


exports.updateTruckNo = async (req, res) => {
    const { id } = req.params;
    const { truck_no, truckNo, vehicle_no, vehicleNo } = req.body;

    const resolvedTruckNo = truck_no || truckNo || vehicle_no || vehicleNo;

    if (!resolvedTruckNo) {
        return res.status(400).json({ status: false, message: 'truck_no is required' });
    }

    try {
        const checkResult = await query(
            'SELECT * FROM public.delivery_challan WHERE id = $1',
            [id]
        );

        if (checkResult.length === 0) {
            return res.status(404).json({ status: false, message: 'Delivery challan not found' });
        }

        const result = await query(
            `UPDATE public.delivery_challan
             SET truck_no = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
             RETURNING *;`,
            [resolvedTruckNo, id]
        );

        return res.status(200).json({
            status: true,
            message: 'Vehicle number updated successfully',
            data: result[0],
        });
    } catch (error) {
        console.error('Error updating truck_no:', error);
        return res.status(500).json({
            status: false,
            message: 'Error updating vehicle number',
            error: error.message,
        });
    }
};


