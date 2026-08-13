const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { query } = require("../config/db");

const JWT_SECRET = process.env.JWT_SECRET || 'jdf_6bhfn8+_aj&8Pyjhbf';

exports.register = async (req, res) => {
    try {
        const { first_name, last_name, username, password, email, role, category, status } = req.body;

        if (!first_name || !last_name || !username || !password || !email) {
            return res.status(400).json({ status: false, message: "All fields are required" });
        }
        if (!category || !role) return res.status(400).json({ status: false, message: "Please select role & category" });

        const existingUser = await query(
            `SELECT * FROM Admin WHERE (username = $1 OR email = $2) AND category = $3`,
            [username, email, category]
        );

        if (existingUser.length > 0) {
            return res.status(409).json({
                status: false,
                message: `Username or email already in use in ${category} category`
            });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const result = await query(
            `INSERT INTO Admin (first_name, last_name, username, password, email, role, category, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7,$8, NOW(), NOW())
             RETURNING id, first_name, last_name, username, email, role, category, status`,
            [first_name, last_name, username, hashedPassword, email, role, category, status]
        );

        const user = result[0];

        const token = jwt.sign(
            { id: user.id, username: user.username, role: role, category: category },
            JWT_SECRET,
            { expiresIn: "1d" }
        );

        res.status(201).json({
            status: true,
            message: "Admin registered successfully",
            user,
            token
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: "Error while registering a admin", error: error.message });
    }
};


exports.login = async (req, res) => {
    try {
        const { username, password, category } = req.body;

        if (!username || !password || !category) {
            return res.status(400).json({
                status: false,
                message: "Username, password, and category are required"
            });
        }

        // ✅ Category-based user lookup
        const result = await query(
            "SELECT * FROM Admin WHERE username = $1 AND category = $2",
            [username, category]
        );

        console.log(result)

        if (result.length === 0) {
            return res.status(401).json({
                status: false,
                message: `Invalid credentials for category: ${category}`
            });
        }

        const user = result[0];

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ status: false, message: "Invalid username or password" });
        }

        if (!user.status) {
            return res.status(403).json({ status: false, message: "Inactive user. Contact admin" });
        }

        // 🔹 Fetch role permissions
        const rolePermissionsResult = await query(
            "SELECT permissions FROM public.user_roles WHERE role_name = $1 AND category = $2",
            [user.role, user.category]
        );

        if (rolePermissionsResult.length === 0) {
            return res.status(404).json({ status: false, message: "Role not found" });
        }

        const permissions = rolePermissionsResult[0].permissions;

        // 🔹 Update last login timestamp
        await query("UPDATE public.admin SET last_login = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);

        // Log successful login
        await query(
            `INSERT INTO public.user_login_logs (username, fullname, role, category) 
             VALUES ($1, $2, $3, $4)`,
            [user.username, user.first_name + " " + user.last_name, user.role, user.category]
        ).catch(err => console.error("Error logging admin login:", err));

        // 🔹 Fetch location_id (if exists)
        const locationResult = await query(
            "SELECT id FROM public.source_location WHERE admin_id = $1 LIMIT 1",
            [user.id]
        );

        const location_id = locationResult.length > 0 ? locationResult[0].id : null;

        user.location_id = location_id;

        // 🔹 JWT now includes category for verification in protected routes
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, category: user.category },
            JWT_SECRET,
            { expiresIn: "1h" }
        );

        delete user.password;

        res.status(200).json({
            status: true,
            message: "Login successful",
            user,
            permissions,
            token
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error during login",
            error: error.message
        });
    }
};


exports.getAll = async (req, res) => {
    try {
        const { category } = req.params;
        let queryText, queryParams = [];

        if (category) {
            queryText = "SELECT * FROM public.admin WHERE category = $1 ORDER BY created_at DESC;";
            queryParams = [category];
        }
        else {
            queryText = "SELECT * FROM public.admin ORDER BY created_at DESC;";
        }

        const result = await query(queryText, queryParams);

        if (result.length === 0)
            return res.status(404).json({ status: false, message: category ? `No admins found for category: ${category}` : "No admins found" });

        res.status(200).json({ status: true, category: category || "all", count: result.length, data: result });

    }
    catch (error) {
        console.error("Error fetching admins:", error);
        res.status(500).json({ status: false, message: "Error while fetching admins", error: error.message });
    }
};



exports.getAvailableAdmin = async (req, res) => {
    try {
        // Fetch all admins
        const admins = await query(
            "SELECT * FROM public.admin WHERE category = $1 ORDER BY created_at DESC;",
            ['Wagon']
        );


        if (admins.length === 0) {
            return res.status(404).json({ status: false, message: "No admins found" });
        }

        // Fetch all admin_ids from source_location
        const usedAdmins = await query(`
            SELECT admin_id 
            FROM source_location
            WHERE admin_id IS NOT NULL;
        `);

        const usedAdminIds = new Set(usedAdmins.map(a => a.admin_id));

        // Append isAvail flag
        const result = admins.map(admin => ({
            ...admin,
            isAvail: !usedAdminIds.has(admin.id)
        }));

        res.status(200).json({ status: true, data: result });
    } catch (error) {
        console.log(error);
        res.status(500).json({ status: false, message: "Error while fetching admins", error: error.message });
    }
};



exports.updateAdmin = async (req, res) => {
    try {
        const { first_name, last_name, username, password, email, role, status, category } = req.body;
        const { id } = req.params;

        console.log(req.body)

        if (!id) {
            return res.status(400).json({ status: false, message: "Admin ID is required" });
        }

        // ✅ Fetch existing record to compare
        const existingAdmin = await query("SELECT * FROM public.admin WHERE id = $1", [id]);
        if (existingAdmin.length === 0) {
            return res.status(404).json({ status: false, message: "Admin not found" });
        }

        const admin = existingAdmin[0];

        // ✅ Check for duplicate username or email within same category
        if (username) {
            const userCheck = await query(
                "SELECT * FROM public.admin WHERE username = $1 AND category = $2 AND id != $3",
                [username, admin.category, id]
            );
            if (userCheck.length > 0) {
                return res.status(409).json({ status: false, message: "Username already in use in this category" });
            }
        }

        if (email) {
            const emailCheck = await query(
                "SELECT * FROM public.admin WHERE email = $1 AND category = $2 AND id != $3",
                [email, admin.category, id]
            );
            if (emailCheck.length > 0) {
                return res.status(409).json({ status: false, message: "Email already in use in this category" });
            }
        }

        // ✅ Hash password only if provided
        let hashedPassword = admin.password;
        if (password) {
            const saltRounds = 10;
            hashedPassword = await bcrypt.hash(password, saltRounds);
        }

        // ✅ Use COALESCE to update only if new values are provided
        const sql = `
            UPDATE public.admin
            SET
                first_name = COALESCE($1, first_name),
                last_name  = COALESCE($2, last_name),
                username   = COALESCE($3, username),
                password   = COALESCE($4, password),
                email      = COALESCE($5, email),
                role       = COALESCE($6, role),
                category   = COALESCE($7, category),
                status     = COALESCE($8, status),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $9
            RETURNING id, first_name, last_name, username, email, role, category, status, updated_at;
        `;

        const values = [
            first_name || null,
            last_name || null,
            username || null,
            hashedPassword || null,
            email || null,
            role || null,
            category || null,
            status !== undefined ? status : null,
            id
        ];

        const result = await query(sql, values);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: "Admin not found" });
        }

        const updatedAdmin = result[0];
        res.status(200).json({
            status: true,
            message: "Admin updated successfully",
            data: updatedAdmin
        });

    } catch (error) {
        console.error("Error in updateAdmin:", error);
        res.status(500).json({
            status: false,
            message: "Error while updating admin",
            error: error.message
        });
    }
};










// New function for Loading Status
exports.getLoadingStatus = async (req, res) => {
    try {
        // Query to get SAP Code, Number of Loads, and Total Quantity
        const result = await query(`
            SELECT
                sa.sap_code,
                COUNT(dc.id) AS no_of_load,
                SUM(
                    COALESCE(
                        (SELECT SUM((material_item->>'quantity')::numeric)
                         FROM jsonb_array_elements(dc.materials) AS material_item), 0
                    )
                ) AS total_qty
            FROM
                delivery_challan dc
            JOIN
                shipping_address sa ON dc.ship_to__id = sa.id
            GROUP BY
                sa.sap_code
            ORDER BY
                sa.sap_code;
        `);

        if (result.length === 0) {
            return res.status(200).json({ status: true, message: "No loading status data found", data: [] });
        }

        res.status(200).json({ status: true, data: result });

    } catch (error) {
        console.error('Error fetching loading status:', error);
        res.status(500).json({ status: false, message: "Error while fetching loading status", error: error.message });
    }
};

exports.getDashboardSummary = async (req, res) => {
    try {
        const result = await query(`
            SELECT
                (SELECT COUNT(id) FROM po) AS "totalMasters",
                (SELECT COUNT(id) FROM po) AS "totalPoCount",
                (
                    SELECT COALESCE(SUM((material_item->>'quantity')::numeric), 0)
                    FROM po, jsonb_array_elements(materials) AS material_item
                ) AS "totalMaterialValue",
                (SELECT COUNT(id) FROM delivery_challan WHERE status = 1 OR status = 2) AS "inProgressCount",
                (SELECT COUNT(id) FROM delivery_challan WHERE status = 3) AS "finishedCount"
        `);

        const summaryData = result[0];

        res.status(200).json({
            status: true,
            data: summaryData
        });

    } catch (error) {
        console.error('Error fetching dashboard summary:', error);
        res.status(500).json({ status: false, message: "Error while fetching dashboard summary", error: error.message });
    }
};

exports.getMonthlyPoSummary = async (req, res) => {
    try {
        const result = await query(`
            WITH monthly_po AS (
                SELECT
                    TO_CHAR(p.created_at, 'Mon') AS month,
                    EXTRACT(MONTH FROM p.created_at) AS month_num,
                    COALESCE(SUM((material_item->>'quantity')::numeric), 0) AS master_value,
                    COUNT(p.id) AS po_count
                FROM
                    po p,
                    jsonb_array_elements(p.materials) AS material_item
                WHERE
                    EXTRACT(YEAR FROM p.created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
                GROUP BY
                    month, month_num
            ), monthly_dc AS (
                SELECT
                    TO_CHAR(dc.created_at, 'Mon') AS month,
                    EXTRACT(MONTH FROM dc.created_at) AS month_num,
                    COALESCE(SUM((material_item_dc->>'quantity')::numeric), 0) AS total_value
                FROM
                    delivery_challan dc,
                    jsonb_array_elements(dc.materials) AS material_item_dc
                WHERE
                    EXTRACT(YEAR FROM dc.created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
                GROUP BY
                    month, month_num
            ), all_months AS (
                SELECT generate_series(1, 12) AS month_num
            )
            SELECT
                TO_CHAR(MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::int, am.month_num::int, 1), 'Mon') AS month,
                am.month_num,
                COALESCE(mp.master_value, 0) AS "masterValue",
                COALESCE(mdc.total_value, 0) AS "totalValue",
                COALESCE(mp.po_count, 0) AS "poCount"
            FROM
                all_months am
            LEFT JOIN
                monthly_po mp ON am.month_num = mp.month_num
            LEFT JOIN
                monthly_dc mdc ON am.month_num = mdc.month_num
            ORDER BY
                am.month_num;
        `);

        res.status(200).json({
            status: true,
            data: result
        });

    } catch (error) {
        console.error('Error fetching monthly PO summary:', error);
        res.status(500).json({ status: false, message: "Error while fetching monthly PO summary", error: error.message });
    }
};

exports.getProjectStatusSummary = async (req, res) => {
    try {
        const result = await query(`
            SELECT
                COUNT(CASE WHEN status = 1 THEN 1 END) AS "inProgress",
                COUNT(CASE WHEN status = 3 THEN 1 END) AS "finished",
                COUNT(CASE WHEN status = 2 THEN 1 END) AS "unfinished"
            FROM
                delivery_challan;
        `);

        const projectStatusData = result[0];

        res.status(200).json({
            status: true,
            data: projectStatusData
        });

    } catch (error) {
        console.error('Error fetching project status summary:', error);
        res.status(500).json({ status: false, message: "Error while fetching project status summary", error: error.message });
    }
};


exports.getTruckStatusSummary = async (req, res) => {
    try {
        const { from, to } = req.query;

        let dateFilter = '';
        if (from && to) {
            dateFilter = `WHERE DATE(p.created_at) BETWEEN '${from}' AND '${to}'`;
        }

        const result2 = await query(`
            SELECT
                p.rr_no,
                p.po_no,
                s.name AS supplier_name,
                (
                    SELECT STRING_AGG(material_item->>'name', ', ')
                    FROM jsonb_array_elements(p.materials::jsonb) AS material_item
                ) AS material_names,
                CASE 
                    WHEN EXISTS (
                        SELECT 1 FROM delivery_challan dc WHERE dc.rr_no = p.rr_no
                    )
                    THEN 
                        CASE 
                            WHEN (
                                SELECT COUNT(*) 
                                FROM jsonb_array_elements(p.materials::jsonb) AS item 
                                WHERE (item->>'qty')::int > 0
                            ) = 0
                            THEN 'completed'
                            ELSE 'pending'
                        END
                    ELSE 'pending'
                END AS status,
                CASE 
                    WHEN EXISTS (
                        SELECT 1 FROM delivery_challan dc WHERE dc.rr_no = p.rr_no
                    )
                    THEN true ELSE false
                END AS arrived,
                true AS loaded
            FROM po p
            JOIN supplier s ON p.supplier__id = s.id
            ${dateFilter}
            ORDER BY p.created_at DESC;
        `);

        const result = await query(`
    SELECT
        p.rr_no,
        p.po_no,
        s.name AS supplier_name,

        (
            SELECT STRING_AGG(material_item->>'name', ', ')
            FROM jsonb_array_elements(p.materials::jsonb) AS material_item
        ) AS material_names,

        -- TOTAL DC CREATED (LOADED)
        (
            SELECT COUNT(*)
            FROM delivery_challan dc
            WHERE dc.rr_no = p.rr_no
        ) AS loaded,

        -- ARRIVED COUNT
        (
            SELECT COUNT(*)
            FROM delivery_challan dc
            WHERE dc.rr_no = p.rr_no
              AND dc.is_arrived = true
        ) AS arrived,

        -- PENDING = LOADED - ARRIVED
        (
            SELECT COUNT(*)
            FROM delivery_challan dc
            WHERE dc.rr_no = p.rr_no
              AND dc.is_arrived = false
        ) AS pending

    FROM po p
    JOIN supplier s ON p.supplier__id = s.id
    ${dateFilter}
    ORDER BY p.created_at DESC;
`);


        if (!result || result.length === 0) {
            return res.status(200).json({
                status: true,
                message: "No truck status data found",
                data: []
            });
        }

        return res.status(200).json({
            status: true,
            data: result
        });

    } catch (error) {
        console.error('Error fetching truck status summary:', error);
        return res.status(500).json({
            status: false,
            message: "Error while fetching truck status summary",
            error: error.message
        });
    }
};


exports.getAdminSummary = async (req, res) => {
    try {
        const { from, to } = req.query;
        const dateFilter = from && to ? `WHERE DATE(created_at) BETWEEN '${from}' AND '${to}'` : "";

        const summaryQuery = `
            SELECT
                (SELECT COUNT(*) FROM po ${dateFilter}) AS total_pos,
                (SELECT COUNT(*) FROM delivery_challan ${dateFilter}) AS total_delivery_challans,
                (SELECT COUNT(*) FROM delivery_challan ${dateFilter ? `${dateFilter} AND status != 1` : 'WHERE status != 1'}) AS pending_delivery_challans,
                (SELECT COUNT(*) FROM supplier) AS total_suppliers,
                (SELECT COUNT(*) FROM material WHERE status = 1) AS active_materials,
                (
                    SELECT COUNT(DISTINCT truck_no)
                    FROM delivery_challan
                    ${dateFilter}
                ) AS trucks_used_today
        `;

        // Line Chart: Daily Challan Counts
        let challansOverTimeQuery = `
            SELECT TO_CHAR(created_at, 'YYYY-MM-DD') AS date, COUNT(*) AS count
            FROM delivery_challan
        `;
        if (from && to) {
            challansOverTimeQuery += ` WHERE DATE(created_at) BETWEEN '${from}' AND '${to}'`;
        }
        challansOverTimeQuery += ` GROUP BY date ORDER BY date ASC`;

        // Bar Chart: Challan Count by RR No
        let challansPerRRQuery = `
            SELECT rr_no, COUNT(*) AS count
            FROM delivery_challan
        `;
        if (from && to) {
            challansPerRRQuery += ` WHERE DATE(created_at) BETWEEN '${from}' AND '${to}'`;
        } else {
            challansPerRRQuery += ` WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'`;
        }
        challansPerRRQuery += ` GROUP BY rr_no ORDER BY count DESC LIMIT 5`;

        const [summary] = await query(summaryQuery);
        const challansOverTime = await query(challansOverTimeQuery);
        const challansPerRR = await query(challansPerRRQuery);

        return res.status(200).json({
            status: true,
            message: "Admin summary with chart data fetched successfully.",
            data: {
                summary,
                charts: {
                    challansOverTime,
                    challansPerRR
                }
            }
        });

    } catch (error) {
        console.error("Error while fetching admin summary: ", error);
        res.status(500).json({
            status: false,
            message: "Error while fetching admin dashboard summary",
            error: error.message
        });
    }
};


exports.getFarmActivityReport = async (req, res) => {
  try {

    const farmActivity = await query(`
      SELECT plant,
             COUNT(*)::int entries
      FROM broiler.farm_activity
      GROUP BY plant
      ORDER BY entries DESC
    `);

    const billSupply = await query(`
      SELECT plant,
             COUNT(*)::int entries
      FROM broiler.bill_of_supply_dc
      GROUP BY plant
      ORDER BY entries DESC
    `);

    const shedReady = await query(`
      SELECT plant,
             COUNT(*)::int entries
      FROM broiler.shed_ready
      GROUP BY plant
      ORDER BY entries DESC
    `);

    const issueMedicine = await query(`
      SELECT branch,
             COUNT(*)::int entries
      FROM broiler.issue_medicine_dc
      GROUP BY branch
      ORDER BY entries DESC
    `);

    const summary = {
      farmActivity: (await query(`SELECT COUNT(*)::int total FROM broiler.farm_activity`))[0].total,
      billSupply: (await query(`SELECT COUNT(*)::int total FROM broiler.bill_of_supply_dc`))[0].total,
      shedReady: (await query(`SELECT COUNT(*)::int total FROM broiler.shed_ready`))[0].total,
      issueMedicine: (await query(`SELECT COUNT(*)::int total FROM broiler.issue_medicine_dc`))[0].total
    };

    return res.status(200).json({
      status: true,
      data: {
        summary,
        farmActivity,
        billSupply,
        shedReady,
        issueMedicine
      }
    });

  } catch (error) {
    console.log(error);
    res.status(500).json({
      status: false,
      message: error.message
    });
  }
};

exports.getBroilerDashboardReport = async (req, res) => {
    try {
        const { from, to, period = 'daily' } = req.query;

        // Default to last 30 days if from/to not specified
        let fromDate = from;
        let toDate = to;
        if (!fromDate || !toDate) {
            const today = new Date();
            const past30Days = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
            if (!fromDate) fromDate = past30Days.toISOString().split('T')[0];
            if (!toDate) toDate = today.toISOString().split('T')[0];
        }

        // Fetch plant mapping
        const plantResult = await query("SELECT plant_id, plant_name FROM broiler.plant");
        const plantMap = {};
        plantResult.forEach(row => {
            if (row.plant_id) {
                plantMap[String(row.plant_id).trim()] = row.plant_name;
            }
        });

        // Farm Activity only report query
        let groupingSql = '';
        if (period === 'monthly') {
            groupingSql = "TO_CHAR(DATE_TRUNC('month', fa.date::date), 'YYYY-MM') AS period_date";
        } else if (period === 'weekly') {
            groupingSql = "TO_CHAR(DATE_TRUNC('week', fa.date::date), 'YYYY-MM-DD') AS period_date";
        } else {
            groupingSql = "TO_CHAR(fa.date::date, 'YYYY-MM-DD') AS period_date";
        }

        const reportDetailsQuery = `
            SELECT 
                ${groupingSql},
                fa.plant,
                COUNT(*)::int AS posted,
                COUNT(DISTINCT fa.user_id)::int AS user_count,
                STRING_AGG(DISTINCT COALESCE(fa.user_id, 'unknown'), ', ') AS usernames
            FROM broiler.farm_activity fa
            WHERE fa.date::date BETWEEN $1::date AND $2::date
            GROUP BY period_date, fa.plant
            ORDER BY period_date DESC, fa.plant ASC;
        `;

        const reportDetails = await query(reportDetailsQuery, [fromDate, toDate]);

        // Summary Metrics from farm_activity only
        const [totalEntriesResult] = await query(
            `SELECT COUNT(*)::int AS count FROM broiler.farm_activity WHERE date::date BETWEEN $1::date AND $2::date`,
            [fromDate, toDate]
        );
        const [activeUsersResult] = await query(
            `SELECT COUNT(DISTINCT user_id)::int AS count FROM broiler.farm_activity WHERE date::date BETWEEN $1::date AND $2::date`,
            [fromDate, toDate]
        );
        const [loginsResult] = await query(
            `SELECT COUNT(*)::int AS total_logins, COUNT(DISTINCT username)::int AS unique_users FROM public.user_login_logs WHERE login_time::date BETWEEN $1::date AND $2::date`,
            [fromDate, toDate]
        );

        const summary = {
            active_users: activeUsersResult?.count || 0,
            total_entries: totalEntriesResult?.count || 0,
            total_logins: loginsResult?.total_logins || 0,
            unique_login_users: loginsResult?.unique_users || 0
        };

        // Fetch user mappings to display Full Name (username)
        const drivers = await query("SELECT username, fullname FROM public.driver");
        const admins = await query("SELECT username, first_name, last_name FROM public.admin");
        
        const userMap = {};
        drivers.forEach(d => {
            if (d.username) {
                userMap[String(d.username).trim().toLowerCase()] = d.fullname;
            }
        });
        admins.forEach(a => {
            if (a.username) {
                userMap[String(a.username).trim().toLowerCase()] = `${a.first_name || ''} ${a.last_name || ''}`.trim();
            }
        });

        // Enrich plant names & user fullnames
        const enrichedReportDetails = reportDetails.map(row => {
            const plantKey = String(row.plant || '').trim();
            
            let displayNames = '';
            if (row.usernames) {
                displayNames = row.usernames.split(', ').map(username => {
                    const cleanUsername = username.trim();
                    const fullname = userMap[cleanUsername.toLowerCase()];
                    if (fullname && fullname.toLowerCase() !== cleanUsername.toLowerCase()) {
                        return `${fullname} (${cleanUsername})`;
                    }
                    return cleanUsername;
                }).join(', ');
            }

            return {
                ...row,
                plant_name: plantMap[plantKey] || row.plant || 'Unknown Plant',
                usernames: displayNames
            };
        });

        // 3. Weekly/Monthly Login details breakdown
        let loginGroupingSql = '';
        if (period === 'monthly') {
            loginGroupingSql = "TO_CHAR(DATE_TRUNC('month', login_time), 'YYYY-MM') AS period_date";
        } else if (period === 'weekly') {
            loginGroupingSql = "TO_CHAR(DATE_TRUNC('week', login_time), 'YYYY-MM-DD') AS period_date";
        } else {
            loginGroupingSql = "TO_CHAR(login_time, 'YYYY-MM-DD') AS period_date";
        }

        const loginDetailsQuery = `
            SELECT 
                ${loginGroupingSql},
                COUNT(*)::int AS login_count,
                COUNT(DISTINCT username)::int AS user_count
            FROM public.user_login_logs
            WHERE login_time::date BETWEEN $1 AND $2
            GROUP BY period_date
            ORDER BY period_date DESC;
        `;
        const loginDetails = await query(loginDetailsQuery, [fromDate, toDate]);

        res.status(200).json({
            status: true,
            data: {
                summary,
                reportDetails: enrichedReportDetails,
                loginDetails,
                fromDate,
                toDate,
                period
            }
        });

    } catch (error) {
        console.error("Error fetching broiler dashboard reports: ", error);
        res.status(500).json({
            status: false,
            message: "Error fetching broiler dashboard reports",
            error: error.message
        });
    }
};

exports.getBroilerFarmActivityDetails = async (req, res) => {
    try {
        const { date, plant, period = 'daily' } = req.query;

        if (!date || !plant) {
            return res.status(400).json({
                status: false,
                message: "date and plant are required query parameters"
            });
        }

        // Fetch plant name
        const plantResult = await query(
            "SELECT plant_name FROM broiler.plant WHERE plant_id = $1 LIMIT 1",
            [plant]
        );
        const plantName = plantResult.length > 0 ? plantResult[0].plant_name : plant;

        // Fetch all farm activity entries for this date and plant
        console.log('[BroilerFarmActivity] Querying date:', date, 'plant:', plant, 'period:', period);

        let dateCondition = '';
        if (period === 'monthly') {
            dateCondition = "TO_CHAR(DATE_TRUNC('month', fa.date::date), 'YYYY-MM') = $1";
        } else if (period === 'weekly') {
            dateCondition = "TO_CHAR(DATE_TRUNC('week', fa.date::date), 'YYYY-MM-DD') = $1";
        } else {
            dateCondition = "TO_CHAR(fa.date::date, 'YYYY-MM-DD') = $1";
        }

        const entries = await query(`
            SELECT 
                fa.id,
                fa.date,
                fa.plant,
                fa.farmer,
                fa.batch,
                fa.age,
                fa.housed,
                fa.stock,
                fa.mortality,
                fa.cum_mortality_count,
                fa.cum_mortality_percentage,
                fa.body_weight,
                fa.farm_maintenance AS farms_maintenance,
                fa.litter_quality,
                fa.drinker_cleaning,
                fa.material,
                fa.quantity_bags,
                fa.stock_bags,
                fa.cum_feed,
                fa.total_feed,
                fa.in_time,
                fa.out_time,
                fa.vehicle_no,
                fa.start_km,
                fa.end_km,
                fa.running_km,
                fa.total_farms,
                fa.reason,
                fa.treatment,
                fa.user_id,
                fa.sap_status,
                fa.created_at,
                fa.materials
            FROM broiler.farm_activity fa
            WHERE ${dateCondition} AND fa.plant::text = $2::text
            ORDER BY fa.farmer ASC, fa.created_at DESC
        `, [date, String(plant)]);
        console.log('[BroilerFarmActivity] Found entries:', entries.length);
        // Build user mapping for display names
        const drivers = await query("SELECT username, fullname FROM public.driver");
        const admins = await query("SELECT username, first_name, last_name FROM public.admin");
        
        const userMap = {};
        drivers.forEach(d => {
            if (d.username) {
                userMap[String(d.username).trim().toLowerCase()] = d.fullname;
            }
        });
        admins.forEach(a => {
            if (a.username) {
                userMap[String(a.username).trim().toLowerCase()] = `${a.first_name || ''} ${a.last_name || ''}`.trim();
            }
        });

        // Fetch farmer names from broiler.farmer, broiler.farmer_location, public.farmers, and SAP API
        let farmerMap = {};
        const addFarmerVariantKeys = (code, name) => {
            if (!code || !name) return;
            const strCode = String(code).trim();
            if (!strCode) return;

            const lower = strCode.toLowerCase();
            if (!farmerMap[lower]) farmerMap[lower] = name;

            const noLeadingZeros = lower.replace(/^0+/, '');
            if (noLeadingZeros && !farmerMap[noLeadingZeros]) farmerMap[noLeadingZeros] = name;

            if (lower.startsWith('fsz')) {
                const afterFsz = lower.slice(3).replace(/^0+/, '');
                if (afterFsz) {
                    if (!farmerMap[afterFsz]) farmerMap[afterFsz] = name;
                    if (!farmerMap[`fsz${afterFsz}`]) farmerMap[`fsz${afterFsz}`] = name;
                    if (!farmerMap[`fsz${afterFsz.padStart(5, '0')}`]) farmerMap[`fsz${afterFsz.padStart(5, '0')}`] = name;
                }
            } else {
                const digitsOnly = lower.replace(/\D/g, '');
                if (digitsOnly) {
                    const cleanDigits = digitsOnly.replace(/^0+/, '');
                    if (cleanDigits) {
                        if (!farmerMap[cleanDigits]) farmerMap[cleanDigits] = name;
                        if (!farmerMap[`fsz${cleanDigits}`]) farmerMap[`fsz${cleanDigits}`] = name;
                        if (!farmerMap[`fsz${cleanDigits.padStart(5, '0')}`]) farmerMap[`fsz${cleanDigits.padStart(5, '0')}`] = name;
                        if (!farmerMap[cleanDigits.padStart(10, '0')]) farmerMap[cleanDigits.padStart(10, '0')] = name;
                    }
                }
            }
        };

        // 1. Fetch from broiler.farmer table
        try {
            const farmers = await query(`
                SELECT farmer_supplier, farmer_no, farmer_name
                FROM broiler.farmer
            `);
            farmers.forEach(f => {
                const name = f.farmer_name;
                if (f.farmer_supplier) addFarmerVariantKeys(f.farmer_supplier, name);
                if (f.farmer_no) addFarmerVariantKeys(f.farmer_no, name);
            });
        } catch (e) {
            console.warn("Notice: broiler.farmer table lookup:", e.message);
        }

        // 2. Fetch from broiler.farmer_location table
        try {
            const locFarmers = await query("SELECT farmer_supplier, farmer_no, farmer_name FROM broiler.farmer_location");
            locFarmers.forEach(f => {
                if (f.farmer_supplier) addFarmerVariantKeys(f.farmer_supplier, f.farmer_name);
                if (f.farmer_no) addFarmerVariantKeys(f.farmer_no, f.farmer_name);
            });
        } catch (e) {
            // farmer_location table may not exist
        }

        // 3. Fetch from public.farmers table as fallback
        try {
            const pubFarmers = await query("SELECT farmer_id, name, code FROM public.farmers");
            pubFarmers.forEach(f => {
                if (f.farmer_id) addFarmerVariantKeys(f.farmer_id, f.name);
                if (f.code) addFarmerVariantKeys(f.code, f.name);
            });
        } catch (e) {
            // public.farmers table may not exist
        }

        // 4. Fetch from SAP API /zdaily_mor if SAP base URL configured
        if (process.env.BROILER_SAP_BASE_URL) {
            try {
                const axios = require('axios');
                const morUrl = `${process.env.BROILER_SAP_BASE_URL}/zdaily_mor?sap-client=500`;
                const morRes = await axios.get(morUrl, {
                    auth: {
                        username: process.env.BROILER_SAP_USERNAME,
                        password: process.env.BROILER_SAP_PASSWORD
                    },
                    timeout: 5000
                });
                if (morRes.status === 200 && Array.isArray(morRes.data)) {
                    morRes.data.forEach(f => {
                        const name = f.name1;
                        const location = [f.street, f.street2, f.zzlineN].filter(Boolean).map(s => String(s).trim()).filter(Boolean).join(' ');
                        const fullFarmerName = (name && location && !name.includes('-')) ? `${name} - ${location}` : (name || location);
                        if (f.lifnr) addFarmerVariantKeys(f.lifnr, fullFarmerName);
                        if (f.kunnr) addFarmerVariantKeys(f.kunnr, fullFarmerName);
                    });
                }
            } catch (e) {
                console.warn("SAP daily_mor lookup fallback error:", e.message);
            }
        }

        // Enrich entries with display names
        const enrichedEntries = entries.map(entry => {
            const userId = entry.user_id ? String(entry.user_id).trim().toLowerCase() : '';
            const fullname = userMap[userId];

            const rawFarmer = entry.farmer ? String(entry.farmer).trim() : '';
            const farmerKey = rawFarmer.toLowerCase();

            let farmerName = '';
            if (farmerKey) {
                const digits = farmerKey.replace(/\D/g, '').replace(/^0+/, '');
                farmerName = farmerMap[farmerKey] ||
                             farmerMap[farmerKey.replace(/^0+/, '')] ||
                             farmerMap[farmerKey.replace(/^fsz0*/, '')] ||
                             (digits ? farmerMap[digits] : '') ||
                             (digits ? farmerMap[`fsz${digits}`] : '') ||
                             (digits ? farmerMap[`fsz${digits.padStart(5, '0')}`] : '') ||
                             (digits ? farmerMap[digits.padStart(10, '0')] : '') ||
                             '';
            }

            return {
                ...entry,
                user_display_name: fullname || entry.user_id || 'unknown',
                farmer_name: farmerName
            };
        });

        // Summary stats
        const summaryStats = {
            total_entries: entries.length,
            unique_farmers: [...new Set(entries.map(e => e.farmer).filter(Boolean))].length,
            total_mortality: entries.reduce((sum, e) => sum + (Number(e.mortality) || 0), 0),
            avg_body_weight: entries.length > 0
                ? (entries.reduce((sum, e) => sum + (Number(e.body_weight) || 0), 0) / entries.filter(e => Number(e.body_weight) > 0).length || 0).toFixed(2)
                : 0,
            total_stock: entries.reduce((sum, e) => sum + (Number(e.stock) || 0), 0),
            total_housed: entries.reduce((sum, e) => sum + (Number(e.housed) || 0), 0),
            total_feed_bags: entries.reduce((sum, e) => sum + (Number(e.quantity_bags) || 0), 0),
        };

        res.status(200).json({
            status: true,
            data: {
                plant,
                plant_name: plantName,
                date,
                summary: summaryStats,
                entries: enrichedEntries
            }
        });

    } catch (error) {
        console.error("Error fetching farm activity details: ", error);
        res.status(500).json({
            status: false,
            message: "Error fetching farm activity details",
            error: error.message
        });
    }
};
