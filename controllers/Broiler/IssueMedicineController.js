const puppeteer = require('puppeteer');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');
const qs = require('qs');
const { format } = require('date-fns');
const axios = require('axios');

const { query } = require("../../config/db");
const broilerDataEntry = require("./sap/broilerDataEntry.json");
const {sapSubmit} = require("./sap/sapSubmitService");
const { asset, runtime } = require("../../utils/paths");
const { getChromiumPath } = require("../../services/helper");


const TABLE_NAME = "issue_medicine";


const formatIssueMedicineDataToSap = (data) => {
  const { materials = [] } = data;

  const config = broilerDataEntry.issue_medicine;

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


const generateMedicineIssueDC = async (data) => {
    try {
        const { plant, plant_name, farmer, farmer_name, bird_stock, age, materials } = data;
        const user_id = "test"
        const countRes = await query(`SELECT COUNT(*) FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable}`);
        const count = parseInt(countRes?.[0]?.count || 0);
        const doc_no = `MED/DC/${count + 11001}`;

        const currentDate = new Date();
        const templateData = {
            branch: plant,
            branch_name: plant_name,
            farmer_name: farmer_name,
            no_of_chicks: bird_stock,
            age: age,
            date: format(currentDate, 'dd/MM/yyyy'),
            doc_no: doc_no,
            medicines: materials,
            user_id: user_id
        };

        // console.log(templateData)

        // 2. Render HTML using EJS
        const templatePath = asset('templates', 'broiler', 'issue_medicine_dc.ejs');
        const htmlContent = await ejs.renderFile(templatePath, templateData);

        // 3. Setup File Path & Directories
        const reportsDir = runtime('uploads', 'broiler', 'issue_medicine');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        const fileName = `DC_${doc_no.replace(/\//g, '-')}_${Date.now()}.pdf`;
        const filePath = path.join(reportsDir, fileName);
        // SERVER_URL should be in your .env (e.g., http://localhost:8001)
        const publicUrl = `${process.env.SERVER_URL}/uploads/broiler/issue_medicine/${fileName}`;

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

        // 5. Save to Database
        const insertQuery = `
            INSERT INTO broiler.${broilerDataEntry[TABLE_NAME].pgTable}
            (doc_no, branch, farmer_no, no_of_chicks, age, medicine_issue, user_id, pdf_url)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;

        const values = [
            doc_no,
            plant,
            farmer,
            bird_stock,
            age,
            JSON.stringify(materials),
            user_id,
            publicUrl
        ];

        const dbResult = await query(insertQuery, values);

        // 6. Response
        return {
            status: true,
            message: 'Issue Medicine DC generated and saved!',
            dc_no: doc_no,
            pdfLink: publicUrl,
            data: dbResult
        };

    } catch (error) {
        console.error('Medicine DC Error:', error);
        return {
            status: false,
            message: 'Failed to generate Medicine DC.',
            error: error.message
        };
    }
};

exports.create = async (req, res) => {
    try {
        const data = req.body;
        // {plant, farmer, farmer_name batch, bird_stock, age, materials[{id, material, material_name, issue_quantity, uom}], storage_loc}

        const updatedData = {
            ...data,
            ind_type: "MI"
        };

        // console.log("Issue medicine req body data : ", data);

        const sapDataRows = formatIssueMedicineDataToSap(updatedData);

        console.log(updatedData)
        console.log(sapDataRows)

        // let uploadCount = 0;
        // if(sapDataRows?.length>0) {
        //     const requests = sapDataRows.map((row)=> {
        //         const qsString = qs.stringify(
        //                     { "sap-client": "500", ...row },
        //                     { encode: true }
        //                 );
                
        //                 const finalUrl = `${process.env.BROILER_SAP_BASE_URL}${broilerDataEntry[TABLE_NAME].sapEndpoint}?${qsString}`;
                
        //                 console.log("final url : ", finalUrl);
                
        //                 let config = {
        //                     method: 'post',
        //                     maxBodyLength: Infinity,
        //                     url: finalUrl,
        //                     auth: {
        //                         username: process.env.BROILER_SAP_USERNAME,
        //                         password: process.env.BROILER_SAP_PASSWORD
        //                     }
        //                 };
                
        //                 return axios.request(config);
        //     })
        //     const responses = await Promise.allSettled(requests);

        //     const failed = responses.find(r => r.status === 'rejected');

        //     if (failed) {
        //     console.log("SAP ERROR:", failed.reason?.response?.data);

        //     return res.status(500).json({
        //         status: false,
        //         message: "SAP upload error",
        //         error: failed.reason?.response?.data || failed.reason.message
        //     });
        //     }

        //     responses.forEach((response)=>{
        //         // console.log("Sap Respsone : ", response);
        //         // console.log(response.status)
        //         console.log("Background SAP Response: ", response.data)
        //         // console.log(response.value.statusText)
        //         uploadCount++;
        //     })

        //     console.log("Sap uploads : ", uploadCount)
        // }

        const response = await sapSubmit(TABLE_NAME, sapDataRows);
        // console.log("controller resposne : ", response )

        if(!response.status) {
            return res.status(500).json({
                status: false,
                message: "SAP upload error",
                error: response
            });
        }


        const dcReport = await generateMedicineIssueDC(data)
        if(dcReport.status) {
            return res.status(201).json({
                status: true,
                message: "Medicine issuance record created successfully",
                data: dcReport
            });
        }

        return res.status(500).json(dcReport);


    } catch (error) {
        console.error("Error creating medicine issuance record:", error);
        res.status(500).json({
            status: false,
            message: "Error creating medicine issuance record",
            error: error.message
        });
    }
};


exports.getAll = async (req, res) => {
    try {
        const result = await query(`SELECT * FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} ORDER BY created_at DESC`);

        if (result.length === 0) {
            return res.status(200).json({ status: true, message: "The medicine issuance list is empty", data: [] });
        }

        res.status(200).json({ status: true, data: result });
    } catch (error) {
        console.error("Error fetching medicine issuance records:", error);
        res.status(500).json({ status: false, message: "Error fetching medicine issuance records", error: error.message });
    }
};


exports.getOne = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(`SELECT * FROM ${TABLE_NAME} WHERE id = $1`, [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Medicine issuance record with ID ${id} not found` });
        }

        res.status(200).json({ status: true, data: result[0] });

    } catch (error) {
        console.error("Error fetching single medicine issuance record:", error);
        res.status(500).json({ status: false, message: "Error fetching medicine issuance record", error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;

        const columns = getInsertUpdateColumns(data);
        const setClauses = columns.map((col, index) => `"${col}" = $${index + 1}`).join(', ');

        const values = columns.map(col => data[col]);
        // Add the 'id' at the end for the WHERE clause ($${values.length + 1})
        values.push(id);

        // 2. Build the SQL Query
        // The id placeholder will be the last one in the values array, which is at index values.length
        const sql = `
            UPDATE ${TABLE_NAME}
            SET ${setClauses}, "updated_at" = CURRENT_TIMESTAMP
            WHERE id = $${values.length} 
            RETURNING *; 
        `;

        // 3. Execute the Query
        const result = await query(sql, values);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Medicine issuance record with ID ${id} not found for update` });
        }

        res.status(200).json({
            status: true,
            message: "Medicine issuance record updated successfully",
            data: result[0]
        });

    } catch (error) {
        console.error("Error updating medicine issuance record:", error);
        res.status(500).json({
            status: false,
            message: "Error updating medicine issuance record",
            error: error.message
        });
    }
};


exports.remove = async (req, res) => {
    try {
        const { id } = req.params; // Get ID from URL parameter

        // DELETE Query
        const result = await query(`DELETE FROM ${TABLE_NAME} WHERE id = $1 RETURNING id`, [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Medicine issuance record with ID ${id} not found for deletion` });
        }

        res.status(200).json({ status: true, message: `Medicine issuance record with ID ${id} deleted successfully` });

    } catch (error) {
        console.error("Error deleting medicine issuance record:", error);
        res.status(500).json({ status: false, message: "Error deleting medicine issuance record", error: error.message });
    }
};



