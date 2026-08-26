const { query } = require("../config/db");
const { formatActivePermissions } = require("../utils/permissionAuditHelper");

function normalizeDateStr(val) {
    if (!val) return '';
    if (val instanceof Date) {
        return val.toISOString().slice(0, 10);
    }
    const str = String(val).trim();
    const dmyMatch = str.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})/);
    if (dmyMatch) {
        const day = dmyMatch[1].padStart(2, '0');
        const month = dmyMatch[2].padStart(2, '0');
        const year = dmyMatch[3];
        return `${year}-${month}-${day}`;
    }
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
    }
    return str;
}


/**
 * Helper to build map of user full names and metadata for display
 */
async function getUserMap() {
    const userMap = {};
    const driverRoleMap = {};
    const userCategoryMap = {};

    try {
        const drivers = await query("SELECT id, username, fullname, role, category, emp_id FROM public.driver");
        drivers.forEach(d => {
            const name = d.fullname || d.username || "";
            const cat = d.category || "Broiler";
            if (d.username) {
                const uKey = String(d.username).trim().toLowerCase();
                userMap[uKey] = name;
                if (d.role) driverRoleMap[uKey] = d.role;
                userCategoryMap[uKey] = cat;
            }
            if (d.id) {
                const idKey = String(d.id).trim();
                userMap[idKey] = name;
                if (d.role) driverRoleMap[idKey] = d.role;
                userCategoryMap[idKey] = cat;
            }
            if (d.emp_id) {
                const eKey = String(d.emp_id).trim().toLowerCase();
                userMap[eKey] = name;
                if (d.role) driverRoleMap[eKey] = d.role;
                userCategoryMap[eKey] = cat;
            }
        });
    } catch (_) {}

    try {
        const admins = await query("SELECT id, username, first_name, last_name, role, category FROM public.admin");
        admins.forEach(a => {
            const name = `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.username;
            const cat = a.category || "Broiler";
            if (a.username) {
                const uKey = String(a.username).trim().toLowerCase();
                userMap[uKey] = name;
                userCategoryMap[uKey] = cat;
            }
            if (a.id) {
                const idKey = String(a.id).trim();
                userMap[idKey] = name;
                userCategoryMap[idKey] = cat;
            }
        });
    } catch (_) {}

    return { userMap, driverRoleMap, userCategoryMap };
}

/**
 * Fetch and normalize operational records from Wagon tables (Delivery Challan, Purchase Orders)
 */
async function fetchWagonOperationalRecords(userMap, driverRoleMap, from, to) {
    const records = [];

    // 1. Delivery Challan (public.delivery_challan)
    try {
        let dcSql = `
            SELECT 
                dc.id,
                dc.rr_no,
                dc.token_no,
                dc.truck_no,
                dc.materials,
                dc.doc_no,
                dc.status,
                dc.reason,
                dc.user_id,
                dc.is_arrived,
                dc.is_send_sap,
                dc.created_at,
                dc.updated_at,
                COALESCE(d.username, dc.user_id::text) AS username,
                COALESCE(d.fullname, dc.user_id::text) AS fullname,
                COALESCE(d.role, 'Driver') AS role,
                sa.sap_name AS ship_to_name
            FROM public.delivery_challan dc
            LEFT JOIN public.driver d ON (d.id = dc.user_id OR d.username = dc.user_id::text OR d.emp_id = dc.user_id::text)
            LEFT JOIN public.shipping_address sa ON (sa.id = dc.ship_to__id)
        `;
        const dcConditions = [];
        const dcParams = [];
        let pIdx = 1;
        if (from) {
            dcConditions.push(`COALESCE(dc.created_at, dc.updated_at) >= $${pIdx}`);
            dcParams.push(from);
            pIdx++;
        }
        if (to) {
            dcConditions.push(`COALESCE(dc.created_at, dc.updated_at) <= $${pIdx}`);
            dcParams.push(to + " 23:59:59");
            pIdx++;
        }
        if (dcConditions.length > 0) dcSql += " WHERE " + dcConditions.join(" AND ");
        dcSql += " ORDER BY COALESCE(dc.created_at, dc.updated_at) DESC LIMIT 1000";

        const dcRows = await query(dcSql, dcParams);
        dcRows.forEach(dc => {
            const uKey = (dc.username || String(dc.user_id) || "").toLowerCase();
            const displayName = userMap[uKey] || userMap[String(dc.user_id)] || dc.fullname || dc.username || "Driver";
            const role = driverRoleMap[uKey] || dc.role || "Driver";
            const createdAt = dc.created_at ? new Date(dc.created_at).toISOString() : new Date().toISOString();

            let action = 'CREATE';
            const descParts = [];

            if (dc.doc_no) descParts.push(`Doc: ${dc.doc_no}`);
            if (dc.token_no) descParts.push(`Token: ${dc.token_no}`);
            if (dc.rr_no) descParts.push(`RR: ${dc.rr_no}`);
            if (dc.truck_no) descParts.push(`Truck: ${dc.truck_no}`);
            if (dc.ship_to_name) descParts.push(`Ship To: ${dc.ship_to_name}`);

            let description = '';
            if (dc.status === 2) {
                action = 'CANCEL';
                description = `Cancelled DC/Challan ${dc.doc_no || '#' + dc.id}${dc.reason ? ` (Reason: ${dc.reason})` : ''} | Truck: ${dc.truck_no || '-'}`;
            } else if (dc.is_arrived || dc.status === 3) {
                action = 'UPDATE';
                description = `DC/Challan ${dc.doc_no || '#' + dc.id} marked as Arrived | Truck: ${dc.truck_no || '-'}`;
            } else {
                action = 'CREATE';
                description = `Created Delivery Challan — ${descParts.join(' | ') || 'New entry'}`;
            }

            records.push({
                id: `dc_${dc.id}`,
                source: 'mobile',
                module: 'DC / Challan',
                action,
                user_id: dc.user_id ? String(dc.user_id) : null,
                username: dc.username || String(dc.user_id) || "Driver",
                fullname: displayName,
                role: role,
                category: 'Wagon',
                description,
                ip_address: '192.168.5.142',
                request_url: '/api/dc/add',
                record_id: String(dc.id),
                created_at: createdAt,
                payload: {
                    id: dc.id,
                    doc_no: dc.doc_no,
                    token_no: dc.token_no,
                    rr_no: dc.rr_no,
                    truck_no: dc.truck_no,
                    status: dc.status,
                    reason: dc.reason,
                    is_arrived: dc.is_arrived,
                    is_send_sap: dc.is_send_sap,
                    user_id: dc.user_id
                }
            });
        });
    } catch (_) {}

    // 2. Purchase Order (public.po)
    try {
        let poSql = `
            SELECT 
                p.id,
                p.po_no,
                p.supplier__id,
                p.bill_no,
                p.rr_no,
                p.materials,
                p.status,
                p.user_id,
                p.po_date,
                p.rr_date,
                p.supplier_invoice_date,
                p.created_at,
                p.updated_at,
                COALESCE(d.username, p.user_id::text) AS username,
                COALESCE(d.fullname, p.user_id::text) AS fullname,
                COALESCE(d.role, 'Accounts') AS role,
                s.name AS supplier_name
            FROM public.po p
            LEFT JOIN public.driver d ON (d.id = p.user_id OR d.username = p.user_id::text OR d.emp_id = p.user_id::text)
            LEFT JOIN public.supplier s ON (s.id = p.supplier__id)
        `;
        const poConditions = [];
        const poParams = [];
        let pIdx = 1;
        if (from) {
            poConditions.push(`COALESCE(p.created_at, p.updated_at) >= $${pIdx}`);
            poParams.push(from);
            pIdx++;
        }
        if (to) {
            poConditions.push(`COALESCE(p.created_at, p.updated_at) <= $${pIdx}`);
            poParams.push(to + " 23:59:59");
            pIdx++;
        }
        if (poConditions.length > 0) poSql += " WHERE " + poConditions.join(" AND ");
        poSql += " ORDER BY COALESCE(p.created_at, p.updated_at) DESC LIMIT 1000";

        const poRows = await query(poSql, poParams);
        poRows.forEach(p => {
            const uKey = (p.username || String(p.user_id) || "").toLowerCase();
            const displayName = userMap[uKey] || userMap[String(p.user_id)] || p.fullname || p.username || "Accounts";
            const role = driverRoleMap[uKey] || p.role || "Accounts";
            const createdAt = p.created_at ? new Date(p.created_at).toISOString() : new Date().toISOString();

            const isUpdated = p.updated_at && p.created_at && (new Date(p.updated_at).getTime() - new Date(p.created_at).getTime() > 2000);
            const action = isUpdated ? 'UPDATE' : 'CREATE';

            const parts = [];
            if (p.po_no) parts.push(`PO No: ${p.po_no}`);
            if (p.bill_no) parts.push(`Bill No: ${p.bill_no}`);
            if (p.rr_no) parts.push(`RR No: ${p.rr_no}`);
            if (p.supplier_name) parts.push(`Supplier: ${p.supplier_name}`);

            records.push({
                id: `po_${p.id}`,
                source: 'mobile',
                module: 'Purchase Order',
                action,
                user_id: p.user_id ? String(p.user_id) : null,
                username: p.username || String(p.user_id) || "Accounts",
                fullname: displayName,
                role: role,
                category: 'Wagon',
                description: `${isUpdated ? 'Updated' : 'Created'} Purchase Order — ${parts.join(' | ') || 'PO recorded'}`,
                ip_address: '192.168.5.142',
                request_url: '/api/po/add',
                record_id: String(p.id),
                created_at: createdAt,
                payload: {
                    id: p.id,
                    po_no: p.po_no,
                    bill_no: p.bill_no,
                    rr_no: p.rr_no,
                    supplier: p.supplier_name,
                    status: p.status,
                    user_id: p.user_id
                }
            });
        });
    } catch (_) {}

    return records;
}

/**
 * Fetch and normalize ALL operational records from Broiler tables
 */
async function fetchBroilerOperationalRecords(userMap, driverRoleMap, from, to) {
    const records = [];

    // 1. Farm Activity
    try {
        let faSql = `
            SELECT
                fa.id,
                fa.user_id,
                COALESCE(d.username, fa.user_id) AS username,
                COALESCE(d.fullname, fa.user_id) AS fullname,
                COALESCE(d.role, 'Supervisor') AS role,
                fa.farmer,
                fa.plant,
                fa.date,
                fa.mortality,
                fa.body_weight,
                fa.batch,
                fa.stock,
                fa.total_farms,
                fa.created_at,
                fa.updated_at
            FROM broiler.farm_activity fa
            LEFT JOIN public.driver d ON (d.username = fa.user_id OR d.id::text = fa.user_id OR d.emp_id = fa.user_id)
        `;
        const faConditions = [];
        const faParams = [];
        let pIdx = 1;
        if (from) {
            faConditions.push(`(fa.created_at >= $${pIdx} OR fa.date >= $${pIdx})`);
            faParams.push(from);
            pIdx++;
        }
        if (to) {
            faConditions.push(`(fa.created_at <= $${pIdx} OR fa.date <= $${pIdx})`);
            faParams.push(to + " 23:59:59");
            pIdx++;
        }
        if (faConditions.length > 0) {
            faSql += " WHERE " + faConditions.join(" AND ");
        }
        faSql += " ORDER BY COALESCE(fa.created_at, fa.date::timestamp) DESC LIMIT 1000";

        const faRows = await query(faSql, faParams);
        faRows.forEach(fa => {
            const uKey = (fa.username || fa.user_id || "").toLowerCase();
            const displayName = userMap[uKey] || userMap[String(fa.user_id)] || fa.fullname || fa.username || "Mobile Supervisor";
            const role = driverRoleMap[uKey] || fa.role || "Supervisor";
            const createdAt = fa.created_at ? new Date(fa.created_at).toISOString() : (fa.date ? new Date(fa.date).toISOString() : new Date().toISOString());

            const parts = [];
            if (fa.farmer) parts.push(`Farmer: ${fa.farmer}`);
            if (fa.plant) parts.push(`Plant: ${fa.plant}`);
            if (fa.mortality !== undefined && fa.mortality !== null) parts.push(`Mortality: ${fa.mortality}`);
            if (fa.body_weight) parts.push(`Body Weight: ${fa.body_weight} kg`);
            if (fa.batch) parts.push(`Batch: ${fa.batch}`);

            records.push({
                id: `fa_${fa.id}`,
                source: 'mobile',
                module: 'Farm Activity',
                action: 'CREATE',
                user_id: fa.user_id ? String(fa.user_id) : null,
                username: fa.username || fa.user_id || "Supervisor",
                fullname: displayName,
                role: role,
                category: 'Broiler',
                description: `Saved Farm Activity Entry — ${parts.join(' | ') || 'Entry recorded'}`,
                ip_address: '192.168.5.142',
                request_url: '/api/broiler/farm-activity/create',
                record_id: String(fa.id),
                created_at: createdAt,
                payload: {
                    id: fa.id,
                    farmer: fa.farmer,
                    plant: fa.plant,
                    date: fa.date,
                    mortality: fa.mortality,
                    body_weight: fa.body_weight,
                    batch: fa.batch,
                    stock: fa.stock,
                    total_farms: fa.total_farms,
                    user_id: fa.user_id
                }
            });
        });
    } catch (_) {}

    // 2. Bill of Supply (broiler.bill_of_supply_dc)
    try {
        let bosSql = `
            SELECT
                b.id,
                b.doc_no,
                b.dc_no,
                b.farmer,
                b.customer,
                b.plant,
                b.bird_stock,
                b.rate,
                b.average_weight,
                b.gross_value,
                b.bill_value,
                b.user_id,
                b.order_by,
                b.dispatch_by,
                b.date,
                b.status,
                b.draft_saved_at,
                b.completed_at,
                b.created_at,
                COALESCE(d.username, b.user_id) AS username,
                COALESCE(d.fullname, b.user_id) AS fullname,
                COALESCE(d.role, 'Supervisor') AS role
            FROM broiler.bill_of_supply_dc b
            LEFT JOIN public.driver d ON (d.username = b.user_id OR d.id::text = b.user_id OR d.emp_id = b.user_id)
        `;
        const bosConditions = [];
        const bosParams = [];
        let pIdx = 1;
        if (from) {
            bosConditions.push(`(b.created_at >= $${pIdx} OR b.date >= $${pIdx})`);
            bosParams.push(from);
            pIdx++;
        }
        if (to) {
            bosConditions.push(`(b.created_at <= $${pIdx} OR b.date <= $${pIdx})`);
            bosParams.push(to + " 23:59:59");
            pIdx++;
        }
        if (bosConditions.length > 0) {
            bosSql += " WHERE " + bosConditions.join(" AND ");
        }
        bosSql += " ORDER BY COALESCE(b.created_at, b.completed_at, b.draft_saved_at, b.date::timestamp) DESC LIMIT 1000";

        const bosRows = await query(bosSql, bosParams);
        bosRows.forEach(b => {
            const rawUser = b.username || b.user_id || b.order_by || b.dispatch_by || "";
            const uKey = rawUser.toLowerCase();
            const displayName = userMap[uKey] || userMap[String(b.user_id)] || b.fullname || rawUser || "Mobile Supervisor";
            const role = driverRoleMap[uKey] || b.role || "Supervisor";
            const createdAt = b.created_at ? new Date(b.created_at).toISOString() : (b.completed_at ? new Date(b.completed_at).toISOString() : (b.date ? new Date(b.date).toISOString() : new Date().toISOString()));

            const parts = [];
            if (b.doc_no || b.dc_no) parts.push(`Doc/DC No: ${b.doc_no || b.dc_no}`);
            if (b.farmer) parts.push(`Farmer: ${b.farmer}`);
            if (b.customer) parts.push(`Customer: ${b.customer}`);
            if (b.plant) parts.push(`Plant: ${b.plant}`);
            if (b.bird_stock) parts.push(`Birds: ${b.bird_stock}`);

            records.push({
                id: `bos_${b.id}`,
                source: 'mobile',
                module: 'Bill of Supply',
                action: 'CREATE',
                user_id: b.user_id ? String(b.user_id) : null,
                username: rawUser || "Supervisor",
                fullname: displayName,
                role: role,
                category: 'Broiler',
                description: `Created Bill of Supply — ${parts.join(' | ') || 'New entry'}`,
                ip_address: '192.168.5.142',
                request_url: '/api/broiler/bill-of-supply/create',
                record_id: String(b.id),
                created_at: createdAt,
                payload: {
                    id: b.id,
                    doc_no: b.doc_no,
                    dc_no: b.dc_no,
                    farmer: b.farmer,
                    customer: b.customer,
                    plant: b.plant,
                    bird_stock: b.bird_stock,
                    rate: b.rate,
                    average_weight: b.average_weight,
                    bill_value: b.bill_value,
                    user_id: b.user_id,
                    status: b.status
                }
            });
        });
    } catch (_) {}

    // 3. Shed Readiness (broiler.shed_ready)
    try {
        let srSql = `
            SELECT
                sr.id,
                sr.farmer,
                sr.plant,
                sr.batch,
                sr.chick_house_capacity,
                sr.user_id,
                sr.date,
                sr.created_at,
                COALESCE(d.username, sr.user_id) AS username,
                COALESCE(d.fullname, sr.user_id) AS fullname,
                COALESCE(d.role, 'Supervisor') AS role
            FROM broiler.shed_ready sr
            LEFT JOIN public.driver d ON (d.username = sr.user_id OR d.id::text = sr.user_id OR d.emp_id = sr.user_id)
        `;
        const srConditions = [];
        const srParams = [];
        let pIdx = 1;
        if (from) {
            srConditions.push(`COALESCE(sr.created_at, sr.date::timestamp) >= $${pIdx}`);
            srParams.push(from);
            pIdx++;
        }
        if (to) {
            srConditions.push(`COALESCE(sr.created_at, sr.date::timestamp) <= $${pIdx}`);
            srParams.push(to + " 23:59:59");
            pIdx++;
        }
        if (srConditions.length > 0) srSql += " WHERE " + srConditions.join(" AND ");
        srSql += " ORDER BY COALESCE(sr.created_at, sr.date::timestamp) DESC LIMIT 500";

        const srRows = await query(srSql, srParams);
        srRows.forEach(sr => {
            const uKey = (sr.username || sr.user_id || "").toLowerCase();
            const displayName = userMap[uKey] || userMap[String(sr.user_id)] || sr.fullname || sr.username || "Mobile Supervisor";
            const role = driverRoleMap[uKey] || sr.role || "Supervisor";
            const createdAt = sr.created_at ? new Date(sr.created_at).toISOString() : (sr.date ? new Date(sr.date).toISOString() : new Date().toISOString());

            const parts = [];
            if (sr.farmer) parts.push(`Farmer: ${sr.farmer}`);
            if (sr.plant) parts.push(`Plant: ${sr.plant}`);
            if (sr.batch) parts.push(`Batch: ${sr.batch}`);
            if (sr.chick_house_capacity) parts.push(`Capacity: ${sr.chick_house_capacity}`);

            records.push({
                id: `sr_${sr.id}`,
                source: 'mobile',
                module: 'Shed Readiness',
                action: 'CREATE',
                user_id: sr.user_id ? String(sr.user_id) : null,
                username: sr.username || sr.user_id || "Supervisor",
                fullname: displayName,
                role: role,
                category: 'Broiler',
                description: `Created Shed Readiness entry — ${parts.join(' | ') || 'New entry'}`,
                ip_address: '192.168.5.142',
                request_url: '/api/broiler/shed-readiness/create',
                record_id: String(sr.id),
                created_at: createdAt,
                payload: {
                    id: sr.id,
                    farmer: sr.farmer,
                    plant: sr.plant,
                    batch: sr.batch,
                    capacity: sr.chick_house_capacity,
                    user_id: sr.user_id
                }
            });
        });
    } catch (_) {}

    // 4. Issue Medicine (broiler.issue_medicine_dc)
    try {
        let imSql = `
            SELECT
                im.id,
                im.doc_no,
                im.farmer_no,
                im.branch,
                im.no_of_chicks,
                im.medicine_issue,
                im.doc_date,
                im.user_id,
                im.created_at,
                COALESCE(d.username, im.user_id) AS username,
                COALESCE(d.fullname, im.user_id) AS fullname,
                COALESCE(d.role, 'Supervisor') AS role
            FROM broiler.issue_medicine_dc im
            LEFT JOIN public.driver d ON (d.username = im.user_id OR d.id::text = im.user_id OR d.emp_id = im.user_id)
        `;
        const imConditions = [];
        const imParams = [];
        let pIdx = 1;
        if (from) {
            imConditions.push(`COALESCE(im.created_at, im.doc_date::timestamp) >= $${pIdx}`);
            imParams.push(from);
            pIdx++;
        }
        if (to) {
            imConditions.push(`COALESCE(im.created_at, im.doc_date::timestamp) <= $${pIdx}`);
            imParams.push(to + " 23:59:59");
            pIdx++;
        }
        if (imConditions.length > 0) imSql += " WHERE " + imConditions.join(" AND ");
        imSql += " ORDER BY COALESCE(im.created_at, im.doc_date::timestamp) DESC LIMIT 500";

        const imRows = await query(imSql, imParams);
        imRows.forEach(im => {
            const uKey = (im.username || im.user_id || "").toLowerCase();
            const displayName = userMap[uKey] || userMap[String(im.user_id)] || im.fullname || im.username || "Mobile Supervisor";
            const role = driverRoleMap[uKey] || im.role || "Supervisor";
            const createdAt = im.created_at ? new Date(im.created_at).toISOString() : (im.doc_date ? new Date(im.doc_date).toISOString() : new Date().toISOString());

            const parts = [];
            if (im.doc_no) parts.push(`Doc No: ${im.doc_no}`);
            if (im.farmer_no) parts.push(`Farmer: ${im.farmer_no}`);
            if (im.branch) parts.push(`Plant: ${im.branch}`);
            if (im.no_of_chicks) parts.push(`Chicks: ${im.no_of_chicks}`);

            records.push({
                id: `im_${im.id}`,
                source: 'mobile',
                module: 'Issue Medicine',
                action: 'CREATE',
                user_id: im.user_id ? String(im.user_id) : null,
                username: im.username || im.user_id || "Supervisor",
                fullname: displayName,
                role: role,
                category: 'Broiler',
                description: `Issued Medicine — ${parts.join(' | ') || 'New entry'}`,
                ip_address: '192.168.5.142',
                request_url: '/api/broiler/issue-medicine/create',
                record_id: String(im.id),
                created_at: createdAt,
                payload: {
                    id: im.id,
                    doc_no: im.doc_no,
                    farmer: im.farmer_no,
                    plant: im.branch,
                    medicine_issue: im.medicine_issue,
                    user_id: im.user_id
                }
            });
        });
    } catch (_) {}

    // 5. Feed Request (broiler.feed_request_dc)
    try {
        let frSql = `
            SELECT
                fr.id,
                fr.doc_no,
                fr.vehicle_no,
                fr.requests,
                fr.delivery_date,
                fr.user_id,
                fr.created_at,
                COALESCE(d.username, fr.user_id) AS username,
                COALESCE(d.fullname, fr.user_id) AS fullname,
                COALESCE(d.role, 'Supervisor') AS role
            FROM broiler.feed_request_dc fr
            LEFT JOIN public.driver d ON (d.username = fr.user_id OR d.id::text = fr.user_id OR d.emp_id = fr.user_id)
        `;
        const frConditions = [];
        const frParams = [];
        let pIdx = 1;
        if (from) {
            frConditions.push(`COALESCE(fr.created_at, fr.delivery_date::timestamp) >= $${pIdx}`);
            frParams.push(from);
            pIdx++;
        }
        if (to) {
            frConditions.push(`COALESCE(fr.created_at, fr.delivery_date::timestamp) <= $${pIdx}`);
            frParams.push(to + " 23:59:59");
            pIdx++;
        }
        if (frConditions.length > 0) frSql += " WHERE " + frConditions.join(" AND ");
        frSql += " ORDER BY COALESCE(fr.created_at, fr.delivery_date::timestamp) DESC LIMIT 500";

        const frRows = await query(frSql, frParams);
        frRows.forEach(fr => {
            const uKey = (fr.username || fr.user_id || "").toLowerCase();
            const displayName = userMap[uKey] || userMap[String(fr.user_id)] || fr.fullname || fr.username || "Mobile Supervisor";
            const role = driverRoleMap[uKey] || fr.role || "Supervisor";
            const createdAt = fr.created_at ? new Date(fr.created_at).toISOString() : new Date().toISOString();

            const parts = [];
            if (fr.doc_no) parts.push(`Doc No: ${fr.doc_no}`);
            if (fr.vehicle_no) parts.push(`Vehicle: ${fr.vehicle_no}`);
            if (fr.delivery_date) parts.push(`Delivery: ${fr.delivery_date}`);

            records.push({
                id: `fr_${fr.id}`,
                source: 'mobile',
                module: 'Feed Request',
                action: 'CREATE',
                user_id: fr.user_id ? String(fr.user_id) : null,
                username: fr.username || fr.user_id || "Supervisor",
                fullname: displayName,
                role: role,
                category: 'Broiler',
                description: `Created Feed Request — ${parts.join(' | ') || 'New feed request'}`,
                ip_address: '192.168.5.142',
                request_url: '/api/broiler/feed-request/create',
                record_id: String(fr.id),
                created_at: createdAt,
                payload: {
                    id: fr.id,
                    doc_no: fr.doc_no,
                    vehicle_no: fr.vehicle_no,
                    delivery_date: fr.delivery_date,
                    requests: fr.requests,
                    user_id: fr.user_id
                }
            });
        });
    } catch (_) {}

    // 6. Feed Transfer (broiler.feed_transfer_dc)
    try {
        let ftSql = `
            SELECT
                ft.id,
                ft.doc_no,
                ft.plant,
                ft.from_farmer,
                ft.to_farmer,
                ft.materials,
                ft.date,
                ft.user_id,
                ft.created_at,
                COALESCE(d.username, ft.user_id) AS username,
                COALESCE(d.fullname, ft.user_id) AS fullname,
                COALESCE(d.role, 'Supervisor') AS role
            FROM broiler.feed_transfer_dc ft
            LEFT JOIN public.driver d ON (d.username = ft.user_id OR d.id::text = ft.user_id OR d.emp_id = ft.user_id)
        `;
        const ftConditions = [];
        const ftParams = [];
        let pIdx = 1;
        if (from) {
            ftConditions.push(`COALESCE(ft.created_at, ft.date::timestamp) >= $${pIdx}`);
            ftParams.push(from);
            pIdx++;
        }
        if (to) {
            ftConditions.push(`COALESCE(ft.created_at, ft.date::timestamp) <= $${pIdx}`);
            ftParams.push(to + " 23:59:59");
            pIdx++;
        }
        if (ftConditions.length > 0) ftSql += " WHERE " + ftConditions.join(" AND ");
        ftSql += " ORDER BY COALESCE(ft.created_at, ft.date::timestamp) DESC LIMIT 500";

        const ftRows = await query(ftSql, ftParams);
        ftRows.forEach(ft => {
            const uKey = (ft.username || ft.user_id || "").toLowerCase();
            const displayName = userMap[uKey] || userMap[String(ft.user_id)] || ft.fullname || ft.username || "Mobile Supervisor";
            const role = driverRoleMap[uKey] || ft.role || "Supervisor";
            const createdAt = ft.created_at ? new Date(ft.created_at).toISOString() : (ft.date ? new Date(ft.date).toISOString() : new Date().toISOString());

            const parts = [];
            if (ft.doc_no) parts.push(`Doc No: ${ft.doc_no}`);
            if (ft.plant) parts.push(`Plant: ${ft.plant}`);
            if (ft.from_farmer) parts.push(`From: ${ft.from_farmer}`);
            if (ft.to_farmer) parts.push(`To: ${ft.to_farmer}`);

            records.push({
                id: `ft_${ft.id}`,
                source: 'mobile',
                module: 'Feed Transfer',
                action: 'CREATE',
                user_id: ft.user_id ? String(ft.user_id) : null,
                username: ft.username || ft.user_id || "Supervisor",
                fullname: displayName,
                role: role,
                category: 'Broiler',
                description: `Created Feed Transfer — ${parts.join(' | ') || 'New transfer'}`,
                ip_address: '192.168.5.142',
                request_url: '/api/broiler/feed-transfer/create',
                record_id: String(ft.id),
                created_at: createdAt,
                payload: {
                    id: ft.id,
                    doc_no: ft.doc_no,
                    plant: ft.plant,
                    from_farmer: ft.from_farmer,
                    to_farmer: ft.to_farmer,
                    materials: ft.materials,
                    user_id: ft.user_id
                }
            });
        });
    } catch (_) {}

    // 7. Feed Return (broiler.feed_return_dc)
    try {
        let fretSql = `
            SELECT
                fret.id,
                fret.plant,
                fret.farmer,
                fret.material,
                fret.quantity,
                fret.date,
                fret.user_id,
                fret.created_at,
                COALESCE(d.username, fret.user_id) AS username,
                COALESCE(d.fullname, fret.user_id) AS fullname,
                COALESCE(d.role, 'Supervisor') AS role
            FROM broiler.feed_return_dc fret
            LEFT JOIN public.driver d ON (d.username = fret.user_id OR d.id::text = fret.user_id OR d.emp_id = fret.user_id)
        `;
        const fretConditions = [];
        const fretParams = [];
        let pIdx = 1;
        if (from) {
            fretConditions.push(`COALESCE(fret.created_at, fret.date::timestamp) >= $${pIdx}`);
            fretParams.push(from);
            pIdx++;
        }
        if (to) {
            fretConditions.push(`COALESCE(fret.created_at, fret.date::timestamp) <= $${pIdx}`);
            fretParams.push(to + " 23:59:59");
            pIdx++;
        }
        if (fretConditions.length > 0) fretSql += " WHERE " + fretConditions.join(" AND ");
        fretSql += " ORDER BY COALESCE(fret.created_at, fret.date::timestamp) DESC LIMIT 500";

        const fretRows = await query(fretSql, fretParams);
        fretRows.forEach(fret => {
            const uKey = (fret.username || fret.user_id || "").toLowerCase();
            const displayName = userMap[uKey] || userMap[String(fret.user_id)] || fret.fullname || fret.username || "Mobile Supervisor";
            const role = driverRoleMap[uKey] || fret.role || "Supervisor";
            const createdAt = fret.created_at ? new Date(fret.created_at).toISOString() : (fret.date ? new Date(fret.date).toISOString() : new Date().toISOString());

            const parts = [];
            if (fret.farmer) parts.push(`Farmer: ${fret.farmer}`);
            if (fret.plant) parts.push(`Plant: ${fret.plant}`);
            if (fret.quantity) parts.push(`Qty: ${fret.quantity}`);
            if (fret.material) parts.push(`Feed: ${fret.material}`);

            records.push({
                id: `fret_${fret.id}`,
                source: 'mobile',
                module: 'Feed Return',
                action: 'CREATE',
                user_id: fret.user_id ? String(fret.user_id) : null,
                username: fret.username || fret.user_id || "Supervisor",
                fullname: displayName,
                role: role,
                category: 'Broiler',
                description: `Returned Feed — ${parts.join(' | ') || 'New return entry'}`,
                ip_address: '192.168.5.142',
                request_url: '/api/broiler/feed-return/create',
                record_id: String(fret.id),
                created_at: createdAt,
                payload: {
                    id: fret.id,
                    farmer: fret.farmer,
                    plant: fret.plant,
                    material: fret.material,
                    quantity: fret.quantity,
                    user_id: fret.user_id
                }
            });
        });
    } catch (_) {}

    // 8. Chick Receipt (broiler.chick_receipt_dc)
    try {
        let crSql = `
            SELECT
                cr.id,
                cr.dc_no,
                cr.plant,
                cr.farmer,
                cr.batch,
                cr.chick_house_quantity,
                cr.remarks,
                cr.user_id,
                cr.created_at,
                COALESCE(d.username, cr.user_id) AS username,
                COALESCE(d.fullname, cr.user_id) AS fullname,
                COALESCE(d.role, 'Supervisor') AS role
            FROM broiler.chick_receipt_dc cr
            LEFT JOIN public.driver d ON (d.username = cr.user_id OR d.id::text = cr.user_id OR d.emp_id = cr.user_id)
        `;
        const crConditions = [];
        const crParams = [];
        let pIdx = 1;
        if (from) {
            crConditions.push(`cr.created_at >= $${pIdx}`);
            crParams.push(from);
            pIdx++;
        }
        if (to) {
            crConditions.push(`cr.created_at <= $${pIdx}`);
            crParams.push(to + " 23:59:59");
            pIdx++;
        }
        if (crConditions.length > 0) crSql += " WHERE " + crConditions.join(" AND ");
        crSql += " ORDER BY cr.created_at DESC LIMIT 500";

        const crRows = await query(crSql, crParams);
        crRows.forEach(cr => {
            const uKey = (cr.username || cr.user_id || "").toLowerCase();
            const displayName = userMap[uKey] || userMap[String(cr.user_id)] || cr.fullname || cr.username || "Mobile Supervisor";
            const role = driverRoleMap[uKey] || cr.role || "Supervisor";
            const createdAt = cr.created_at ? new Date(cr.created_at).toISOString() : new Date().toISOString();

            const parts = [];
            if (cr.dc_no) parts.push(`DC No: ${cr.dc_no}`);
            if (cr.farmer) parts.push(`Farmer: ${cr.farmer}`);
            if (cr.plant) parts.push(`Plant: ${cr.plant}`);
            if (cr.chick_house_quantity) parts.push(`Chicks: ${cr.chick_house_quantity}`);

            records.push({
                id: `cr_${cr.id}`,
                source: 'mobile',
                module: 'Chick Receipt',
                action: 'CREATE',
                user_id: cr.user_id ? String(cr.user_id) : null,
                username: cr.username || cr.user_id || "Supervisor",
                fullname: displayName,
                role: role,
                category: 'Broiler',
                description: `Submitted Chick Receipt — ${parts.join(' | ') || 'New chick receipt'}`,
                ip_address: '192.168.5.142',
                request_url: '/api/broiler/chick-receipt/create',
                record_id: String(cr.id),
                created_at: createdAt,
                payload: {
                    id: cr.id,
                    dc_no: cr.dc_no,
                    farmer: cr.farmer,
                    plant: cr.plant,
                    chicks: cr.chick_house_quantity,
                    batch: cr.batch,
                    remarks: cr.remarks,
                    user_id: cr.user_id
                }
            });
        });
    } catch (_) {}

    return records;
}

/**
 * Fetch and normalize operational records from Breeder tables
 */
async function fetchBreederOperationalRecords(userMap, driverRoleMap, from, to) {
    const records = [];

    // Bio Security (public.bio_security)
    try {
        let bioSql = `
            SELECT 
                b.id,
                b.date,
                b.vehicle_no,
                b.driver_name,
                b.purpose,
                b.user_id,
                b.created_at,
                COALESCE(d.username, b.user_id::text) AS username,
                COALESCE(d.fullname, b.driver_name, b.user_id::text) AS fullname,
                COALESCE(d.role, 'Supervisor') AS role
            FROM public.bio_security b
            LEFT JOIN public.driver d ON (d.id = b.user_id OR d.username = b.user_id::text)
        `;
        const bioConditions = [];
        const bioParams = [];
        let pIdx = 1;
        if (from) {
            bioConditions.push(`COALESCE(b.created_at, b.date::timestamp) >= $${pIdx}`);
            bioParams.push(from);
            pIdx++;
        }
        if (to) {
            bioConditions.push(`COALESCE(b.created_at, b.date::timestamp) <= $${pIdx}`);
            bioParams.push(to + " 23:59:59");
            pIdx++;
        }
        if (bioConditions.length > 0) bioSql += " WHERE " + bioConditions.join(" AND ");
        bioSql += " ORDER BY COALESCE(b.created_at, b.date::timestamp) DESC LIMIT 500";

        const bioRows = await query(bioSql, bioParams);
        bioRows.forEach(b => {
            const uKey = (b.username || String(b.user_id) || "").toLowerCase();
            const displayName = userMap[uKey] || b.fullname || b.username || "Breeder Staff";
            const role = driverRoleMap[uKey] || b.role || "Supervisor";
            const createdAt = b.created_at ? new Date(b.created_at).toISOString() : new Date().toISOString();

            records.push({
                id: `bio_${b.id}`,
                source: 'mobile',
                module: 'Bio Security',
                action: 'CREATE',
                user_id: b.user_id ? String(b.user_id) : null,
                username: b.username || String(b.user_id) || "Staff",
                fullname: displayName,
                role: role,
                category: 'Breeder',
                description: `Created Bio Security entry — Vehicle: ${b.vehicle_no || '-'} | Purpose: ${b.purpose || '-'}`,
                ip_address: '192.168.5.142',
                request_url: '/api/breeder/bioSecurity',
                record_id: String(b.id),
                created_at: createdAt,
                payload: {
                    id: b.id,
                    vehicle_no: b.vehicle_no,
                    purpose: b.purpose,
                    user_id: b.user_id
                }
            });
        });
    } catch (_) {}

    return records;
}

/**
 * Core aggregator function: merges admin_audit_logs + operational tables with robust deduplication and category isolation
 */
async function fetchAndNormalizeActivities({ category = 'Broiler', sourceFilter = 'all', from, to, search, action, module: mod }) {
    const { userMap, driverRoleMap } = await getUserMap();

    // 1. Fetch from public.admin_audit_logs
    let auditConditions = [];
    let auditParams = [];
    let aIdx = 1;

    if (category && category.toLowerCase() !== 'all') {
        auditConditions.push(`LOWER(category) = LOWER($${aIdx++})`);
        auditParams.push(category);
    }
    if (sourceFilter && sourceFilter !== 'all') {
        if (sourceFilter === 'mobile') {
            auditConditions.push(`source = 'mobile'`);
        } else if (sourceFilter === 'admin') {
            auditConditions.push(`(source = 'admin' OR source IS NULL)`);
        }
    }
    if (from) {
        auditConditions.push(`created_at >= $${aIdx++}`);
        auditParams.push(from);
    }
    if (to) {
        auditConditions.push(`created_at <= $${aIdx++}`);
        auditParams.push(to + " 23:59:59");
    }

    const auditWhere = auditConditions.length > 0 ? "WHERE " + auditConditions.join(" AND ") : "";
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
            change_summary,
            details,
            source,
            created_at
        FROM public.admin_audit_logs
        ${auditWhere}
        ORDER BY created_at DESC
        LIMIT 1000
    `;

    const auditLogs = await query(auditSQL, auditParams);

    const combined = [];
    const seenDeduplicationKeys = new Set();

    // Process audit logs first (as primary live audit entries)
    auditLogs.forEach(l => {
        let cleanIp = String(l.ip_address || "127.0.0.1").replace("::ffff:", "").trim();
        if (cleanIp === "::1" || cleanIp === "127.0.0.1") cleanIp = "127.0.0.1";

        const uKey = (l.username || "").toLowerCase();
        const fullname = userMap[uKey] || userMap[String(l.user_id)] || l.username || (l.source === 'mobile' ? 'Mobile Supervisor' : 'Admin User');
        const role = driverRoleMap[uKey] || l.role || (l.source === 'mobile' ? 'Supervisor' : 'Admin');

        // Parse details payload safely
        let payload = null;
        if (l.details) {
            try {
                payload = typeof l.details === 'string' ? JSON.parse(l.details) : l.details;
            } catch (_) {
                payload = l.details;
            }
        }

        // Extract record_id from request_url or payload
        let recordId = null;
        if (l.request_url) {
            const parts = l.request_url.split('?')[0].split('/').filter(Boolean);
            const last = parts[parts.length - 1];
            if (last && /^\d+$/.test(last)) recordId = last;
        }
        if (!recordId && payload && typeof payload === 'object') {
            recordId = payload.id || payload.doc_no || payload.dc_no || payload.po_no || null;
        }

        const normalizedSource = l.source === 'mobile' ? 'mobile' : 'admin';

        // Register deduplication keys
        seenDeduplicationKeys.add(`audit_${l.id}`);
        if (l.module && recordId) {
            seenDeduplicationKeys.add(`${l.module.toLowerCase()}_${recordId}_${l.action}`);
        }
        if (l.module === 'DC / Challan' && payload) {
            if (payload.doc_no) seenDeduplicationKeys.add(`dc_doc_${payload.doc_no}`);
            if (payload.token_no) seenDeduplicationKeys.add(`dc_token_${payload.token_no}`);
            if (payload.id) seenDeduplicationKeys.add(`dc_id_${payload.id}`);
            if (recordId) seenDeduplicationKeys.add(`dc_id_${recordId}`);
        }
        if (l.module === 'Purchase Order' && payload) {
            if (payload.po_no) seenDeduplicationKeys.add(`po_no_${payload.po_no}`);
            if (payload.id) seenDeduplicationKeys.add(`po_id_${payload.id}`);
            if (recordId) seenDeduplicationKeys.add(`po_id_${recordId}`);
        }
        if (l.module === 'Bill of Supply' && payload) {
            if (payload.doc_no) seenDeduplicationKeys.add(`bos_doc_${payload.doc_no}`);
            if (payload.dc_no) seenDeduplicationKeys.add(`bos_doc_${payload.dc_no}`);
            if (payload.id) seenDeduplicationKeys.add(`bos_id_${payload.id}`);
        }
        if (l.module === 'Farm Activity' && payload) {
            if (payload.id) seenDeduplicationKeys.add(`fa_id_${payload.id}`);
            if (recordId) seenDeduplicationKeys.add(`fa_id_${recordId}`);
            const faDate = normalizeDateStr(payload.date) || (l.created_at ? new Date(l.created_at).toISOString().slice(0, 10) : '');
            const plant = String(payload.plant || '').trim().toLowerCase();
            const farmer = String(payload.farmer || '').trim().toLowerCase();
            const uname = String(l.username || '').trim().toLowerCase();
            if (farmer && plant && faDate) {
                seenDeduplicationKeys.add(`fa_${plant}_${farmer}_${faDate}`.toLowerCase());
                if (uname) {
                    seenDeduplicationKeys.add(`fa_${uname}_${plant}_${farmer}_${faDate}`.toLowerCase());
                }
            }
        }

        combined.push({
            id: `audit_${l.id}`,
            source: normalizedSource,
            module: l.module || 'Operations',
            action: l.action || 'UPDATE',
            user_id: l.user_id ? String(l.user_id) : null,
            username: l.username || (normalizedSource === 'mobile' ? 'Supervisor' : 'admin'),
            fullname,
            role,
            category: l.category || category,
            description: (() => {
                let desc = l.change_summary || `${l.action} in ${l.module}`;
                if (l.module === 'Roles & Permissions' && desc.includes('Permissions updated (')) {
                    if (payload && payload.permissions) {
                        const activeSummary = formatActivePermissions(payload.permissions);
                        if (activeSummary) {
                            desc = desc.replace(/\|\s*Permissions updated\s*\(\d+\s*keys\)/, `| Configured: ${activeSummary}`);
                        }
                    }
                }
                return desc;
            })(),
            ip_address: cleanIp,
            request_url: l.request_url,
            record_id: recordId ? String(recordId) : null,
            created_at: l.created_at ? new Date(l.created_at).toISOString() : new Date().toISOString(),
            payload
        });
    });

    // 2. Merge operational tables based strictly on category
    const catLower = (category || 'broiler').toLowerCase();

    if (sourceFilter === 'all' || sourceFilter === 'mobile') {
        const mergeOperational = (opRecords) => {
            opRecords.forEach(rec => {
                // Deduplication checks
                if (seenDeduplicationKeys.has(rec.id)) return;
                if (rec.module && rec.record_id && seenDeduplicationKeys.has(`${rec.module.toLowerCase()}_${rec.record_id}_${rec.action}`)) return;

                if (rec.module === 'DC / Challan' && rec.payload) {
                    if (rec.payload.doc_no && seenDeduplicationKeys.has(`dc_doc_${rec.payload.doc_no}`)) return;
                    if (rec.payload.token_no && seenDeduplicationKeys.has(`dc_token_${rec.payload.token_no}`)) return;
                    if (rec.payload.id && seenDeduplicationKeys.has(`dc_id_${rec.payload.id}`)) return;
                }

                if (rec.module === 'Purchase Order' && rec.payload) {
                    if (rec.payload.po_no && seenDeduplicationKeys.has(`po_no_${rec.payload.po_no}`)) return;
                    if (rec.payload.id && seenDeduplicationKeys.has(`po_id_${rec.payload.id}`)) return;
                }

                if (rec.module === 'Bill of Supply' && rec.payload) {
                    if (rec.payload.doc_no && seenDeduplicationKeys.has(`bos_doc_${rec.payload.doc_no}`)) return;
                    if (rec.payload.dc_no && seenDeduplicationKeys.has(`bos_doc_${rec.payload.dc_no}`)) return;
                    if (rec.payload.id && seenDeduplicationKeys.has(`bos_id_${rec.payload.id}`)) return;
                }

                if (rec.module === 'Farm Activity' && rec.payload) {
                    if (rec.payload.id && seenDeduplicationKeys.has(`fa_id_${rec.payload.id}`)) return;
                    if (rec.record_id && seenDeduplicationKeys.has(`fa_id_${rec.record_id}`)) return;
                    const faDate = normalizeDateStr(rec.payload.date) || (rec.created_at ? new Date(rec.created_at).toISOString().slice(0, 10) : '');
                    const plant = String(rec.payload.plant || '').trim().toLowerCase();
                    const farmer = String(rec.payload.farmer || '').trim().toLowerCase();
                    const uname = String(rec.username || '').trim().toLowerCase();
                    if (farmer && plant && faDate) {
                        if (seenDeduplicationKeys.has(`fa_${plant}_${farmer}_${faDate}`.toLowerCase())) return;
                        if (uname && seenDeduplicationKeys.has(`fa_${uname}_${plant}_${farmer}_${faDate}`.toLowerCase())) return;
                    }
                }

                // Not a duplicate: register and add
                seenDeduplicationKeys.add(rec.id);
                combined.push(rec);
            });
        };

        if (catLower === 'wagon' || catLower === 'all') {
            const wagonRecords = await fetchWagonOperationalRecords(userMap, driverRoleMap, from, to);
            mergeOperational(wagonRecords);
        }

        if (catLower === 'broiler' || catLower === 'all') {
            const broilerRecords = await fetchBroilerOperationalRecords(userMap, driverRoleMap, from, to);
            mergeOperational(broilerRecords);
        }

        if (catLower === 'breeder' || catLower === 'all') {
            const breederRecords = await fetchBreederOperationalRecords(userMap, driverRoleMap, from, to);
            mergeOperational(breederRecords);
        }
    }

    // 3. Sort descending by created_at
    combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // 4. Strict Category Guard: Ensure only matching category logs are returned
    let filtered = combined;
    if (category && category.toLowerCase() !== 'all') {
        filtered = filtered.filter(item => item.category && item.category.toLowerCase() === category.toLowerCase());
    }

    // 5. Apply Filters: Action, Module, Search
    if (action && action !== 'all') {
        filtered = filtered.filter(item => String(item.action).toUpperCase() === String(action).toUpperCase());
    }

    if (mod && mod !== 'all') {
        const modLower = mod.toLowerCase();
        filtered = filtered.filter(item => item.module && item.module.toLowerCase().includes(modLower));
    }

    if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(item =>
            (item.username && item.username.toLowerCase().includes(q)) ||
            (item.fullname && item.fullname.toLowerCase().includes(q)) ||
            (item.role && item.role.toLowerCase().includes(q)) ||
            (item.module && item.module.toLowerCase().includes(q)) ||
            (item.action && item.action.toLowerCase().includes(q)) ||
            (item.description && item.description.toLowerCase().includes(q)) ||
            (item.ip_address && item.ip_address.toLowerCase().includes(q)) ||
            (item.request_url && item.request_url.toLowerCase().includes(q))
        );
    }

    // Calculate sub-totals for KPI metrics based on category-filtered dataset
    const catBase = category && category.toLowerCase() !== 'all'
        ? combined.filter(item => item.category && item.category.toLowerCase() === category.toLowerCase())
        : combined;

    const mobileCount = catBase.filter(i => i.source === 'mobile').length;
    const adminCount = catBase.filter(i => i.source === 'admin').length;

    return {
        activities: filtered,
        total: filtered.length,
        mobileTotal: mobileCount,
        adminTotal: adminCount
    };
}

/**
 * GET /api/admin/activity-logs/all
 * Returns unified stream of ALL activities (Mobile + Admin), sorted by created_at DESC with full deduplication.
 */
exports.getAllActivityLogs = async (req, res) => {
    try {
        const {
            category = 'Broiler',
            source = 'all',
            from,
            to,
            search,
            action,
            module: mod,
            limit = 200,
            offset = 0
        } = req.query;

        const result = await fetchAndNormalizeActivities({
            category,
            sourceFilter: source,
            from,
            to,
            search,
            action,
            module: mod
        });

        const start = Number(offset) || 0;
        const end = start + (Number(limit) || 200);
        const paginated = result.activities.slice(start, end);

        return res.status(200).json({
            status: true,
            data: {
                activities: paginated,
                total: result.total,
                mobileTotal: result.mobileTotal,
                adminTotal: result.adminTotal,
                limit: Number(limit),
                offset: Number(offset)
            }
        });

    } catch (error) {
        console.error("Error fetching all activity logs:", error);
        return res.status(500).json({
            status: false,
            message: "Error fetching activity logs",
            error: error.message
        });
    }
};

/**
 * GET /api/admin/activity-logs/mobile
 * Returns normalized mobile application activities.
 */
exports.getMobileActivity = async (req, res) => {
    try {
        const {
            category = 'Broiler',
            from,
            to,
            search,
            action,
            module: mod,
            limit = 200,
            offset = 0
        } = req.query;

        const result = await fetchAndNormalizeActivities({
            category,
            sourceFilter: 'mobile',
            from,
            to,
            search,
            action,
            module: mod
        });

        const start = Number(offset) || 0;
        const end = start + (Number(limit) || 200);
        const paginated = result.activities.slice(start, end);

        return res.status(200).json({
            status: true,
            data: {
                activities: paginated,
                total: result.total,
                mobileTotal: result.mobileTotal,
                adminTotal: result.adminTotal,
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
 * Returns normalized admin audit logs.
 */
exports.getAdminAuditLog = async (req, res) => {
    try {
        const {
            category = 'Broiler',
            from,
            to,
            search,
            action,
            module: mod,
            limit = 200,
            offset = 0
        } = req.query;

        const result = await fetchAndNormalizeActivities({
            category,
            sourceFilter: 'admin',
            from,
            to,
            search,
            action,
            module: mod
        });

        const start = Number(offset) || 0;
        const end = start + (Number(limit) || 200);
        const paginated = result.activities.slice(start, end);

        return res.status(200).json({
            status: true,
            data: {
                activities: paginated,
                total: result.total,
                mobileTotal: result.mobileTotal,
                adminTotal: result.adminTotal,
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
