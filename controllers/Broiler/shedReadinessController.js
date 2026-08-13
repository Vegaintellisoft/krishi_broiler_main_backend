const qs = require('qs');
const { format, parse } = require('date-fns');

const { query } = require("../../config/db");

const broilerDataEntry = require("./sap/broilerDataEntry.json");
const {sapSubmit} = require("./sap/sapSubmitService");

const TABLE_NAME = "shed_ready"; 

exports.create = async (req, res) => {
    try {
        const data = req.body;
        const {date: rawDate, ...rest} = data;

        console.log("date from user : ", rawDate)
        
        const parsedDate1 = parse(rawDate, 'd/M/yyyy', new Date());
        const sapFormatdate = format(parsedDate1, 'dd/MM/yyyy');

        const response = await sapSubmit(TABLE_NAME, {date:sapFormatdate, ...rest});
        // console.log("controller resposne : ", response )


        if(!response.status) {
            return res.status(500).json({
                status: false,
                message: "SAP upload error",
                error: response
            });
        }

        const { date, plant, farmer, batch, farm_length, farm_width, chick_house_capacity, chick_excess_housed } = data;
        const user_id = "test"
        const countRes = await query(`SELECT COUNT(*) FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable}`);
        
        const parsedDate = parse(date, 'd/M/yyyy', new Date());
        const formattedDate = format(parsedDate, 'yyyy-MM-dd');

         const insertQuery = `
            INSERT INTO broiler.${broilerDataEntry[TABLE_NAME].pgTable} (
            date, plant, farmer, batch, farm_length, farm_width, chick_house_capacity, chick_excess_housed, user_id) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (plant, farmer, batch)
            DO UPDATE SET
                date = EXCLUDED.date,
                farm_length = EXCLUDED.farm_length,
                farm_width = EXCLUDED.farm_width,
                chick_house_capacity = EXCLUDED.chick_house_capacity,
                chick_excess_housed = EXCLUDED.chick_excess_housed,
                user_id = EXCLUDED.user_id
            RETURNING *;
        `;

        const values = [
            formattedDate, plant, farmer, batch, farm_length, farm_width, chick_house_capacity, chick_excess_housed, user_id
        ]

        const dbResult = await query(insertQuery, values);

        // create only to make error already presnt!
        // ON CONFLICT (plant, farmer, batch) DO NOTHING

        // if (dbResult.rowCount === 0) {
        //     return res.status(409).json({
        //         status: false,
        //         message: "Record already exists"
        //     });
        // }

        const isUpdate = dbResult.command === 'UPDATE';

        return res.status(201).json({
            status: true,
            message: `Shed readiness record ${isUpdate ? "updated" : "created"} successfully`,
            data: dbResult
        });

    } catch (error) {
        console.error("Error creating shed readiness record:", error);
        res.status(500).json({ 
            status: false, 
            message: "Error creating shed readiness record", 
            error: error.message 
        });
    }
};

exports.getAll = async (req, res) => {
    try {
        const result = await query(`SELECT * FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} ORDER BY id DESC, created_at DESC`); 

        if (result.length === 0) {
            // Return 200 with an empty array if nothing is found (successful, but empty)
            return res.status(200).json({ status: true, message: "The shed readiness list is empty", data: [] });
        }

        res.status(200).json({ status: true, data: result });
    } catch (error) {
        console.error("Error fetching shed readiness records:", error);
        res.status(500).json({ status: false, message: "Error fetching shed readiness records", error: error.message });
    }
};

exports.getOne = async (req, res) => {
    try {
        const { id } = req.params; // Get ID from URL parameter

        const result = await query('SELECT * FROM shed_readiness WHERE id = $1', [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Shed readiness record with ID ${id} not found` });
        }

        res.status(200).json({ status: true, data: result[0] });

    } catch (error) {
        console.error("Error fetching single shed readiness record:", error);
        res.status(500).json({ status: false, message: "Error fetching shed readiness record", error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        
        // 1. Prepare SET clauses and Values
        const columns = getInsertUpdateColumns(data);
        const setClauses = columns.map((col, index) => `"${col}" = $${index + 1}`).join(', ');
        
        // Values for SET clauses, plus the 'id' at the end for the WHERE clause
        const values = columns.map(col => data[col]); 
        values.push(id); 

        // 2. Build the SQL Query
        const sql = `
            UPDATE shed_readiness
            SET ${setClauses}, "updated_at" = CURRENT_TIMESTAMP
            WHERE id = $${values.length} 
            RETURNING *; 
        `;
        
        // 3. Execute the Query
        const result = await query(sql, values);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Shed readiness record with ID ${id} not found for update` });
        }

        res.status(200).json({ 
            status: true, 
            message: "Shed readiness record updated successfully", 
            data: result[0] 
        });

    } catch (error) {
        console.error("Error updating shed readiness record:", error);
        res.status(500).json({ 
            status: false, 
            message: "Error updating shed readiness record", 
            error: error.message 
        });
    }
};

exports.remove = async (req, res) => {
    try {
        const { id } = req.params; // Get ID from URL parameter
        
        // DELETE Query
        const result = await query('DELETE FROM shed_readiness WHERE id = $1 RETURNING id', [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Shed readiness record with ID ${id} not found for deletion` });
        }

        res.status(200).json({ status: true, message: `Shed readiness record with ID ${id} deleted successfully` });

    } catch (error) {
        console.error("Error deleting shed readiness record:", error);
        res.status(500).json({ status: false, message: "Error deleting shed readiness record", error: error.message });
    }
};

// ================== sap controllers ==========================

// exports.getOneFromSap = async (req, res) => {
//     try {

//         const  {plant, farmer} = req.params;
//         const sapResp = await axios.get("${process.env.BROILER_SAP_BASE_URL}/zbroiler_shed?sap-client=500");
//         res.status(200).json({status: true, data: sapResp, message: "data fetched success"})
//     } catch (error) {
//         console.log("error occured: ", error)
//         res.status(500).json({status: false, message: "error occur while fetching data form sap"})
//     }
// }