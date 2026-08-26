const puppeteer = require('puppeteer');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');
const qs = require('qs');
const { format, parse } = require('date-fns');

const { query } = require("../../config/db");
const broilerDataEntry = require("./sap/broilerDataEntry.json");
const { asset, runtime } = require("../../utils/paths");
const { getChromiumPath } = require("../../services/helper");

const TABLE_NAME = "feed_request"; 

const generateFeedTransferDC = async (data) => {
    try {
        const { freight, mobile, vehicleNumber, requests, delivery_date } = data;
        const user_id = "test"
        const countRes = await query(`SELECT COUNT(*) FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable}`);
        const count = parseInt(countRes?.[0]?.count || 0);
        const doc_no = `FRQ/DC/${count + 11001}`;

        // For DB: PostgreSQL needs ISO format YYYY-MM-DD
        // For PDF: display-friendly DD/MM/YYYY
        const now = new Date();
        const dbDeliveryDate = format(now, 'yyyy-MM-dd'); // ISO for PostgreSQL
        const displayDeliveryDate = delivery_date
            ? delivery_date.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1') && delivery_date  // keep display as-is if provided
            : format(now, 'dd/MM/yyyy'); // fallback display

        const templateData = {
            doc_no, freight, mobile, vehicle_no: vehicleNumber, requests, delivery_date: displayDeliveryDate
        };

        // 2. Render HTML using EJS
        const templatePath = asset('templates', 'broiler', 'feed_request_dc.ejs');
        const htmlContent = await ejs.renderFile(templatePath, templateData);

        // 3. Setup File Path & Directories
        const reportsDir = runtime('uploads', 'broiler', 'feed_request');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        const fileName = `DC_${doc_no.replace(/\//g, '-')}_${Date.now()}.pdf`;
        const filePath = path.join(reportsDir, fileName);
        // SERVER_URL should be in your .env (e.g., http://localhost:8001)
        const publicUrl = `${process.env.SERVER_URL}/uploads/broiler/feed_request/${fileName}`;

        // 4. Puppeteer PDF Generation
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--single-process', '--disable-gpu'],
            executablePath: getChromiumPath(),
        });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 15000 });

        await page.pdf({
            path: filePath, // Saves to disk
            format: 'A4',
            printBackground: true,
            margin: { top: '30px', bottom: '30px', left: '30px', right: '30px' },
        });
        await browser.close();

        // 5. Save to Database — include delivery_date column
        const insertQuery = `
            INSERT INTO broiler.${broilerDataEntry[TABLE_NAME].pgTable} (
                doc_no, freight, mobile, vehicle_no, requests, delivery_date, user_id, pdf_url
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;

        const values = [
            doc_no,
            freight,
            mobile,
            vehicleNumber,
            JSON.stringify(requests),
            dbDeliveryDate,
            user_id,
            publicUrl
        ];

        const dbResult = await query(insertQuery, values);

        // 6. Response
        return {
            status: true,
            message: 'feed request DC generated and saved!',
            dc_no: doc_no,
            pdfLink: publicUrl,
            data: dbResult
        };

    } catch (error) {
        console.error('feed request DC Error:', error);
        return {
            status: false,
            message: 'Failed to generate feed request DC.',
            error: error.message
        };
    }
};

exports.create = async (req, res) => {
    try {
        const data = req.body;
        
        const dcReport = await generateFeedTransferDC(data)

        if(dcReport.status) {
            return res.status(201).json({
                status: true,
                message: "Medicine issuance record created successfully",
                data: dcReport
            });
        }

        return res.status(500).json(dcReport);

    } catch (error) {
        console.error("Error creating Feed request record:", error);
        res.status(500).json({ 
            status: false, 
            message: "Error creating Feed request record", 
            error: error.message 
        });
    }
};

exports.getAll = async (req, res) => {
    try {
        const result = await query(`SELECT * FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} ORDER BY created_at DESC`); 

        if (result.length === 0) {
            return res.status(200).json({ status: true, message: "The Feed request list is empty", data: [] });
        }

        res.status(200).json({ status: true, data: result });
    } catch (error) {
        console.error("Error fetching Feed request records:", error);
        res.status(500).json({ status: false, message: "Error fetching Feed request records", error: error.message });
    }
};

exports.getOneByDoc = async (req, res) => {
    try {
        const { doc_no } = req.query; 

        const result = await query(`SELECT * FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} WHERE doc_no = $1`, [doc_no]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Feed request record with Doc ID ${doc_no} not found` });
        }

        res.status(200).json({ status: true, data: result[0] });

    } catch (error) {
        console.error("Error fetching single Feed request record:", error);
        res.status(500).json({ status: false, message: "Error fetching Feed request record", error: error.message });
    }
};

exports.getOne = async (req, res) => {
    try {
        const { id } = req.params; 

        const result = await query(`SELECT * FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} WHERE id = $1`, [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Feed request record with ID ${id} not found` });
        }

        res.status(200).json({ status: true, data: result[0] });

    } catch (error) {
        console.error("Error fetching single Feed request record:", error);
        res.status(500).json({ status: false, message: "Error fetching Feed request record", error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const { requests, delivery_date, freight, mobile, vehicleNumber } = req.body;

        const updateFields = [];
        const values = [];
        let paramIndex = 1;

        if (requests !== undefined) {
            updateFields.push(`requests = $${paramIndex++}`);
            values.push(typeof requests === 'string' ? requests : JSON.stringify(requests));
        }
        if (delivery_date !== undefined) {
            updateFields.push(`delivery_date = $${paramIndex++}`);
            values.push(delivery_date);
        }
        if (freight !== undefined) {
            updateFields.push(`freight = $${paramIndex++}`);
            values.push(freight);
        }
        if (mobile !== undefined) {
            updateFields.push(`mobile = $${paramIndex++}`);
            values.push(mobile);
        }
        if (vehicleNumber !== undefined) {
            updateFields.push(`vehicle_no = $${paramIndex++}`);
            values.push(vehicleNumber);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ status: false, message: "No fields provided for update" });
        }

        values.push(id);

        const sql = `
            UPDATE broiler.${broilerDataEntry[TABLE_NAME].pgTable}
            SET ${updateFields.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING *;
        `;
        
        const result = await query(sql, values);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Feed request record with ID ${id} not found for update` });
        }

        res.status(200).json({ 
            status: true, 
            message: "Feed request record updated successfully", 
            data: result[0] 
        });

    } catch (error) {
        console.error("Error updating Feed request record:", error);
        res.status(500).json({ 
            status: false, 
            message: "Error updating Feed request record", 
            error: error.message 
        });
    }
};

exports.remove = async (req, res) => {
    try {
        const { id } = req.params; 
        
        const result = await query(`DELETE FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} WHERE id = $1 RETURNING id`, [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Feed request record with ID ${id} not found for deletion` });
        }

        res.status(200).json({ status: true, message: `Feed request record with ID ${id} deleted successfully` });

    } catch (error) {
        console.error("Error deleting Feed request record:", error);
        res.status(500).json({ status: false, message: "Error deleting Feed request record", error: error.message });
    }
};