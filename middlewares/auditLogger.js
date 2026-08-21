const jwt = require("jsonwebtoken");
const os = require("os");
const { query } = require("../config/db");

const JWT_SECRET = process.env.JWT_SECRET || "default_jwt_secret";

// In-memory sliding deduplication cache (2.5 seconds window)
const recentLogCache = new Map();
const DEDUP_WINDOW_MS = 2500;

function isDuplicate(key) {
    const now = Date.now();
    const lastTime = recentLogCache.get(key);
    if (lastTime && (now - lastTime) < DEDUP_WINDOW_MS) {
        return true;
    }
    recentLogCache.set(key, now);
    // Cleanup old keys periodically
    if (recentLogCache.size > 1000) {
        for (const [k, time] of recentLogCache.entries()) {
            if (now - time > DEDUP_WINDOW_MS * 2) {
                recentLogCache.delete(k);
            }
        }
    }
    return false;
}

/**
 * Extract clean, exact client IP address
 */
function getCleanIpAddress(req) {
    let rawIp =
        req.headers["cf-connecting-ip"] ||
        req.headers["x-real-ip"] ||
        req.headers["x-client-ip"] ||
        req.headers["true-client-ip"] ||
        (req.headers["x-forwarded-for"] ? req.headers["x-forwarded-for"].split(",")[0].trim() : null) ||
        req.ip ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        "";

    let clean = String(rawIp).trim().replace(/^::ffff:/, "");
    if (clean === "::1" || clean === "localhost") {
        clean = "127.0.0.1";
    }
    return clean || "127.0.0.1";
}

/**
 * Check if the request should be skipped from audit logging
 */
function shouldSkipAudit(method, cleanUrl) {
    const mutateMethods = ["POST", "PUT", "PATCH", "DELETE"];
    if (!mutateMethods.includes(method)) return true;

    // 1. Auth & Login endpoints
    if (cleanUrl.endsWith("/login") || cleanUrl.includes("/auth/login")) return true;

    // 2. Database maintenance endpoints
    if (cleanUrl.includes("/db/add-unique-constrains")) return true;

    // 3. DC View/Preview PDF (POST used for rendering PDF view without any DB mutations)
    if (cleanUrl.includes("/dc/getchallanbyview") || cleanUrl.endsWith("/getchallanbyview")) return true;

    // 4. Activity log queries
    if (cleanUrl.includes("/activity-logs")) return true;

    return false;
}

/**
 * Resolve Category (Broiler, Wagon, Breeder)
 */
function resolveCategory(req, decodedCategory = null) {
    if (req.headers && req.headers["x-admin-category"]) {
        const cat = String(req.headers["x-admin-category"]).trim();
        if (cat) return cat.charAt(0).toUpperCase() + cat.slice(1).toLowerCase();
    }
    if (decodedCategory) {
        return String(decodedCategory).charAt(0).toUpperCase() + String(decodedCategory).slice(1).toLowerCase();
    }
    if (req.body?.category) {
        return String(req.body.category).charAt(0).toUpperCase() + String(req.body.category).slice(1).toLowerCase();
    }
    const cleanUrl = (req.originalUrl || "").toLowerCase();
    if (
        cleanUrl.includes("/wagon") ||
        cleanUrl.includes("/dc") ||
        cleanUrl.includes("/po") ||
        cleanUrl.includes("/supplier") ||
        cleanUrl.includes("/material") ||
        cleanUrl.includes("/shipping") ||
        cleanUrl.includes("/source") ||
        cleanUrl.includes("/unit")
    ) {
        return "Wagon";
    }
    if (
        cleanUrl.includes("/breeder") ||
        cleanUrl.includes("/bio-security") ||
        cleanUrl.includes("/biosecurity") ||
        cleanUrl.includes("/feed-details")
    ) {
        return "Breeder";
    }
    return "Broiler";
}

/**
 * Resolve Module Name
 */
function resolveModule(url = "") {
    const clean = url.toLowerCase();
    if (clean.includes("/admin/change-password")) return "Admin Password";
    if (clean.includes("/driver/change-password")) return "Mobile Password";
    if (clean.includes("/admin/")) return "Admin Users";
    if (clean.includes("/driver/")) return "Mobile Users";
    if (clean.includes("/roles")) return "Roles & Permissions";

    // Broiler routes (Order specific sub-modules first)
    if (clean.includes("/farm-activity")) return "Farm Activity";
    if (clean.includes("/shed-readiness")) return "Shed Readiness";
    if (clean.includes("/issue-medicine")) return "Issue Medicine";
    if (clean.includes("/feed-request")) return "Feed Request";
    if (clean.includes("/feedapproval") || clean.includes("/feed-approval")) return "Feed Approval";
    if (clean.includes("/feed-transfer")) return "Feed Transfer";
    if (clean.includes("/feed-return")) return "Feed Return";
    if (clean.includes("/bill-of-supply")) return "Bill of Supply";
    if (clean.includes("/farmer-location")) return "Farmer Location Master";
    if (clean.includes("/farmer-line")) return "Farmer Line Master";
    if (clean.includes("/line-farm")) return "Line Farm Master";
    if (clean.includes("/geofence-config")) return "Geofence Config";
    if (clean.includes("/chick-receipt")) return "Chick Receipt";
    if (clean.includes("/sap-post-date-config")) return "SAP Post Date Config";
    if (clean.includes("/tentative-rate")) return "Tentative Rate";
    if (clean.includes("/plant")) return "Plant Master";
    if (clean.includes("/farmer")) return "Farmer Master";
    if (clean.includes("/line")) return "Line Master";
    if (clean.includes("/sap")) return "SAP Integration";

    // Breeder routes
    if (clean.includes("/biosecurity") || clean.includes("/bio-security")) return "Bio Security";
    if (clean.includes("/feed-details")) return "Feed Details";

    // Wagon routes
    if (clean.includes("/material")) return "Material Master";
    if (clean.includes("/supplier")) return "Supplier Master";
    if (clean.includes("/shipping")) return "Shipping Master";
    if (clean.includes("/source")) return "Source Location";
    if (clean.includes("/unit")) return "Unit Master";
    if (clean.includes("/po")) return "Purchase Order";
    if (clean.includes("/dc")) return "DC / Challan";
    if (clean.includes("/reports")) return "Reports & Dispatch";

    return "Operations";
}

/**
 * Identify Action
 */
function resolveAction(method = "", url = "") {
    const clean = url.toLowerCase();
    if (
        clean.includes("/remove") ||
        clean.includes("/delete") ||
        clean.includes("/reassignanddelete") ||
        method.toUpperCase() === "DELETE"
    ) {
        return "DELETE";
    }
    if (clean.includes("/canceldc") || clean.includes("/cancel-dc") || clean.includes("/cancel")) {
        return "CANCEL";
    }
    if (clean.includes("/send-to-sap") || clean.includes("/sync-sap")) {
        return "SYNC";
    }
    switch (method.toUpperCase()) {
        case "POST":   return "CREATE";
        case "PUT":    return "UPDATE";
        case "PATCH":  return "UPDATE";
        case "DELETE": return "DELETE";
        default:       return method.toUpperCase();
    }
}

/**
 * Resolve Source: 'admin' vs 'mobile'
 */
function resolveSource(req, role = "") {
    const url = (req.originalUrl || "").toLowerCase();
    const roleLower = String(role || "").toLowerCase();

    // 1. Explicit admin headers sent by Admin Panel Axios interceptor
    if (req.headers && (req.headers["x-admin-user"] || req.headers["x-admin-role"])) {
        return "admin";
    }

    // 2. Admin URL routes (pure admin-only endpoints)
    if (
        url.startsWith("/api/admin") ||
        url.startsWith("/api/roles") ||
        url.startsWith("/api/po") ||
        url.startsWith("/api/material") ||
        url.startsWith("/api/supplier") ||
        url.startsWith("/api/shipping") ||
        url.startsWith("/api/source") ||
        url.startsWith("/api/unit") ||
        url.startsWith("/api/reports")
    ) {
        return "admin";
    }

    // DC routes: add/update/cancel/getChallan are admin-only
    // BUT arrived toggle is called from Wagon mobile app (no x-admin headers)
    if (url.startsWith("/api/dc")) {
        if (url.includes("/arrived/")) {
            return "mobile"; // Wagon mobile marks DC as arrived
        }
        return "admin"; // All other DC operations are admin panel
    }

    // 3. Mobile app routes — ALL broiler/breeder/driver routes WITHOUT admin headers are mobile
    if (
        url.includes("/api/broiler/") ||
        url.includes("/api/breeder/") ||
        url.includes("/api/driver/")
    ) {
        return "mobile";
    }

    // 4. Role based fallback
    if (roleLower.includes("supervisor") || roleLower.includes("driver")) {
        return "mobile";
    }

    return "admin";
}

/**
 * Generate specific description of WHAT changed
 */
function generateChangeSummary(req, action, moduleName) {
    const body = req.body || {};
    const url = req.originalUrl || "";
    const cleanUrl = url.toLowerCase();

    // Extract ID from URL
    const urlParts = url.split("?")[0].split("/").filter(Boolean);
    const targetId = urlParts[urlParts.length - 1] || "";

    // 1. PASSWORD CHANGES
    if (cleanUrl.includes("/change-password")) {
        if (cleanUrl.includes("/driver/")) {
            return `Mobile user password changed (User ID: #${targetId})`;
        }
        return `Admin account password changed (User ID: #${targetId})`;
    }

    // 2. MOBILE USERS
    if (moduleName === "Mobile Users") {
        const name = body.fullname || body.username || `User #${targetId}`;
        const category = body.category || "";
        if (action === "DELETE") {
            return `Deleted mobile user account (User ID: #${targetId})`;
        }
        if (action === "CREATE") {
            const parts = [`Name: ${name}`];
            if (body.username) parts.push(`Username: ${body.username}`);
            if (body.role) parts.push(`Role: ${body.role}`);
            if (category) parts.push(`Category: ${category}`);
            return `Registered new mobile user — ${parts.join(" | ")}`;
        }
        if (action === "UPDATE") {
            return `__MOBILE_UPDATE__#${targetId}`;
        }
    }

    // 3. ADMIN USERS
    if (moduleName === "Admin Users") {
        if (action === "CREATE") {
            const parts = [];
            const name = body.first_name
                ? `${body.first_name}${body.last_name ? " " + body.last_name : ""}`
                : body.username || "New Admin";
            parts.push(`Name: ${name}`);
            if (body.username) parts.push(`Username: ${body.username}`);
            if (body.role) parts.push(`Role: ${body.role}`);
            if (body.category) parts.push(`Category: ${body.category}`);
            if (body.email) parts.push(`Email: ${body.email}`);
            return `Created admin user — ${parts.join(" | ")}`;
        }
        if (action === "UPDATE") {
            const parts = [];
            const name = body.first_name
                ? `${body.first_name}${body.last_name ? " " + body.last_name : ""}`
                : null;
            if (name) parts.push(`Name: ${name}`);
            if (body.username) parts.push(`Username: ${body.username}`);
            if (body.role) parts.push(`Role: ${body.role}`);
            if (body.category) parts.push(`Category: ${body.category}`);
            if (body.email) parts.push(`Email: ${body.email}`);
            if (body.status !== undefined) parts.push(`Status: ${body.status ? "Active" : "Inactive"}`);
            return `Updated admin user #${targetId} — ${parts.join(" | ") || "Details updated"}`;
        }
        if (action === "DELETE") {
            return `Deleted admin user account (User ID: #${targetId})`;
        }
    }

    // 4. ROLES & PERMISSIONS
    if (moduleName === "Roles & Permissions") {
        const roleName = body.role_name || body.name || `Role #${targetId}`;
        const category = body.category || "";
        if (cleanUrl.includes("/reassignanddelete")) {
            return `Reassigned & Deleted role (ID: #${targetId})`;
        }
        if (action === "CREATE") {
            return `Created new role "${roleName}"${category ? ` for ${category}` : ""}`;
        }
        if (action === "UPDATE") {
            const perms = body.permissions
                ? ` | Permissions updated (${Array.isArray(body.permissions) ? body.permissions.length : 1} keys)`
                : "";
            return `Updated role "${roleName}"${category ? ` (${category})` : ""}${perms}`;
        }
        if (action === "DELETE") {
            return `Deleted role (ID: #${targetId})`;
        }
    }

    // 5. DC / DELIVERY CHALLAN (Wagon)
    if (moduleName === "DC / Challan") {
        if (cleanUrl.includes("/canceldc") || cleanUrl.includes("/cancel-dc") || action === "CANCEL") {
            const reason = body.reason || body.cancel_reason || "";
            return `Cancelled DC/Challan #${targetId}${reason ? ` — Reason: "${reason}"` : ""}`;
        }
        if (cleanUrl.includes("/arrived/")) {
            const arrivedVal = body.status !== undefined ? body.status : body.arrived;
            let arrivedLabel;
            if (arrivedVal === 3 || arrivedVal === "3") arrivedLabel = "Arrived";
            else if (arrivedVal === 1 || arrivedVal === "1") arrivedLabel = "Active";
            else if (arrivedVal === 0 || arrivedVal === "0") arrivedLabel = "Deleted";
            else arrivedLabel = String(arrivedVal);
            return `DC/Challan #${targetId} marked as ${arrivedLabel}`;
        }
        if (action === "CREATE") {
            const parts = [];
            const dcData = body.dcData || body;
            if (dcData.token_no) parts.push(`Token: ${dcData.token_no}`);
            if (dcData.rr_no) parts.push(`RR No: ${dcData.rr_no}`);
            if (dcData.truck_no) parts.push(`Truck: ${dcData.truck_no}`);
            if (dcData.doc_no) parts.push(`Doc No: ${dcData.doc_no}`);
            if (Array.isArray(dcData.materials) && dcData.materials.length > 0) {
                const matNames = dcData.materials.map(m => m.name || m.mat_id).join(", ");
                parts.push(`Materials: ${matNames}`);
            }
            return `Created new DC/Challan — ${parts.join(" | ") || "New delivery challan entry"}`;
        }
        if (action === "UPDATE") {
            const parts = [];
            if (body.dc_no || body.challan_no) parts.push(`DC No: ${body.dc_no || body.challan_no}`);
            if (body.truck_no) parts.push(`Truck: ${body.truck_no}`);
            if (body.status !== undefined) parts.push(`Status: ${body.status}`);
            return `Updated DC/Challan #${targetId} — ${parts.join(" | ") || "Details updated"}`;
        }
        if (action === "DELETE") {
            return `Deleted DC/Challan #${targetId}`;
        }
    }

    // 6. PURCHASE ORDER (Wagon)
    if (moduleName === "Purchase Order") {
        if (action === "CREATE") {
            const parts = [];
            if (body.po_no) parts.push(`PO No: ${body.po_no}`);
            if (body.bill_no) parts.push(`Bill No: ${body.bill_no}`);
            if (body.rr_no) parts.push(`RR No: ${body.rr_no}`);
            if (body.po_date) parts.push(`PO Date: ${body.po_date}`);
            if (Array.isArray(body.materials)) parts.push(`Materials: ${body.materials.length} item(s)`);
            return `Created Purchase Order — ${parts.join(" | ") || "New PO entry"}`;
        }
        if (action === "UPDATE") {
            const parts = [];
            if (body.po_no) parts.push(`PO No: ${body.po_no}`);
            if (body.bill_no) parts.push(`Bill No: ${body.bill_no}`);
            if (body.rr_no) parts.push(`RR No: ${body.rr_no}`);
            if (body.status !== undefined) parts.push(`Status: ${body.status}`);
            return `Updated Purchase Order #${targetId} — ${parts.join(" | ") || "Details updated"}`;
        }
        if (action === "DELETE") {
            return `Deleted Purchase Order #${targetId}`;
        }
    }

    // 7. MATERIAL MASTER
    if (moduleName === "Material Master") {
        const matName = body.name || body.material_name || `Material #${targetId}`;
        if (action === "CREATE") {
            const parts = [`Name: ${matName}`];
            if (body.material_code) parts.push(`Code: ${body.material_code}`);
            if (body.hsn_code) parts.push(`HSN: ${body.hsn_code}`);
            return `Created Material — ${parts.join(" | ")}`;
        }
        if (action === "UPDATE") {
            const parts = [`Name: ${matName}`];
            if (body.material_code) parts.push(`Code: ${body.material_code}`);
            if (body.status !== undefined) parts.push(`Status: ${body.status ? "Active" : "Inactive"}`);
            return `Updated Material "${matName}" (ID: #${targetId}) — ${parts.join(" | ")}`;
        }
        if (action === "DELETE") {
            return `Deleted Material (ID: #${targetId})`;
        }
    }

    // 8. SUPPLIER MASTER
    if (moduleName === "Supplier Master") {
        const supplierName = body.name || body.supplier_name || `Supplier #${targetId}`;
        if (action === "CREATE") {
            const parts = [`Name: ${supplierName}`];
            if (body.gst_no || body.gstin) parts.push(`GST: ${body.gst_no || body.gstin}`);
            if (body.state) parts.push(`State: ${body.state}`);
            return `Created Supplier — ${parts.join(" | ")}`;
        }
        if (action === "UPDATE") {
            const parts = [`Name: ${supplierName}`];
            if (body.status !== undefined) parts.push(`Status: ${body.status ? "Active" : "Inactive"}`);
            return `Updated Supplier "${supplierName}" (ID: #${targetId}) — ${parts.join(" | ")}`;
        }
        if (action === "DELETE") {
            return `Deleted Supplier (ID: #${targetId})`;
        }
    }

    // 9. SHIPPING MASTER
    if (moduleName === "Shipping Master") {
        const shipName = body.sap_name || body.name || body.address || `Shipping #${targetId}`;
        if (action === "CREATE") {
            const parts = [`Name: ${shipName}`];
            if (body.sap_code) parts.push(`SAP Code: ${body.sap_code}`);
            return `Created Shipping Address — ${parts.join(" | ")}`;
        }
        if (action === "UPDATE") {
            const parts = [`Name: ${shipName}`];
            if (body.status !== undefined) parts.push(`Status: ${body.status ? "Active" : "Inactive"}`);
            return `Updated Shipping Address "${shipName}" (ID: #${targetId}) — ${parts.join(" | ")}`;
        }
        if (action === "DELETE") {
            return `Deleted Shipping Address (ID: #${targetId})`;
        }
    }

    // 10. SOURCE LOCATION
    if (moduleName === "Source Location") {
        const sourceName = body.name || body.location_name || `Location #${targetId}`;
        if (action === "CREATE") {
            const parts = [`Name: ${sourceName}`];
            if (body.code) parts.push(`Code: ${body.code}`);
            return `Created Source Location — ${parts.join(" | ")}`;
        }
        if (action === "UPDATE") {
            const parts = [`Name: ${sourceName}`];
            if (body.status !== undefined) parts.push(`Status: ${body.status ? "Active" : "Inactive"}`);
            return `Updated Source Location "${sourceName}" (ID: #${targetId}) — ${parts.join(" | ")}`;
        }
        if (action === "DELETE") {
            return `Deleted Source Location (ID: #${targetId})`;
        }
    }

    // 11. UNIT MASTER
    if (moduleName === "Unit Master") {
        const unitName = body.name || body.unit_name || `Unit #${targetId}`;
        if (action === "CREATE") {
            return `Created Unit "${unitName}"${body.symbol ? ` (Symbol: ${body.symbol})` : ""}`;
        }
        if (action === "UPDATE") {
            const parts = [`Name: ${unitName}`];
            if (body.symbol) parts.push(`Symbol: ${body.symbol}`);
            if (body.status !== undefined) parts.push(`Status: ${body.status ? "Active" : "Inactive"}`);
            return `Updated Unit "${unitName}" (ID: #${targetId}) — ${parts.join(" | ")}`;
        }
        if (action === "DELETE") {
            return `Deleted Unit (ID: #${targetId})`;
        }
    }

    // 12. REPORTS & DISPATCH (SAP)
    if (moduleName === "Reports & Dispatch" || cleanUrl.includes("/reports")) {
        if (cleanUrl.includes("/send-to-sap")) {
            return `Dispatched / Sent DC #${targetId} to SAP`;
        }
    }

    // 13. FARM ACTIVITY (Broiler Mobile)
    if (moduleName === "Farm Activity") {
        if (action === "DELETE") {
            return `Deleted Farm Activity entry #${targetId}`;
        }
        if (action === "SUBMIT") {
            // /submit endpoint: finalizes the day's entries
            const parts = [];
            if (body.date) parts.push(`Date: ${body.date}`);
            if (body.plant) parts.push(`Plant: ${body.plant}`);
            if (body.user_id) parts.push(`User: ${body.user_id}`);
            return `Submitted Farm Activity Report — ${parts.join(" | ") || "Day finalized"}`;
        }
        const parts = [];
        if (body.farmer || body.farmer_name) parts.push(`Farmer: ${body.farmer || body.farmer_name}`);
        if (body.plant || body.plant_name) parts.push(`Plant: ${body.plant || body.plant_name}`);
        if (body.date) parts.push(`Date: ${body.date}`);
        if (body.mortality !== undefined) parts.push(`Mortality: ${body.mortality}`);
        if (body.body_weight !== undefined) parts.push(`Body Weight: ${body.body_weight}`);
        if (body.batch) parts.push(`Batch: ${body.batch}`);
        if (action === "UPDATE") {
            return `Updated Farm Activity #${targetId} — ${parts.join(" | ") || "Details updated"}`;
        }
        return `Submitted Farm Activity — ${parts.join(" | ") || "New entry created"}`;
    }

    // 14. SHED READINESS (Broiler)
    if (moduleName === "Shed Readiness") {
        if (action === "DELETE") return `Deleted Shed Readiness entry #${targetId}`;
        const parts = [];
        if (body.farmer || body.farmer_name) parts.push(`Farmer: ${body.farmer || body.farmer_name}`);
        if (body.plant || body.plant_name) parts.push(`Plant: ${body.plant || body.plant_name}`);
        if (body.status) parts.push(`Status: ${body.status}`);
        if (action === "UPDATE") return `Updated Shed Readiness #${targetId} — ${parts.join(" | ") || "Details updated"}`;
        return `Created Shed Readiness entry — ${parts.join(" | ") || "New entry"}`;
    }

    // 15. ISSUE MEDICINE (Broiler)
    if (moduleName === "Issue Medicine") {
        if (action === "DELETE") return `Deleted Issued Medicine entry #${targetId}`;
        const parts = [];
        if (body.farmer || body.farmer_name) parts.push(`Farmer: ${body.farmer || body.farmer_name}`);
        if (body.medicine_name || body.item_name) parts.push(`Medicine: ${body.medicine_name || body.item_name}`);
        if (body.quantity || body.qty) parts.push(`Qty: ${body.quantity || body.qty}`);
        if (action === "UPDATE") return `Updated Issued Medicine #${targetId} — ${parts.join(" | ") || "Details updated"}`;
        return `Created Issued Medicine entry — ${parts.join(" | ") || "New entry"}`;
    }

    // 16. FEED REQUEST (Broiler)
    if (moduleName === "Feed Request") {
        if (action === "DELETE") return `Deleted Feed Request #${targetId}`;
        const parts = [];
        if (body.farmer || body.farmer_name) parts.push(`Farmer: ${body.farmer || body.farmer_name}`);
        if (body.plant || body.plant_id) parts.push(`Plant: ${body.plant || body.plant_id}`);
        if (body.quantity || body.requested_qty) parts.push(`Qty: ${body.quantity || body.requested_qty}`);
        if (action === "UPDATE") return `Updated Feed Request #${targetId} — ${parts.join(" | ") || "Request updated"}`;
        return `Created Feed Request — ${parts.join(" | ") || "New feed request"}`;
    }

    // 17. FEED APPROVAL (Broiler)
    if (moduleName === "Feed Approval") {
        if (action === "DELETE") return `Deleted Feed Approval #${targetId}`;
        const parts = [];
        const approvalStatus = body.status || body.approval_status || body.is_approved;
        let statusLabel = "";
        if (approvalStatus === 1 || approvalStatus === "1" || approvalStatus === "approved" || approvalStatus === true) statusLabel = "Approved";
        else if (approvalStatus === 0 || approvalStatus === "0" || approvalStatus === "rejected" || approvalStatus === false) statusLabel = "Rejected";
        else if (approvalStatus !== undefined) statusLabel = String(approvalStatus);
        if (statusLabel) parts.push(`Status: ${statusLabel}`);
        if (body.remarks || body.reason) parts.push(`Remarks: ${body.remarks || body.reason}`);
        if (body.quantity || body.approved_qty) parts.push(`Approved Qty: ${body.quantity || body.approved_qty}`);
        if (action === "UPDATE") return `Feed Approval #${targetId} — ${parts.join(" | ") || "Approval updated"}`;
        return `Created Feed Approval — ${parts.join(" | ") || "New approval"}`;
    }

    // 18. FEED TRANSFER (Broiler)
    if (moduleName === "Feed Transfer") {
        if (action === "DELETE") return `Deleted Feed Transfer #${targetId}`;
        const parts = [];
        if (body.from_plant || body.from_location) parts.push(`From: ${body.from_plant || body.from_location}`);
        if (body.to_plant || body.to_location) parts.push(`To: ${body.to_plant || body.to_location}`);
        if (body.quantity || body.transfer_qty) parts.push(`Qty: ${body.quantity || body.transfer_qty}`);
        if (action === "UPDATE") return `Updated Feed Transfer #${targetId} — ${parts.join(" | ") || "Transfer updated"}`;
        return `Created Feed Transfer — ${parts.join(" | ") || "New transfer"}`;
    }

    // 19. FEED RETURN (Broiler)
    if (moduleName === "Feed Return") {
        if (action === "DELETE") return `Deleted Feed Return #${targetId}`;
        const parts = [];
        if (body.farmer || body.farmer_name) parts.push(`Farmer: ${body.farmer || body.farmer_name}`);
        if (body.plant || body.plant_id) parts.push(`Plant: ${body.plant || body.plant_id}`);
        if (body.quantity || body.return_qty) parts.push(`Qty: ${body.quantity || body.return_qty}`);
        if (body.feed_type || body.feed_name) parts.push(`Feed: ${body.feed_type || body.feed_name}`);
        if (body.reason) parts.push(`Reason: ${body.reason}`);
        if (action === "UPDATE") return `Updated Feed Return #${targetId} — ${parts.join(" | ") || "Return updated"}`;
        return `Returned Feed — ${parts.join(" | ") || "New return entry"}`;
    }

    // 20. BILL OF SUPPLY (Broiler Mobile)
    if (moduleName === "Bill of Supply") {
        if (action === "DELETE") return `Deleted Bill of Supply #${targetId}`;
        if (cleanUrl.includes("/draft")) {
            if (action === "DELETE") return `Deleted Bill of Supply Draft #${targetId}`;
            if (cleanUrl.includes("/complete-draft")) return `Completed Bill of Supply Draft #${targetId}`;
            return `Saved Bill of Supply Draft${body.doc_no ? ` #${body.doc_no}` : ""}`;
        }
        if (action === "SUBMIT") {
            const parts = [];
            if (body.doc_no) parts.push(`Doc No: ${body.doc_no}`);
            if (body.farmer_name || body.farmer) parts.push(`Farmer: ${body.farmer_name || body.farmer}`);
            if (body.plant || body.plant_id) parts.push(`Plant: ${body.plant || body.plant_id}`);
            return `Submitted Bill of Supply — ${parts.join(" | ") || "Final submission"}`;
        }
        const parts = [];
        if (body.doc_no) parts.push(`Doc No: ${body.doc_no}`);
        if (body.farmer_name || body.farmer) parts.push(`Farmer: ${body.farmer_name || body.farmer}`);
        if (body.plant || body.plant_id) parts.push(`Plant: ${body.plant || body.plant_id}`);
        if (action === "UPDATE") return `Updated Bill of Supply #${targetId} — ${parts.join(" | ") || "Details updated"}`;
        return `Created Bill of Supply — ${parts.join(" | ") || "New entry"}`;
    }

    // 21. FARMER LOCATION MASTER
    if (moduleName === "Farmer Location Master") {
        if (action === "DELETE") return `Deleted Farmer Location (ID: #${targetId})`;
        const parts = [];
        if (body.farmer_name || body.farmer) parts.push(`Farmer: ${body.farmer_name || body.farmer}`);
        if (body.plant_id || body.plant) parts.push(`Plant: ${body.plant_id || body.plant}`);
        if (action === "UPDATE") return `Updated Farmer Location #${targetId} — ${parts.join(" | ") || "Details updated"}`;
        return `Created Farmer Location — ${parts.join(" | ") || "New entry"}`;
    }

    // 22. FARMER LINE MASTER
    if (moduleName === "Farmer Line Master") {
        if (action === "DELETE") return `Deleted Farmer Line (ID: #${targetId})`;
        const parts = [];
        if (body.line_name || body.line) parts.push(`Line: ${body.line_name || body.line}`);
        if (action === "UPDATE") return `Updated Farmer Line #${targetId} — ${parts.join(" | ") || "Details updated"}`;
        return `Created Farmer Line — ${parts.join(" | ") || "New entry"}`;
    }

    // 23. LINE FARM MASTER
    if (moduleName === "Line Farm Master") {
        if (action === "DELETE") return `Deleted Line Farm (ID: #${targetId})`;
        if (action === "UPDATE") return `Updated Line Farm #${targetId}`;
        return `Created Line Farm entry`;
    }

    // 24. PLANT MASTER
    if (moduleName === "Plant Master") {
        const plantName = body.plant_name || body.name || `Plant #${targetId}`;
        if (action === "DELETE") return `Deleted Plant "${plantName}" (ID: #${targetId})`;
        if (action === "UPDATE") return `Updated Plant "${plantName}" (ID: #${targetId})`;
        return `Created Plant "${plantName}"`;
    }

    // 25. FARMER MASTER
    if (moduleName === "Farmer Master") {
        const farmerName = body.name || body.farmer_name || `Farmer #${targetId}`;
        if (action === "DELETE") return `Deleted Farmer "${farmerName}" (ID: #${targetId})`;
        if (action === "UPDATE") return `Updated Farmer "${farmerName}" (ID: #${targetId})`;
        return `Created Farmer "${farmerName}"`;
    }

    // 26. LINE MASTER
    if (moduleName === "Line Master") {
        const lineName = body.line_name || body.name || `Line #${targetId}`;
        if (action === "DELETE") return `Deleted Line "${lineName}" (ID: #${targetId})`;
        if (action === "UPDATE") return `Updated Line "${lineName}" (ID: #${targetId})`;
        return `Created Line "${lineName}"`;
    }

    // 27. CHICK RECEIPT
    if (moduleName === "Chick Receipt") {
        if (action === "DELETE") return `Deleted Chick Receipt #${targetId}`;
        const parts = [];
        if (body.farmer || body.farmer_name) parts.push(`Farmer: ${body.farmer || body.farmer_name}`);
        if (body.plant || body.plant_id) parts.push(`Plant: ${body.plant || body.plant_id}`);
        if (body.chick_count !== undefined) parts.push(`Chicks: ${body.chick_count}`);
        if (body.breed || body.breed_name) parts.push(`Breed: ${body.breed || body.breed_name}`);
        if (body.batch || body.batch_no) parts.push(`Batch: ${body.batch || body.batch_no}`);
        if (body.doc_no) parts.push(`Doc No: ${body.doc_no}`);
        if (action === "UPDATE") return `Updated Chick Receipt #${targetId} — ${parts.join(" | ") || "Details updated"}`;
        return `Submitted Chick Receipt — ${parts.join(" | ") || "New chick receipt"}`;
    }

    // 28. GEOFENCE CONFIG
    if (moduleName === "Geofence Config") {
        if (action === "DELETE") return `Deleted Geofence Config for Plant #${targetId}`;
        const geoParts = [];
        if (body.plant_id || body.plant) geoParts.push(`Plant: ${body.plant_id || body.plant}`);
        if (body.radius) geoParts.push(`Radius: ${body.radius}m`);
        if (body.latitude && body.longitude) geoParts.push(`Location: (${body.latitude}, ${body.longitude})`);
        return `Saved Geofence Config — ${geoParts.join(" | ") || `Plant #${body.plant_id || targetId}`}`;
    }

    // 29. SAP POST DATE CONFIG
    if (moduleName === "SAP Post Date Config") {
        const sapParts = [];
        if (body.post_date) sapParts.push(`Post Date: ${body.post_date}`);
        if (body.plant_id || body.plant) sapParts.push(`Plant: ${body.plant_id || body.plant}`);
        return `Updated SAP Post Date Configuration${sapParts.length ? ` — ${sapParts.join(" | ")}` : ""}`;
    }

    // 30. TENTATIVE RATE
    if (moduleName === "Tentative Rate") {
        const rateParts = [];
        if (body.plant_id || body.plant) rateParts.push(`Plant: ${body.plant_id || body.plant}`);
        if (body.rate !== undefined) rateParts.push(`Rate: ${body.rate}`);
        if (body.effective_date || body.date) rateParts.push(`Date: ${body.effective_date || body.date}`);
        return `${action === "UPDATE" ? "Updated" : "Created"} Tentative Rate — ${rateParts.join(" | ") || `Plant #${body.plant_id || targetId}`}`;
    }

    // 31. SAP INTEGRATION
    if (moduleName === "SAP Integration") {
        return `Synced SAP Master Data to Database`;
    }

    // 32. BREEDER MODULES
    if (moduleName === "Bio Security") {
        if (action === "DELETE") return `Deleted Bio Security record #${targetId}`;
        const bioParts = [];
        if (body.farmer || body.farmer_name) bioParts.push(`Farmer: ${body.farmer || body.farmer_name}`);
        if (body.farm_name || body.shed_no) bioParts.push(`Farm/Shed: ${body.farm_name || body.shed_no}`);
        if (body.visit_date || body.date) bioParts.push(`Date: ${body.visit_date || body.date}`);
        if (body.status) bioParts.push(`Status: ${body.status}`);
        if (action === "UPDATE") return `Updated Bio Security record #${targetId} — ${bioParts.join(" | ") || "Details updated"}`;
        return `Submitted Bio Security — ${bioParts.join(" | ") || "New record"}`;
    }
    if (moduleName === "Feed Details") {
        if (action === "DELETE") return `Deleted Feed Details record #${targetId}`;
        const fdParts = [];
        if (body.farmer || body.farmer_name) fdParts.push(`Farmer: ${body.farmer || body.farmer_name}`);
        if (body.plant || body.plant_id) fdParts.push(`Plant: ${body.plant || body.plant_id}`);
        if (body.feed_type || body.feed_name) fdParts.push(`Feed: ${body.feed_type || body.feed_name}`);
        if (body.quantity || body.qty) fdParts.push(`Qty: ${body.quantity || body.qty}`);
        if (action === "UPDATE") return `Updated Feed Details record #${targetId} — ${fdParts.join(" | ") || "Details updated"}`;
        return `Submitted Feed Details — ${fdParts.join(" | ") || "New record"}`;
    }

    // 33. GENERIC MASTERS FALLBACK (name-based)
    const genericName = body.name || body.plant_name || body.line_name || body.material_name
        || body.supplier_name || body.unit_name || body.location_name || null;

    if (genericName) {
        if (action === "CREATE") return `Created ${moduleName} — "${genericName}"`;
        if (action === "UPDATE") return `Updated ${moduleName} "${genericName}" (ID: #${targetId})`;
        if (action === "DELETE") return `Deleted ${moduleName} "${genericName}" (ID: #${targetId})`;
    }

    // 34. FINAL FALLBACK
    if (action === "DELETE") return `Deleted ${moduleName} entry (ID: #${targetId || "-"})`;
    if (action === "CANCEL") return `Cancelled ${moduleName} entry (ID: #${targetId || "-"})`;
    if (action === "UPDATE") return `Updated ${moduleName} entry (ID: #${targetId || "-"})`;
    return `${action} performed in ${moduleName} (ID: #${targetId || "-"})`;
}

/**
 * Sanitize request body
 */
function sanitizeBody(body = {}) {
    if (!body || typeof body !== "object") return {};
    const sensitiveKeys = ["password", "confirmPassword", "confirm_password", "token", "secret", "newPassword", "currentPassword"];
    const clean = Array.isArray(body) ? [...body] : { ...body };
    if (!Array.isArray(clean)) {
        sensitiveKeys.forEach((key) => {
            if (key in clean) clean[key] = "***REDACTED***";
        });
    }
    return clean;
}

const auditLogger = (req, res, next) => {
    // Prevent double-binding on the same request object
    if (req._auditLoggerAttached) return next();
    req._auditLoggerAttached = true;

    const method = req.method ? req.method.toUpperCase() : "";
    const cleanUrl = (req.originalUrl || "").split("?")[0].toLowerCase();

    // Skip GET, OPTIONS, auth logins, maintenance, and read/view queries like /api/dc/getChallanByView
    if (shouldSkipAudit(method, cleanUrl)) {
        return next();
    }

    // Capture request context early
    const rawUrl = req.originalUrl || "";
    const reqBody = req.body || {};
    const authHeader = req.headers["authorization"] || "";
    const adminUserHeader = req.headers["x-admin-user"];
    const adminRoleHeader = req.headers["x-admin-role"];
    const adminCategoryHeader = req.headers["x-admin-category"];
    const mobileUserHeader = req.headers["x-mobile-user"] || req.headers["x-user-name"];
    const mobileRoleHeader = req.headers["x-mobile-role"];
    const mobileCategoryHeader = req.headers["x-mobile-category"];
    const mobileUserIdHeader = req.headers["x-user-id"];
    const mobileFullnameHeader = req.headers["x-mobile-fullname"];
    const usernameHeader = req.headers["username"];
    const ipAddress = getCleanIpAddress(req);

    // Listen to response completion: only audit when the operation actually succeeded
    res.on("finish", async () => {
        try {
            // Only log if the HTTP status code is successful (2xx or 3xx)
            if (res.statusCode < 200 || res.statusCode >= 400) {
                return;
            }

            let username = "Unknown";
            let role = "Admin";
            let userId = null;
            let decodedCategory = null;

            // Extract user from JWT
            try {
                const token = authHeader.startsWith("Bearer ")
                    ? authHeader.slice(7)
                    : (authHeader.split(" ")[1] || authHeader);

                if (token && token !== "null" && token !== "undefined") {
                    const decoded = jwt.verify(token, JWT_SECRET);
                    if (decoded) {
                        username = decoded.username || decoded.name || username;
                        role = decoded.role || role;
                        userId = decoded.id || null;
                        decodedCategory = decoded.category || null;
                    }
                }
            } catch (_) {}

            // Extract from X-Admin Headers (passed by Admin Panel Axios interceptor)
            if (adminUserHeader) username = String(adminUserHeader);
            if (adminRoleHeader) role = String(adminRoleHeader);

            // Extract from Mobile Headers (passed by Mobile App Axios interceptor)
            if (mobileUserHeader) username = String(mobileUserHeader);
            if (mobileRoleHeader) role = String(mobileRoleHeader);
            if (mobileUserIdHeader && !userId) userId = String(mobileUserIdHeader);
            if (mobileCategoryHeader && !decodedCategory) decodedCategory = String(mobileCategoryHeader);

            // Fallback user resolution
            if (username === "Unknown" || !username) {
                if (reqBody?.user_id) username = String(reqBody.user_id);
                else if (reqBody?.username) username = String(reqBody.username);
                else if (reqBody?.created_by) username = String(reqBody.created_by);
                else if (usernameHeader) username = String(usernameHeader);
            }

            // If username is numeric ID, try resolving username & role from driver table
            if (username !== "Unknown" && /^\d+$/.test(String(username).trim())) {
                try {
                    const drv = await query("SELECT id, username, fullname, role FROM public.driver WHERE id = $1", [username]);
                    if (drv && drv.length > 0) {
                        userId = drv[0].id;
                        username = drv[0].username || username;
                        if (drv[0].role) role = drv[0].role;
                    }
                } catch (_) {}
            }

            // Deduplication Guard: Avoid duplicate entries for rapid repeated calls
            const dedupKey = `${username}_${method}_${cleanUrl}_${JSON.stringify(reqBody)}`;
            if (isDuplicate(dedupKey)) {
                return;
            }

            const category = resolveCategory(
                { headers: { "x-admin-category": adminCategoryHeader }, body: reqBody, originalUrl: rawUrl },
                decodedCategory
            );
            const module_ = resolveModule(rawUrl);
            const action = resolveAction(method, rawUrl);
            const source = resolveSource(
                { headers: { "x-admin-user": adminUserHeader, "x-admin-role": adminRoleHeader }, originalUrl: rawUrl },
                role
            );
            if (source === "mobile" && role === "Admin") {
                role = mobileRoleHeader || "Supervisor";
            }
            const changeSummary = generateChangeSummary(
                { originalUrl: rawUrl, body: reqBody, params: req.params },
                action,
                module_
            );
            const sanitized = sanitizeBody(reqBody);

            let finalSummary = changeSummary;

            // Mobile Users UPDATE diff
            if (String(finalSummary).startsWith("__MOBILE_UPDATE__")) {
                const driverId = finalSummary.replace("__MOBILE_UPDATE__#", "");
                try {
                    const oldRows = await query(
                        "SELECT fullname, username, role, status FROM driver WHERE id = $1",
                        [driverId]
                    );
                    const old = (oldRows && oldRows.length > 0) ? oldRows[0] : {};
                    const parts = [];

                    if (reqBody.fullname) {
                        if (old.fullname && old.fullname !== reqBody.fullname)
                            parts.push(`Name: ${old.fullname} → ${reqBody.fullname}`);
                        else
                            parts.push(`Name: ${reqBody.fullname}`);
                    }
                    if (reqBody.username) {
                        if (old.username && old.username !== reqBody.username)
                            parts.push(`Username: ${old.username} → ${reqBody.username}`);
                        else
                            parts.push(`Username: ${reqBody.username}`);
                    }
                    if (reqBody.role) {
                        if (old.role && old.role !== reqBody.role)
                            parts.push(`Role: ${old.role} → ${reqBody.role}`);
                        else
                            parts.push(`Role: ${reqBody.role}`);
                    }
                    if (reqBody.status !== undefined) {
                        const newSt = reqBody.status ? "Active" : "Inactive";
                        const oldSt = old.status ? "Active" : "Inactive";
                        if (old.status !== undefined && oldSt !== newSt)
                            parts.push(`Status: ${oldSt} → ${newSt}`);
                        else
                            parts.push(`Status: ${newSt}`);
                    }

                    finalSummary = `Updated mobile user #${driverId} — ${parts.join(" | ") || "Profile updated"}`;
                } catch (_dbErr) {
                    finalSummary = `Updated mobile user #${driverId}`;
                }
            }

            await query(
                `INSERT INTO public.admin_audit_logs
                    (user_id, username, role, category, action, module, ip_address, request_url, change_summary, details, source, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
                [
                    userId,
                    username,
                    role,
                    category,
                    action,
                    module_,
                    ipAddress,
                    rawUrl,
                    finalSummary,
                    JSON.stringify(sanitized),
                    source
                ]
            );
        } catch (err) {
            console.error("[AuditLogger] Error writing audit log:", err.message);
        }
    });

    next();
};

module.exports = auditLogger;
