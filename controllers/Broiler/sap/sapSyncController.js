const axios = require("axios");
const { query } = require("../../../config/db");
const broilerConfig = require("./broilerMaster.json");
const broilerOtherConfig = require("./broilerSAP.json");

const SAP_BASE_URL = `${process.env.BROILER_SAP_BASE_URL}`;
const SAP_MASTER_BASE_URL = `${process.env.BROILER_SAP_BASE_URL}/masters`;

// Helper: Build SAP Request
const getSAPData = async (endpoint, type) => {
    const config = {
        method: 'get',
        url: `${type=="other" ? SAP_BASE_URL : SAP_MASTER_BASE_URL}/${endpoint.toLowerCase()}?sap-client=500`,
        // headers: { 
        //     'Authorization': 'Basic dmVnYTpWZWdhQDEyMzQ=', 
        // }
        auth: {
            username: process.env.BROILER_SAP_USERNAME,
            password: process.env.BROILER_SAP_PASSWORD
        }
    };
    const response = await axios.request(config);
    return response.data;
};

// Helper: Build Dynamic SQL for Upsert
const upsertToPG = async (config, data, type) => {
    const { pgTable, primaryKey, fields } = config;
    // console.log(type)
    // console.log(fields)
    const normalizedData = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k.toLowerCase(), v])
    );

    const toCamelCase = (str) => {
        if(type !== "other") {
            return str
            .toLowerCase()
            .split('_').join('')
            // .split('_')
            // .map((part, index) =>
            // index === 0
            //     ? part
            //     : part.charAt(0).toUpperCase() + part.slice(1)
            // )
            // .join('');
        }
        return str;
    };


    const dbRecord = {};
    fields.forEach(f => {
        const sapKey = toCamelCase(f.sap);
        dbRecord[f.db] = normalizedData[sapKey] ?? null;
// console.log(sapKey)
// console.log(normalizedData)
// console.log(normalizedData[sapKey])
        // console.log(dbRecord)
    });

    dbRecord.sap_status = true;
    // Note: We don't manually set created_at here because 
    // the DB 'DEFAULT NOW()' handles it on initial insert.

    const columnNames = Object.keys(dbRecord);
    const values = Object.values(dbRecord);

    
    const placeholders = columnNames.map((_, i) => `$${i + 1}`).join(", ");

    const conflictTarget = Array.isArray(primaryKey) 
        ? `("${primaryKey.join('", "')}")` 
        : `("${primaryKey}")`;

    const pkArray = Array.isArray(primaryKey) ? primaryKey : [primaryKey];
    
    // Build the update clause for existing records
    const updateClause = columnNames
        .filter(col => !pkArray.includes(col)) 
        .map((col) => `"${col}" = EXCLUDED."${col}"`)
        .join(", ");

    const sql = `
        INSERT INTO broiler.${pgTable} ("${columnNames.join('", "')}")
        VALUES (${placeholders})
        ON CONFLICT ${conflictTarget} 
        DO UPDATE SET 
            ${updateClause},
            updated_at = NOW() 
        RETURNING *;
    `;

    return await query(sql, values);
};

const upsertBatchToPG = async (config, records, type) => {
    const { pgTable, primaryKey, fields } = config;

    const columnNames = fields.map(f => f.db);
    columnNames.push("sap_status");

    let values = [];
    let placeholders = [];
    let paramIndex = 1;

    records.forEach((record, rowIndex) => {
        const rowPlaceholders = [];

        const normalizedData = Object.fromEntries(
            Object.entries(record).map(([k, v]) => [k.toLowerCase(), v])
        );

        fields.forEach(f => {
            const value = normalizedData[f.sap.toLowerCase()] ?? null;
            values.push(value);
            rowPlaceholders.push(`$${paramIndex++}`);
        });

        values.push(true);
        rowPlaceholders.push(`$${paramIndex++}`);

        placeholders.push(`(${rowPlaceholders.join(", ")})`);
    });

    const conflictTarget = Array.isArray(primaryKey) 
        ? `("${primaryKey.join('", "')}")` 
        : `("${primaryKey}")`;

    const updateClause = columnNames
        .filter(col => col !== primaryKey)
        .map(col => `"${col}" = EXCLUDED."${col}"`)
        .join(", ");

    const sql = `
        INSERT INTO broiler.${pgTable} ("${columnNames.join('", "')}")
        VALUES ${placeholders.join(", ")}
        ON CONFLICT ${conflictTarget}
        DO UPDATE SET
            ${updateClause},
            updated_at = NOW();
    `;

    return await query(sql, values);
};


const parseChickReceipt = (sapData) => {
  const parsed = [];

  sapData.forEach((record) => {
    // If nested structure exists
    if (record.grnFarmer && Array.isArray(record.grnFarmer)) {
      record.grnFarmer.forEach((farmer) => {
        parsed.push({
          mandt: record.mandt || farmer.mandt,
          werks: farmer.werks,
          grno: farmer.grno || record.grno,
          dcno: farmer.dcno,
          lifnr: farmer.lifnr,
          name1: farmer.name1,
          zshedbat: farmer.zshedBat || farmer.zshedbat,
          zzchc: farmer.zzChc || farmer.zzchc,
          bldat: farmer.bldat || record.bldat,
          budat: farmer.budat || record.budat,
          zeile: farmer.zeile,
          mblnr: farmer.mblnr,
          mjahr: farmer.mjahr,
          ebeln: farmer.ebeln,
          ebelp: farmer.ebelp,
          rspos: farmer.rspos,
          erfmg: farmer.erfmg,
          enmng: farmer.enmng,
          mortality: farmer.mortality,
        });
      });
    } else {
      // If already flat (fallback)
      parsed.push({
        mandt: record.mandt,
        werks: record.werks,
        grno: record.grno,
        dcno: record.dcno,
        lifnr: record.lifnr,
        name1: record.name1,
        zshedbat: record.zshedbat,
        zzchc: record.zzchc,
        bldat: record.bldat,
        budat: record.budat,
        zeile: record.zeile,
        mblnr: record.mblnr,
        mjahr: record.mjahr,
        ebeln: record.ebeln,
        ebelp: record.ebelp,
        rspos: record.rspos,
        erfmg: record.erfmg,
        enmng: record.enmng,
        mortality: record.mortality,
      });
    }
  });

  return parsed;
};

// exports.syncBroilerMaster = async (req, res) => {
exports.syncSAPtoDB = async (req, res) => {
    const { entity, type } = req.body;
    const config = type=="other" ? broilerOtherConfig[entity] : broilerConfig[entity];

    const dbCheck = await query('SELECT current_database(), current_schema();');
    console.log("Connected DB:", dbCheck);


    if (!config) {
        return res.status(400).json({ status: false, message: "Invalid entity name" });
    }

    try {
        console.log(`Starting sync for: ${entity}...`);
        
        // 1. Fetch from SAP
        let sapData = await getSAPData(config.sapEndpoint, type);

        // Apply parser only for chick_receipt
        if (entity === "chick_delivery") {
            sapData = parseChickReceipt(sapData);
            console.log(sapData)
        }


        // 2. Process Records one-by-one
        // let successCount = 0;
        // for (const record of sapData) {
        //     try {
        //         await upsertToPG(config, record, type);
        //         successCount++;
        //     } catch (err) {
        //         console.error(`Error in record ${record[config.sapPrimaryKey]}:`, err.message);
        //     }
        // }

        // 2. Process Records batch
        const BATCH_SIZE = 1;
        let successCount = 0;

        for (let i = 0; i < sapData.length; i += BATCH_SIZE) {
            const batch = sapData.slice(i, i + BATCH_SIZE);
            await upsertBatchToPG(config, batch, type);
            successCount += batch.length;
        }

        res.json({
            status: true,
            message: `Sync completed for ${entity}`,
            summary: {
                totalFromSAP: sapData.length,
                successfullySynced: successCount
            }
        });

    } catch (error) {
        console.error("Sync Critical Error:", error);
        res.status(500).json({ 
            status: false, 
            message: `Failed to sync ${entity}`, 
            error: error.message 
        });
    }
};