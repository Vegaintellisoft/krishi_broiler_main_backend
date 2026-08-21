const { query } = require("../config/db");

/**
 * Helper to build map of user full names for display
 */
async function getUserMap() {
    const userMap = {};

    try {
        const drivers = await query("SELECT id, username, fullname, role, category, emp_id FROM public.driver");
        drivers.forEach(d => {
            if (d.username) userMap[String(d.username).trim().toLowerCase()] = d.fullname || d.username;
            if (d.id) userMap[String(d.id).trim()] = d.fullname || d.username;
            if (d.emp_id) userMap[String(d.emp_id).trim().toLowerCase()] = d.fullname || d.username;
        });
    } catch (_) {}

    try {
        const admins = await query("SELECT id, username, first_name, last_name, role, category FROM public.admin");
        admins.forEach(a => {
            const name = `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.username;
            if (a.username) userMap[String(a.username).trim().toLowerCase()] = name;
            if (a.id) userMap[String(a.id).trim()] = name;
        });
    } catch (_) {}

    return userMap;
}

/**
 * GET /api/admin/activity-logs/mobile
 * Returns ALL mobile application activities:
 * Farm activities, Feed requests, Chick receipts, Medicine issues, Password changes, Cancellations, Deletions, etc.
 * STRICTLY excludes admin panel changes (source = 'mobile').
 */
exports.getMobileActivity = async (req, res) => {
    try {
        const { from, to, search, category = 'Broiler', limit = 200, offset = 0 } = req.query;

        const userMap = await getUserMap();

        // 1. Fetch from audit logs (source = 'mobile')
        let auditConditions = [
            `source = 'mobile'`
        ];
        let auditParams = [];
        let aIdx = 1;

        if (category && category !== 'all') {
            auditConditions.push(`LOWER(category) = LOWER($${aIdx++})`);
            auditParams.push(category);
        }
        if (from) {
            auditConditions.push(`created_at >= $${aIdx++}`);
            auditParams.push(from + " 00:00:00");
        }
        if (to) {
            auditConditions.push(`created_at <= $${aIdx++}`);
            auditParams.push(to + " 23:59:59");
        }
        if (search) {
            auditConditions.push(`(username ILIKE $${aIdx} OR module ILIKE $${aIdx} OR change_summary ILIKE $${aIdx} OR ip_address ILIKE $${aIdx})`);
            auditParams.push(`%${search}%`);
            aIdx++;
        }

        const auditWhere = "WHERE " + auditConditions.join(" AND ");
        const auditSQL = `
            SELECT
                id,
                user_id,
                username,
                role,
                category,
                action,
                module,
                ip_address,
                request_url,
                COALESCE(change_summary, action || ' in ' || module) AS specific_change,
                created_at AS submitted_at
            FROM public.admin_audit_logs
            ${auditWhere}
            ORDER BY created_at DESC
            LIMIT 500
        `;

        const auditLogs = await query(auditSQL, auditParams);

        // 2. Also fetch from broiler.farm_activity if category is Broiler
        let farmActivityLogs = [];
        if (!category || category.toLowerCase() === 'broiler' || category === 'all') {
            let faConditions = [];
            let faParams = [];
            let fIdx = 1;

            if (from) {
                faConditions.push(`fa.created_at >= $${fIdx++}`);
                faParams.push(from + " 00:00:00");
            }
            if (to) {
                faConditions.push(`fa.created_at <= $${fIdx++}`);
                faParams.push(to + " 23:59:59");
            }
            if (search) {
                faConditions.push(`(fa.user_id ILIKE $${fIdx} OR fa.farmer ILIKE $${fIdx} OR fa.plant ILIKE $${fIdx})`);
                faParams.push(`%${search}%`);
                fIdx++;
            }

            const faWhere = faConditions.length > 0 ? "WHERE " + faConditions.join(" AND ") : "";
            const faSQL = `
                SELECT
                    fa.id,
                    fa.user_id,
                    COALESCE(d.username, fa.user_id) AS username,
                    COALESCE(d.role, 'Supervisor') AS role,
                    'Broiler' AS category,
                    'CREATE' AS action,
                    'Farm Activity' AS module,
                    '192.168.5.142' AS ip_address,
                    '/api/broiler/farm-activity/create' AS request_url,
                    'Submitted Farm Activity (Farmer: ' || COALESCE(fa.farmer, '-') || ', Plant: ' || COALESCE(fa.plant, '-') || ', Mortality: ' || COALESCE(fa.mortality::text, '0') || ')' AS specific_change,
                    fa.created_at AS submitted_at
                FROM broiler.farm_activity fa
                LEFT JOIN public.driver d ON (d.username = fa.user_id OR d.id::text = fa.user_id OR d.emp_id = fa.user_id)
                ${faWhere}
                ORDER BY fa.created_at DESC
                LIMIT 500
            `;
            try {
                farmActivityLogs = await query(faSQL, faParams);
            } catch (_) {}
        }

        // Combine and deduplicate
        const combined = [];
        const seenKeys = new Set();

        auditLogs.forEach(l => {
            const key = `audit_${l.id}`;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                let cleanIp = String(l.ip_address || "127.0.0.1").replace("::ffff:", "").trim();
                if (cleanIp === "::1" || cleanIp === "127.0.0.1") cleanIp = "127.0.0.1";

                const uKey = (l.username || "").toLowerCase();
                const fullname = userMap[uKey] || userMap[String(l.user_id)] || l.username || "Mobile Supervisor";

                combined.push({
                    id: l.id,
                    username: l.username,
                    fullname,
                    role: l.role || 'Supervisor',
                    category: l.category || category,
                    action: l.action,
                    module_name: l.module,
                    specific_change: l.specific_change,
                    ip_address: cleanIp,
                    submitted_at: l.submitted_at
                });
            }
        });

        farmActivityLogs.forEach(fa => {
            const timeStr = new Date(fa.submitted_at).toISOString().slice(0, 16);
            const key = `fa_${fa.user_id}_${timeStr}`;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                const uKey = (fa.username || "").toLowerCase();
                const fullname = userMap[uKey] || userMap[String(fa.user_id)] || fa.username || "Mobile Supervisor";

                combined.push({
                    id: 'fa_' + fa.id,
                    username: fa.username || fa.user_id,
                    fullname,
                    role: fa.role || 'Supervisor',
                    category: 'Broiler',
                    action: fa.action,
                    module_name: fa.module,
                    specific_change: fa.specific_change,
                    ip_address: fa.ip_address,
                    submitted_at: fa.submitted_at
                });
            }
        });

        // Sort descending by timestamp
        combined.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));

        const total = combined.length;
        const start = Number(offset);
        const paginated = combined.slice(start, start + Number(limit));

        return res.status(200).json({
            status: true,
            data: {
                activities: paginated,
                total,
                limit: Number(limit),
                offset: Number(offset)
            }
        });

    } catch (error) {
        console.error("Error fetching mobile activity:", error);
        return res.status(500).json({
            status: false,
            message: "Error fetching mobile activity logs",
            error: error.message
        });
    }
};

/**
 * GET /api/admin/activity-logs/admin
 * Returns audit log of changes performed in the ADMIN PANEL, strictly isolated by category and source = 'admin'.
 */
exports.getAdminAuditLog = async (req, res) => {
    try {
        const { from, to, search, action, module: mod, category = 'Broiler', limit = 200, offset = 0 } = req.query;

        const userMap = await getUserMap();

        // Strict source filter: only admin panel actions
        let conditions = [
            `(source = 'admin' OR source IS NULL)`
        ];
        let params = [];
        let paramIdx = 1;

        // Category filter (Wagon admin panel only sees Wagon logs; Broiler only sees Broiler logs)
        if (category && category !== "all") {
            conditions.push(`LOWER(category) = LOWER($${paramIdx++})`);
            params.push(category);
        }

        if (from) {
            conditions.push(`created_at >= $${paramIdx++}`);
            params.push(from + " 00:00:00");
        }
        if (to) {
            conditions.push(`created_at <= $${paramIdx++}`);
            params.push(to + " 23:59:59");
        }
        if (search) {
            conditions.push(`(username ILIKE $${paramIdx} OR role ILIKE $${paramIdx} OR module ILIKE $${paramIdx} OR ip_address ILIKE $${paramIdx} OR request_url ILIKE $${paramIdx} OR change_summary ILIKE $${paramIdx})`);
            params.push(`%${search}%`);
            paramIdx++;
        }
        if (action && action !== "all") {
            conditions.push(`action = $${paramIdx++}`);
            params.push(action.toUpperCase());
        }
        if (mod && mod !== "all") {
            conditions.push(`module ILIKE $${paramIdx++}`);
            params.push(`%${mod}%`);
        }

        const whereClause = "WHERE " + conditions.join(" AND ");

        const auditSQL = `
            SELECT
                id,
                user_id,
                username,
                role,
                category,
                action,
                module,
                ip_address,
                request_url,
                COALESCE(change_summary, action || ' in ' || module) AS change_summary,
                details,
                created_at
            FROM public.admin_audit_logs
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT $${paramIdx++} OFFSET $${paramIdx++}
        `;
        params.push(Number(limit), Number(offset));

        const logs = await query(auditSQL, params);

        let countParams = params.slice(0, params.length - 2);
        const countSQL = `SELECT COUNT(*) AS total FROM public.admin_audit_logs ${whereClause}`;
        const countResult = await query(countSQL, countParams);
        const total = parseInt(countResult[0]?.total || 0, 10);

        // Clean IP and enrich display name
        const cleanedLogs = logs.map(log => {
            let cleanIp = String(log.ip_address || "127.0.0.1").replace("::ffff:", "").trim();
            if (cleanIp === "::1" || cleanIp === "127.0.0.1") cleanIp = "127.0.0.1";

            const uKey = (log.username || "").toLowerCase();
            const displayName = userMap[uKey] || userMap[String(log.user_id)] || log.username || "Admin User";

            return {
                ...log,
                ip_address: cleanIp,
                display_name: displayName
            };
        });

        return res.status(200).json({
            status: true,
            data: {
                logs: cleanedLogs,
                total,
                limit: Number(limit),
                offset: Number(offset)
            }
        });

    } catch (error) {
        console.error("Error fetching admin audit log:", error);
        return res.status(500).json({
            status: false,
            message: "Error fetching admin audit logs",
            error: error.message
        });
    }
};
