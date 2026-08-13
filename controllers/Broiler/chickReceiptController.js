const qs = require('qs');
const axios = require('axios');
const { format, parse } = require('date-fns');

const { query } = require("../../config/db");

const broilerDataEntry = require("./sap/broilerDataEntry.json");
const { sapSubmit } = require("./sap/sapSubmitService");


const TABLE_NAME = "chick_receipt";
const SAP_CHICK_DELIVERY_URL = `${process.env.BROILER_SAP_BASE_URL}/chick_grn`;


exports.create = async (req, res) => {
    try {
        const data = req.body;
        const { date, ...rest } = data;
        // console.log("req body : ", data )

        const parsedDate = parse(date, 'd/M/yyyy', new Date());
        const sap_format_date = format(parsedDate, 'dd/MM/yyyy');
        const sapUploadData = { date: sap_format_date, ...rest }

        const response = await sapSubmit(TABLE_NAME, sapUploadData);
        // console.log("controller resposne : ", response )


        if (!response.status) {
            return res.status(500).json({
                status: false,
                message: "SAP upload error",
                error: response
            });
        }

        let formattedDate = date;
        if (date) {
            const parsedDate = parse(date, 'd/M/yyyy', new Date());
            formattedDate = format(parsedDate, 'yyyy-MM-dd');
        }

        // add formated datae to databse here

        const { plant, farmer, dc_no, batch, chick_house_quantity, remarks } = data;
        const user_id = "test"

        const insertQuery = `
            INSERT INTO broiler.${broilerDataEntry[TABLE_NAME].pgTable} (
            plant, farmer, dc_no, batch, chick_house_quantity, remarks, user_id) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *;
        `;

        const values = [
            plant, farmer, dc_no, batch, chick_house_quantity, remarks, user_id
        ]

        const dbResult = await query(insertQuery, values);

        return res.status(201).json({
            status: true,
            message: `Chick Receipt record created successfully`,
            data: dbResult
        });

    } catch (error) {
        console.error("Error creating chick receipt record:", error);
        res.status(500).json({
            status: false,
            message: "Error creating chick receipt record",
            error: error.message
        });
    }
};



exports.getPODetails = async (req, res) => {
    try {
        const { client, plant, farmer_supplier } = req.query;

        const sql = `
            SELECT *
            FROM broiler.chick_receipt
            WHERE client = $1
              AND plant = $2
              AND farmer_supplier = $3
              AND batch_no = (
                  SELECT MAX(batch_no)
                  FROM broiler.chick_receipt
                  WHERE client = $1
                    AND plant = $2
                    AND farmer_supplier = $3
              )
            ORDER BY id ASC;
        `;

        const dbResult = await query(sql, [client, plant, farmer_supplier]);
        if (!dbResult || dbResult.length === 0) {
            return res.status(404).json({
                status: false,
                message: "No data found"
            });
        }

        const dbData = dbResult[0];

        // ✅ Step 2: Call SAP API
        let url = `${process.env.BROILER_SAP_BASE_URL}/zdaily_mort?sap-client=500&werks=${plant}&lifnr=${farmer_supplier}`;

        let config = {
            method: "get",
            maxBodyLength: Infinity,
            url: url,
            auth: {
                username: process.env.BROILER_SAP_USERNAME,
                password: process.env.BROILER_SAP_PASSWORD
            }
        };

        console.log("SAP URL:", url);

        let sapData = {};

        try {
            const response = await axios.request(config);

            console.log(response)

            if (response.status === 200) {
                const dmcDet = response.data?.[0]?.dmcDet?.[0];

                if (dmcDet) {
                    sapData = {
                        batch: dmcDet.zshedBat,
                        age: dmcDet.zzAge,
                        stock: dmcDet.zzchkStk,
                        housed: dmcDet.zzchkHoused
                    };
                } else {
                    console.log("No dmcDet found in SAP response");
                }
            }
        } catch (sapError) {
            console.error("SAP Error:", sapError.message);
            // don't fail API if SAP fails
        }

        // ✅ Step 3: Merge DB + SAP data
        const finalData = {
            ...dbData,
            ...sapData
        };

        console.log(finalData)

        // ✅ Final response
        res.status(200).json({
            status: true,
            message: "PO details fetched successfully",
            data: finalData
        });

    } catch (error) {
        console.error("Error while fetching PO details:", error);
        res.status(500).json({
            status: false,
            message: "Error while fetching PO details",
            error: error.message
        });
    }
};

exports.getDeliveryPODetails = async (req, res) => {
    try {

        const sql = `
            SELECT *
            FROM broiler.chick_delivery
            ORDER BY id ASC;
        `;

        const result = await query(sql, []);

        res.status(200).json({
            status: true,
            message: "PO details fetched successfully",
            data: result
        });

    } catch (error) {
        console.error("Error while fetching PO details:", error);
        res.status(500).json({
            status: false,
            message: "Error while fetching PO details",
            error: error.message
        });
    }
};

exports.getDCNumbers = async (req, res) => {
    try {

        const { plant } = req.query;

        let sql = `
            SELECT DISTINCT dc_no
            FROM broiler.chick_delivery
        `;
        let params = [];

        if (plant) {
            sql += ` WHERE plant = $1`;
            params.push(plant);
        }

        const result = await query(sql, params);

        // console.log(result)

        res.status(200).json({
            status: true,
            message: "DC numbers fetched successfully",
            data: result
        });

    } catch (error) {
        console.error("Error while fetching DC number details:", error);
        res.status(500).json({
            status: false,
            message: "Error while fetching Dc number details",
            error: error.message
        });
    }
};

exports.getPOByDc = async (req, res) => {
    try {
        const { dc } = req.query;

        const sql = `
            SELECT *
            FROM broiler.chick_delivery
            WHERE dc_no = $1
            ORDER BY id ASC;
        `;

        const result = await query(sql, [dc]);

        res.status(200).json({
            status: true,
            message: "PO details fetched by DC successfully",
            data: result
        });

    } catch (error) {
        console.error("Error while fetching PO details by DC:", error);
        res.status(500).json({
            status: false,
            message: "Error while fetching PO details by DC",
            error: error.message
        });
    }
};


// direct sap fetch

const getSAPData = async (qsString) => {
    const config = {
        method: 'get',
        url: `${SAP_CHICK_DELIVERY_URL}?${qsString}`,
        auth: {
            username: process.env.BROILER_SAP_USERNAME,
            password: process.env.BROILER_SAP_PASSWORD
        }
    };
    const response = await axios.request(config);
    return response.data;
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

exports.getDCNumbersFromSAP = async (req, res) => {
    try {
        const { plant } = req.query;

        // console.log(plant)

        const qsString = qs.stringify(
            { "sap-client": "500" },
            { encode: true }
        );

        let sapData = await getSAPData(qsString);
        let parsedSapData = parseChickReceipt(sapData);
        // console.log(sapData)

        const filteredData = plant
            ? parsedSapData.filter(d => d.werks === plant)
            : parsedSapData;

        const dcNoList = filteredData.map(d => d.dcno);

        // console.log(dcNoList)

        if (dcNoList.length === 0) {
            return res.status(404).json({ status: false, message: "No dc number data found" });
        }

        return res.status(200).json({ status: true, data: dcNoList });
    } catch (error) {
        console.error("Error while fetching DC number details from SAP:", error);
        return res.status(500).json({
            status: false,
            message: "Error while fetching Dc number details from SAP",
            error: error.message
        });
    }
}

exports.getPOByDcFromSAP = async (req, res) => {
    try {
        const { dc } = req.query;

        console.log(dc)

        const qsString = qs.stringify(
            { "sap-client": "500", "dcno": dc },
            { encode: true }
        );

        let sapData = await getSAPData(qsString);
        // console.log(sapData)
        let parsedSapData = parseChickReceipt(sapData);
        // console.log(parsedSapData)


        const result = parsedSapData.map(d => ({
            client: d.mandt,
            plant: d.werks,
            dc_no: d.dcno,
            farmer: d.lifnr,
            farmer_name: d.name1,
            batch: d.zshedbat,
            chick_housed_capacity: d.zzchc,
            chick_transfer_quantity: d.erfmg,

            gr_no: d.grno,
            item_in_material_doc: d.zeile,
            no_of_material_doc: d.mblnr,
            fiscal_year: d.mjahr,
            purchase_doc_no: d.ebeln,
            item_no_of_purchase_doc: d.ebelp,
            item_no_of_reservation: d.rspos
        }))

        console.log(result)

        res.status(200).json({
            status: true,
            message: "PO details fetched by DC successfully",
            data: result
        });

    } catch (error) {
        console.error("Error while fetching PO details by DC:", error);
        res.status(500).json({
            status: false,
            message: "Error while fetching PO details by DC",
            error: error.message
        });
    }
};