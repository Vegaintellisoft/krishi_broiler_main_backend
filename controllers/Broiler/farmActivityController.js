function parseDateForDb(val) {
    if (!val) return null;
    const str = String(val).trim();
    if (!str) return null;
    // If format is DD/MM/YYYY or DD-MM-YYYY
    const ddmmyyyy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
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

const fs = require('fs');
const path = require('path');

const saveBase64Photos = (rawPhotos, prefix = 'photo') => {
    if (!rawPhotos) return rawPhotos;
    let photos = rawPhotos;
    if (typeof photos === 'string') {
        try { photos = JSON.parse(photos); } catch (_) { return rawPhotos; }
    }
    if (!Array.isArray(photos)) {
        if (typeof photos === 'object' && photos !== null) photos = [photos];
        else return rawPhotos;
    }

    const uploadDir = path.join(process.cwd(), 'uploads', 'broiler');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    const processed = photos.map(photo => {
        if (photo && typeof photo === 'object' && photo.base64) {
            try {
                const ext = (photo.type && photo.type.includes('png')) ? '.png' : '.jpg';
                const cleanFileName = photo.fileName ? photo.fileName.replace(/[^a-zA-Z0-9._-]/g, '_') : (prefix + '_' + Date.now() + '_' + Math.round(Math.random() * 1000000) + ext);
                const filePath = path.join(uploadDir, cleanFileName);
                const base64Data = photo.base64.replace(/^data:image\/\w+;base64,/, '');
                fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
                return {
                    ...photo,
                    fileName: cleanFileName,
                    url: '/uploads/broiler/' + cleanFileName,
                    path: '/uploads/broiler/' + cleanFileName,
                };
            } catch (err) {
                console.error('Error saving base64 photo to disk:', err.message);
                return photo;
            }
        }
        return photo;
    });

    return JSON.stringify(processed);
};

const qs = require('qs');
const { format, parse, isValid } = require('date-fns');

const { query } = require("../../config/db");

const broilerDataEntry = require("./sap/broilerDataEntry.json");
const { sapSubmit } = require("./sap/sapSubmitService");

const TABLE_NAME = "farm_activity";


const FARM_ACTIVITY_COLUMNS = [
    "date",
    "plant",
    "running_km",
    "total_farms",
    "vehicle_no",
    "start_km",
    "upload_start_km",

    "farmer",
    "in_time",
    "out_time",
    "batch",
    "age",
    "housed",
    "stock",
    "farms_maintenance",
    "litter_quality",
    "drinker_cleaning",
    "body_weight",

    "mortality",
    "upload_mortality",
    "reason",
    "treatment",
    "cum_mortality_count",
    "cum_mortality_percentage",

    "material",
    "quantity_bags",
    "stock_bags",
    "cum_feed",
    "total_feed",
    "end_km",
    "upload_end_km",

    // SAP DMC det level fields
    "dfi_act_grams",    // zzDfiag
    "feed_bag_given",   // zzFbdg
    "cum_feed_given",   // zzCumF
    "std_given",        // zzStdg
    "stock_cum_feed",   // zzScf
    "std_body_weight"   // zzSbwt
];

function normalizeTimeString(timeStr) {
    if (!timeStr) return null;
    return timeStr.replace(/\u202f|\u00a0/g, ' ').trim();
}

const parseTimeFlexible = (timeStr) => {
    const formats = [
        "h:mm a",     // 5:30 PM
        "hh:mm a",    // 05:30 PM
        "HH:mm",      // 17:30
        "HH:mm:ss"    // 17:30:00
    ];

    for (const fmt of formats) {
        const parsed = parse(timeStr, fmt, new Date());
        if (isValid(parsed)) {
            return parsed;
        }
    }

    return null;
};

// ✅ CREATE
exports.create = async (req, res) => {
    try {
        const { date, cum_feed, stock_bags, quantity_bags, total_feed, end_km, ...rest } = req.body;

        let formattedDate = date;
        if (date) {
            const parsedDate = parse(date, 'd/M/yyyy', new Date());
            formattedDate = format(parsedDate, 'yyyy-MM-dd');
        }

        const user_id = req.body.user_id || "unknown";

        const updatedData = {
            ...rest,
            cum_feed: Number(cum_feed),
            stock_bags: Number(stock_bags),
            quantity_bags: Number(quantity_bags),
            total_feed: Number(total_feed),
            end_km: Number(end_km),
            // date: formattedDate,
            // sap_status: false,
            // user_id
        };

        if (rest.in_time) {
            const cleanInTime = normalizeTimeString(rest.in_time);
            const parsedInTime = parseTimeFlexible(cleanInTime);

            if (!parsedInTime) {
                return res.status(400).json({
                    status: false,
                    message: `Invalid in_time format. Got '${rest.in_time}'`
                });
            }
            updatedData.in_time = format(parsedInTime, 'HH:mm:ss'); // PostgreSQL TIME
        }

        if (rest.out_time) {
            const cleanOutTime = normalizeTimeString(rest.out_time);
            const parsedOutTime = parseTimeFlexible(cleanOutTime);

            if (!parsedOutTime) {
                return res.status(400).json({
                    status: false,
                    message: `Invalid out_time format. Got '${rest.out_time}'`
                });
            }
            updatedData.out_time = format(parsedOutTime, 'HH:mm:ss'); // PostgreSQL TIME
        }


        updatedData.date = formattedDate;
        updatedData.sap_status = false;
        updatedData.user_id = user_id;
        if (updatedData.upload_mortality) updatedData.upload_mortality = saveBase64Photos(updatedData.upload_mortality, "mortality");
        if (updatedData.upload_start_km) updatedData.upload_start_km = saveBase64Photos(updatedData.upload_start_km, "start_km");
        if (updatedData.upload_end_km) updatedData.upload_end_km = saveBase64Photos(updatedData.upload_end_km, "end_km");

        // console.log(updatedData)
        // Handle file upload (relative path only)
        // if (req.file) {
        //     data.upload_mortality = `uploads/${req.file.filename}`;
        // }
        const columns = Object.keys(updatedData);
        const values = Object.values(updatedData);

        console.log(columns)

        const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");

        const insertQuery = `
            INSERT INTO broiler.${broilerDataEntry[TABLE_NAME].pgTable} (${columns.join(", ")})
            VALUES (${placeholders})
            ON CONFLICT (date, plant, farmer)
            DO NOTHING
            RETURNING *;
        `;


        const dbResult = await query(insertQuery, values);

        if (dbResult.length === 0) {
            return res.status(409).json({
                status: false,
                message: "Record already exists"
            });
        }

        return res.status(201).json({
            status: true,
            message: `Farm activity record saved as draft`,
            data: dbResult
        });
    } catch (error) {
        console.error("Error while creating farm activity:", error);
        res.status(500).json({
            status: false,
            message: "Error while creating farm activity",
            error: error.message,
        });
    }
};

exports.submit = async (req, res) => {
    try {
        const { date, plant, total_farms, user_id, end_km, upload_end_km, running_km } = req.body;

        // ── Format date ──
        const formattedDate = parseDateForDb(date) || parseDateForDb(new Date());

        const plantList = (plant && plant !== 'NaN' && plant !== 'all' && plant !== 'null' && plant !== 'undefined')
            ? String(plant).split(',').map(p => p.trim()).filter(Boolean)
            : [];

        // ── If end_km is supplied, update all draft records first ──
        if (end_km !== undefined && end_km !== null && end_km !== '') {
            let processedEndKmPhotos = upload_end_km;
            if (upload_end_km) {
                processedEndKmPhotos = saveBase64Photos(upload_end_km, "end_km");
            }
            let uploadEndKmStr = processedEndKmPhotos;
            if (uploadEndKmStr && typeof uploadEndKmStr !== 'string') {
                uploadEndKmStr = JSON.stringify(uploadEndKmStr);
            }

            let updateQueryText = `
                UPDATE broiler.` + broilerDataEntry[TABLE_NAME].pgTable + `
                SET end_km = $1, 
                    upload_end_km = CASE 
                        WHEN $2::jsonb IS NOT NULL AND jsonb_array_length($2::jsonb) > 0 THEN $2::jsonb 
                        ELSE upload_end_km 
                    END, 
                    running_km = $3
                WHERE date = $4 AND sap_status = false`;
            let updateParams = [Number(end_km), uploadEndKmStr || null, Number(running_km) || null, formattedDate];

            if (plantList.length === 1) {
                updateParams.push(plantList[0]);
                updateQueryText += " AND plant = $" + updateParams.length;
            } else if (plantList.length > 1) {
                updateParams.push(plantList);
                updateQueryText += " AND plant = ANY($" + updateParams.length + "::text[])";
            }

            if (user_id) {
                updateParams.push(String(user_id));
                updateQueryText += " AND user_id = $" + updateParams.length;
            }
            updateQueryText += ";";
            const updateRes = await query(updateQueryText, updateParams);

            // Fallback: If 0 rows updated with user_id, update without user_id filter for the same plant & date
            if ((!updateRes || updateRes.length === 0) && user_id) {
                let fallbackUpdateText = `
                    UPDATE broiler.` + broilerDataEntry[TABLE_NAME].pgTable + `
                    SET end_km = $1, 
                        upload_end_km = CASE 
                            WHEN $2::jsonb IS NOT NULL AND jsonb_array_length($2::jsonb) > 0 THEN $2::jsonb 
                            ELSE upload_end_km 
                        END, 
                        running_km = $3
                    WHERE date = $4 AND sap_status = false`;
                let fallbackParams = [Number(end_km), uploadEndKmStr || null, Number(running_km) || null, formattedDate];
                if (plantList.length === 1) {
                    fallbackParams.push(plantList[0]);
                    fallbackUpdateText += " AND plant = $" + fallbackParams.length;
                } else if (plantList.length > 1) {
                    fallbackParams.push(plantList);
                    fallbackUpdateText += " AND plant = ANY($" + fallbackParams.length + "::text[])";
                }
                fallbackUpdateText += ";";
                await query(fallbackUpdateText, fallbackParams);
            }
        }

        // ── Fetch draft records ──
        let fetchQuery = `
            SELECT * 
            FROM broiler.` + broilerDataEntry[TABLE_NAME].pgTable + `
            WHERE date = $1 
            AND sap_status = false`;
        const fetchParams = [formattedDate];

        if (plantList.length === 1) {
            fetchParams.push(plantList[0]);
            fetchQuery += " AND plant = $" + fetchParams.length;
        } else if (plantList.length > 1) {
            fetchParams.push(plantList);
            fetchQuery += " AND plant = ANY($" + fetchParams.length + "::text[])";
        }

        if (user_id) {
            fetchParams.push(String(user_id));
            fetchQuery += " AND user_id = $" + fetchParams.length;
        }
        fetchQuery += ";";

        let dbResult = await query(fetchQuery, fetchParams);

        // Fallback: If no records found with user_id filter, check without user_id filter
        if (dbResult.length === 0 && user_id) {
            let fallbackFetch = `
                SELECT * 
                FROM broiler.` + broilerDataEntry[TABLE_NAME].pgTable + `
                WHERE date = $1 
                AND sap_status = false`;
            const fallbackFetchParams = [formattedDate];
            if (plantList.length === 1) {
                fallbackFetchParams.push(plantList[0]);
                fallbackFetch += " AND plant = $" + fallbackFetchParams.length;
            } else if (plantList.length > 1) {
                fallbackFetchParams.push(plantList);
                fallbackFetch += " AND plant = ANY($" + fallbackFetchParams.length + "::text[])";
            }
            fallbackFetch += ";";
            dbResult = await query(fallbackFetch, fallbackFetchParams);
        }

        if (dbResult.length === 0) {
            return res.status(404).json({
                status: false,
                message: "No draft records found to submit for " + formattedDate
            });
        }

        const rows = dbResult;

        // ── Send all rows to SAP ──
        const sapPromises = rows.map(row => {
            let formattedRow = { ...row };

            if (formattedRow.date) {
                const parsedDate = new Date(formattedRow.date);
                if (!isNaN(parsedDate)) {
                    formattedRow.date = format(parsedDate, 'dd/MM/yyyy');
                }
            }

            return sapSubmit(TABLE_NAME, formattedRow);
        });

        const results = await Promise.allSettled(sapPromises);

        // ── Separate success & failed ──
        const successIds = [];
        const failed = [];

        results.forEach((result, index) => {
            const val = result.status === 'fulfilled' ? result.value : null;
            if (val && (val.status === true || val.status === 'true')) {
                successIds.push(rows[index].id);
            } else {
                const errDetail = result.reason || val?.data || val?.message || 'SAP Submission Failed';
                let cleanErr = typeof errDetail === 'string' ? errDetail : (errDetail?.message || JSON.stringify(errDetail) || 'Error');
                failed.push({
                    id: rows[index].id,
                    farmer: rows[index].farmer,
                    error: cleanErr
                });
            }
        });

        console.log("success ids : ", successIds);
        console.log("failed ids  : ", failed);

        // ── Update successful records ──
        if (successIds.length > 0) {
            const updateQuery = `
                UPDATE broiler.` + broilerDataEntry[TABLE_NAME].pgTable + `
                SET sap_status = true
                WHERE id = ANY($1::int[]);
            `;
            await query(updateQuery, [successIds]);
        }

        // ── Final response ──
        const isOverallSuccess = successIds.length > 0 || (failed.length === 0 && rows.length > 0);
        return res.status(200).json({
            status: isOverallSuccess,
            message: successIds.length > 0 ? `Successfully submitted ${successIds.length} farm activity records to SAP` : "SAP submission failed",
            success_count: successIds.length,
            failed_count: failed.length,
            failed_records: failed
        });

    } catch (error) {
        console.error("Error while submitting farm activity:", error);
        res.status(500).json({
            status: false,
            message: error.message || "Error while submitting farm activity",
            error: error.message,
        });
    }
};

exports.getEntries = async (req, res) => {
    try {
        const { date, plant, user_id } = req.query;

        if (!date) {
            return res.status(400).json({ error: "date is required" });
        }

        let formattedDate = date;
        const parsed = parse(date, 'd/M/yyyy', new Date());
        if (!isNaN(parsed)) {
            formattedDate = format(parsed, 'yyyy-MM-dd');
        }

        let sql = `SELECT * FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} WHERE date = $1`;
        const params = [formattedDate];

        if (plant && plant !== 'NaN' && plant !== 'all' && plant !== 'null' && plant !== 'undefined') {
            const plantList = String(plant).split(',').map(p => p.trim()).filter(Boolean);
            if (plantList.length === 1) {
                params.push(plantList[0]);
                sql += ` AND plant = $${params.length}`;
            } else if (plantList.length > 1) {
                params.push(plantList);
                sql += ` AND plant = ANY($${params.length}::text[])`;
            }
        }

        if (user_id) {
            params.push(String(user_id));
            sql += ` AND user_id = $${params.length}`;
        }

        sql += ` ORDER BY created_at DESC;`;

        const result = await query(sql, params);

        res.status(200).json({ status: true, data: result || [] });
    } catch (error) {
        console.error("Error while fetching farm activity:", error);
        res.status(500).json({
            status: false,
            message: "Error while fetching farm activity",
            error: error.message,
        });
    }
};


// ✅ GET ALL
exports.getAll = async (req, res) => {
    try {
        const sql = `
      SELECT * 
      FROM farm_activities 
      ORDER BY date DESC, created_at DESC
    `;
        const result = await query(sql);

        if (result.length === 0) {
            return res.status(200).json({
                status: true,
                message: "The farm activities list is empty",
                data: [],
            });
        }

        res.status(200).json({ status: true, data: result });
    } catch (error) {
        console.error("Error while fetching farm activities:", error);
        res.status(500).json({
            status: false,
            message: "Error while fetching farm activities",
            error: error.message,
        });
    }
};

// ✅ GET ONE
exports.getOne = async (req, res) => {
    try {
        const { id } = req.params;
        const sql = `SELECT * FROM farm_activities WHERE id = $1`;
        const result = await query(sql, [id]);

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: `Farm activity with ID ${id} not found`,
            });
        }

        res.status(200).json({ status: true, data: result[0] });
    } catch (error) {
        console.error("Error while fetching single farm activity:", error);
        res.status(500).json({
            status: false,
            message: "Error while fetching farm activity",
            error: error.message,
        });
    }
};

// ✅ UPDATE
exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;

        const sql = `
      UPDATE farm_activities SET
        "date" = COALESCE($1, "date"),
        "in_time" = COALESCE($2, "in_time"),
        "out_time" = COALESCE($3, "out_time"),
        "running_km" = COALESCE($4, "running_km"),
        "total_farms" = COALESCE($5, "total_farms"),
        "plant_id" = COALESCE($6, "plant_id"),
        "vehicle_number" = COALESCE($7, "vehicle_number"),
        "start_km" = COALESCE($8, "start_km"),
        "end_km" = COALESCE($9, "end_km"),
        "farm_location" = COALESCE($10, "farm_location"),
        "batch_no" = COALESCE($11, "batch_no"),
        "age" = COALESCE($12, "age"),
        "housed" = COALESCE($13, "housed"),
        "stock" = COALESCE($14, "stock"),
        "farms_maintenance" = COALESCE($15, "farms_maintenance"),
        "litter_quality" = COALESCE($16, "litter_quality"),
        "drinker_cleaning" = COALESCE($17, "drinker_cleaning"),
        "body_weight" = COALESCE($18, "body_weight"),
        "mortality" = COALESCE($19, "mortality"),
        "upload_mortality" = COALESCE($20, "upload_mortality"),
        "reason" = COALESCE($21, "reason"),
        "treatment" = COALESCE($22, "treatment"),
        "cum_mortality_count" = COALESCE($23, "cum_mortality_count"),
        "cum_mortality_percentage" = COALESCE($24, "cum_mortality_percentage"),
        "bags_quantity" = COALESCE($25, "bags_quantity"),
        "feed_master" = COALESCE($26, "feed_master"),
        "bags_stock" = COALESCE($27, "bags_stock"),
        "updated_at" = CURRENT_TIMESTAMP
      WHERE id = $28
      RETURNING *;
    `;

        const values = [
            data.date,
            data.in_time,
            data.out_time,
            data.running_km,
            data.total_farms,
            data.plant_id,
            data.vehicle_number,
            data.start_km,
            data.end_km,
            data.farm_location,
            data.batch_no,
            data.age,
            data.housed,
            data.stock,
            data.farms_maintenance,
            data.litter_quality,
            data.drinker_cleaning,
            data.body_weight,
            data.mortality,
            data.upload_mortality,
            data.reason,
            data.treatment,
            data.cum_mortality_count,
            data.cum_mortality_percentage,
            data.bags_quantity,
            data.feed_master,
            data.bags_stock,
            id
        ];

        const result = await query(sql, values);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Farm activity with ID ${id} not found for update` });
        }

        res.status(200).json({
            status: true,
            message: "Farm activity updated successfully",
            data: result[0]
        });

    } catch (error) {
        console.error("Error while updating farm activity:", error);
        res.status(500).json({
            status: false,
            message: "Error while updating farm activity",
            error: error.message
        });
    }
};


// ✅ DELETE
exports.remove = async (req, res) => {
    try {
        const { id } = req.params;
        const sql = `DELETE FROM farm_activities WHERE id = $1 RETURNING id`;
        const result = await query(sql, [id]);

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: `Farm activity with ID ${id} not found for deletion`,
            });
        }

        res.status(200).json({
            status: true,
            message: `Farm activity with ID ${id} deleted successfully`,
        });
    } catch (error) {
        console.error("Error while deleting farm activity:", error);
        res.status(500).json({
            status: false,
            message: "Error while deleting farm activity",
            error: error.message,
        });
    }
};
