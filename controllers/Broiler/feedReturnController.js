const { format, parse } = require('date-fns');

const { query } = require("../../config/db"); 
const broilerDataEntry = require("./sap/broilerDataEntry.json");
const {sapSubmit} = require("./sap/sapSubmitService");

const TABLE_NAME = "feed_return"; 


exports.create = async (req, res) => {
    try {
            const { date, ...rest } = req.body;
    
            let formattedDate = date;
            if (date) {
                const parsedDate = parse(date, 'd/M/yyyy', new Date());
                formattedDate = format(parsedDate, 'dd/MM/yyyy');
            }
    
            const updatedData = {
                ...rest,
                date: formattedDate,
                indType: "RT"
            };
            
           // Function to convert camelCase to snake_case
            const toSnakeCase = (str) => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    
            // Convert all keys
            const snakeCaseObj = Object.fromEntries(
                Object.entries(updatedData).map(([key, value]) => [toSnakeCase(key), value])
            );
    
            const response = await sapSubmit(TABLE_NAME, snakeCaseObj);
            // console.log("controller response : ", response)
    
            if(!response.status) {
                return res.status(500).json({
                    status: false,
                    message: "SAP upload error",
                    error: response?.data
                });
            }
    
            const { plant, farmer, batch, birdStock, material ,quantity } = req.body;
            const user_id = "test"
    
             const insertQuery = `
                INSERT INTO broiler.${broilerDataEntry[TABLE_NAME].pgTable} (
                date ,plant, farmer, batch, bird_stock, material, quantity, user_id) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *;
            `;
    
            const values = [
                formattedDate, plant, farmer, batch, birdStock, material ,quantity, user_id
            ]
    
            const dbResult = await query(insertQuery, values);
    
            return res.status(201).json({
                status: true,
                message: "Feed Return record created successfully",
                data: dbResult
            });
    
            // return res.status(500).json(dbResult);
    
        } catch (error) {
        console.error("Error creating feed return record:", error);
        res.status(500).json({ 
            status: false, 
            message: "Error creating feed return record", 
            error: error.message 
        });
    }
};

exports.getAll = async (req, res) => {
    try {
        const result = await query(`SELECT * FROM "${TABLE_NAME}" ORDER BY created_at DESC`); 

        if (result.length === 0) {
            return res.status(200).json({ status: true, message: "The feed return list is empty", data: [] });
        }

        res.status(200).json({ status: true, data: result });
    } catch (error) {
        console.error("Error fetching feed return records:", error);
        res.status(500).json({ status: false, message: "Error fetching feed return records", error: error.message });
    }
};

exports.getOne = async (req, res) => {
    try {
        const { id } = req.params; 

        const result = await query(`SELECT * FROM "${TABLE_NAME}" WHERE id = $1`, [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Feed return record with ID ${id} not found` });
        }

        res.status(200).json({ status: true, data: result[0] });

    } catch (error) {
        console.error("Error fetching single feed return record:", error);
        res.status(500).json({ status: false, message: "Error fetching feed return record", error: error.message });
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
            return res.status(404).json({ status: false, message: `Feed return record with ID ${id} not found for update` });
        }

        res.status(200).json({ 
            status: true, 
            message: "Feed return record updated successfully", 
            data: result[0] 
        });

    } catch (error) {
        console.error("Error updating feed return record:", error);
        res.status(500).json({ 
            status: false, 
            message: "Error updating feed return record", 
            error: error.message 
        });
    }
};

exports.remove = async (req, res) => {
    try {
        const { id } = req.params; 
        
        const result = await query(`DELETE FROM "${TABLE_NAME}" WHERE id = $1 RETURNING id`, [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Feed return record with ID ${id} not found for deletion` });
        }

        res.status(200).json({ status: true, message: `Feed return record with ID ${id} deleted successfully` });

    } catch (error) {
        console.error("Error deleting feed return record:", error);
        res.status(500).json({ status: false, message: "Error deleting feed return record", error: error.message });
    }
};