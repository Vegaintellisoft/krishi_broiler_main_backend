const puppeteer = require('puppeteer');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');
const qs = require('qs');
const { format, parse } = require('date-fns');

const { query } = require("../../config/db");
const broilerDataEntry = require("./sap/broilerDataEntry.json");
const { sapSubmit } = require("./sap/sapSubmitService");
const { asset, runtime } = require("../../utils/paths");
const { getChromiumPath } = require("../../services/helper");


const TABLE_NAME = "feed_transfer";

const formatFeedTransferDataToSap = (data) => {
    const { materials = [] } = data;

    const config = broilerDataEntry.feed_transfer;

    return materials.map((materialItem) => {
        const combined = {
            ...data,
            ...materialItem,
        };

        const mappedRow = {};

        config.fields.forEach(({ sap, body_key }) => {
            if (combined[body_key] !== undefined) {
                mappedRow[sap] = combined[body_key];
            } else {
                console.warn(`Missing field: ${body_key}`);
            }
        });

        return mappedRow;
    });
};


const generateFeedTransferDC = async (data) => {
    try {
        const { date, plant, plant_name, transfer_type, feed_type, vehicle_no, ift_charges, from_farmer, from_farmer_name, from_farmer_mobile, from_farmer_pincode, to_farmer, to_farmer_name, to_farmer_mobile, from_to_pincode, from_batch, to_batch, from_bird_stock, to_bird_stock, from_age, to_age, materials } = data;
        const user_id = "test"
        const countRes = await query(`SELECT COUNT(*) FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable}`);
        const count = parseInt(countRes?.[0]?.count || 0);
        const doc_no = `FT/DC/${count + 11001}`;
        const transfer_quantity = materials.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)

        const parsedDate = parse(date, 'd/M/yyyy', new Date());
        const formattedDate = format(parsedDate, 'yyyy-MM-dd');
        const TemplateformattedDate = format(parsedDate, 'dd-MM-yyyy');

        const distance = '';

        const templateData = {
            branch: plant,
            branch_name: plant_name,
            doc_no,
            date: TemplateformattedDate,
            user_id,
            from_farmer,
            from_farmer_name,
            to_farmer,
            to_farmer_name,
            from_age, to_age,
            transfer_type,
            vehicle_no,
            transfer_quantity,
            from_mobile: from_farmer_mobile,
            to_mobile: to_farmer_mobile,
            distance,
            feed_type,
            freightAmt: ift_charges,
            looseKgs: "",
            totalKgs: (transfer_quantity * 50).toFixed(2),
        };

        console.log("Feed Transfer Template data : ", templateData)

        // 2. Render HTML using EJS
        const templatePath = asset('templates', 'broiler', 'feed_transfer_dc.ejs');
        const htmlContent = await ejs.renderFile(templatePath, templateData);

        // 3. Setup File Path & Directories
        const reportsDir = runtime('uploads', 'broiler', 'feed_transfer');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        const fileName = `DC_${doc_no.replace(/\//g, '-')}_${Date.now()}.pdf`;
        const filePath = path.join(reportsDir, fileName);
        // SERVER_URL should be in your .env (e.g., http://localhost:8001)
        const publicUrl = `${process.env.SERVER_URL}/uploads/broiler/feed_transfer/${fileName}`;

        // 4. Puppeteer PDF Generation
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            executablePath: getChromiumPath(),
        });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

        await page.pdf({
            path: filePath, // Saves to disk
            format: 'A4',
            printBackground: true,
            margin: { top: '30px', bottom: '30px', left: '30px', right: '30px' },
        });
        await browser.close();

        // 5. Save to Database
        const insertQuery = `
            INSERT INTO broiler.feed_transfer_dc (
            date, plant, transfer_type, vehicle_no, ift_charges, from_farmer, to_farmer, 
            from_batch, to_batch, from_bird_stock, to_bird_stock, from_age, to_age, 
            materials, user_id, pdf_url, doc_no
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `;

        const values = [
            formattedDate, plant, transfer_type, vehicle_no, ift_charges, from_farmer, to_farmer,
            from_batch, to_batch, from_bird_stock, to_bird_stock, from_age, to_age,
            JSON.stringify(materials), user_id, publicUrl, doc_no
        ]

        const dbResult = await query(insertQuery, values);

        // 6. Response
        return {
            status: true,
            message: 'feed transfer DC generated and saved!',
            dc_no: doc_no,
            pdfLink: publicUrl,
            data: dbResult
        };

    } catch (error) {
        console.error('feed transfer DC Error:', error);
        return {
            status: false,
            message: 'Failed to generate feed transfer DC.',
            error: error.message
        };
    }
};

exports.create = async (req, res) => {
    try {
        const { date, ...rest } = req.body;

        // console.log("Req.body : ", req.body)

        let formattedDate = date;
        if (date) {
            const parsedDate = parse(date, 'd/M/yyyy', new Date());
            formattedDate = format(parsedDate, 'dd/MM/yyyy');
        }

        const updatedData = {
            ...rest,
            date: formattedDate,
            indType: "FT"
        };

        // Function to convert camelCase to snake_case
        const toSnakeCase = (str) => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

        // Convert all keys
        const snakeCaseObj = Object.fromEntries(
            Object.entries(updatedData).map(([key, value]) => [toSnakeCase(key), value])
        );

        const sapDataRows = formatFeedTransferDataToSap(snakeCaseObj);
        console.log(updatedData)
        console.log(sapDataRows)

        const response = await sapSubmit(TABLE_NAME, sapDataRows);
        // console.log("controller response : ", response)

        if (!response.status) {
            return res.status(500).json({
                status: false,
                message: "SAP upload error",
                error: response?.data
            });
        }

        const dcReport = await generateFeedTransferDC(snakeCaseObj)
        if (dcReport.status) {
            return res.status(201).json({
                status: true,
                message: "Feed Transfer record created successfully",
                data: dcReport
            });
        }

        return res.status(500).json(dcReport);

    } catch (error) {
        console.error("Error creating feed transfer record:", error);
        res.status(500).json({
            status: false,
            message: "Error creating feed transfer record",
            error: error.message
        });
    }
};

exports.getAll = async (req, res) => {
    try {
        const result = await query(`SELECT * FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} ORDER BY created_at DESC`);

        if (result.length === 0) {
            return res.status(200).json({ status: true, message: "The feed transfer list is empty", data: [] });
        }

        res.status(200).json({ status: true, data: result });
    } catch (error) {
        console.error("Error fetching feed transfer records:", error);
        res.status(500).json({ status: false, message: "Error fetching feed transfer records", error: error.message });
    }
};

exports.getOne = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(`SELECT * FROM "${TABLE_NAME}" WHERE id = $1`, [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Feed transfer record with ID ${id} not found` });
        }

        res.status(200).json({ status: true, data: result[0] });

    } catch (error) {
        console.error("Error fetching single feed transfer record:", error);
        res.status(500).json({ status: false, message: "Error fetching feed transfer record", error: error.message });
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
            return res.status(404).json({ status: false, message: `Feed transfer record with ID ${id} not found for update` });
        }

        res.status(200).json({
            status: true,
            message: "Feed transfer record updated successfully",
            data: result[0]
        });

    } catch (error) {
        console.error("Error updating feed transfer record:", error);
        res.status(500).json({
            status: false,
            message: "Error updating feed transfer record",
            error: error.message
        });
    }
};

exports.remove = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(`DELETE FROM "${TABLE_NAME}" WHERE id = $1 RETURNING id`, [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Feed transfer record with ID ${id} not found for deletion` });
        }

        res.status(200).json({ status: true, message: `Feed transfer record with ID ${id} deleted successfully` });

    } catch (error) {
        console.error("Error deleting feed transfer record:", error);
        res.status(500).json({ status: false, message: "Error deleting feed transfer record", error: error.message });
    }
};