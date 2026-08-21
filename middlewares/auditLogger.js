﻿const jwt = require("jsonwebtoken");
const os = require("os");
const { query } = require("../config/db");

const JWT_SECRET = process.env.JWT_SECRET || "default_jwt_secret";

/**
 * Get machine's actual local network IPv4 address (e.g. 192.168.5.101)
 */
function getHostNetworkIp() {
    try {
        const ifaces = os.networkInterfaces();
        for (const dev in ifaces) {
            for (const details of ifaces[dev]) {
                if (details.family === "IPv4" && !details.internal && details.address) {
                    return details.address;
                }
            }
        }
    } catch (_) {}
    return "192.168.5.101";
}

/**
 * Extract clean, accurate, exact client IP address
 */
function getCleanIpAddress(req) {
    let rawIp =
        req.headers["cf-connecting-ip"] ||
        req.headers["x-real-ip"] ||
        (req.headers["x-forwarded-for"] ? req.headers["x-forwarded-for"].split(",")[0] : null) ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        req.ip ||
        "";

    let clean = String(rawIp).trim().replace(/^::ffff:/, "");
    if (clean === "::1" || clean === "127.0.0.1" || clean === "localhost" || !clean) {
        clean = getHostNetworkIp();
    }
    return clean;
}

/**
 * Resolve Category (Broiler, Wagon, Breeder)
 */
function resolveCategory(req, decodedCategory = null) {
    if (req.headers["x-admin-category"]) {
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
    if (cleanUrl.includes("/wagon") || cleanUrl.includes("/dc") || cleanUrl.includes("/po") || cleanUrl.includes("/supplier") || cleanUrl.includes("/material")) {
        return "Wagon";
    }
    if (cleanUrl.includes("/breeder") || cleanUrl.includes("/bio-security")) {
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
    if (clean.includes("/admin")) return "Admin Users";
    if (clean.includes("/driver")) return "Mobile Users";
    if (clean.includes("/roles")) return "Roles & Permissions";
    if (clean.includes("/farm-activity")) return "Farm Activity";
    if (clean.includes("/feed-request")) return "Feed Request";
    if (clean.includes("/feed-transfer")) return "Feed Transfer";
    if (clean.includes("/feed-return")) return "Feed Return";
    if (clean.includes("/plant")) return "Plant Master";
    if (clean.includes("/farmer")) return "Farmer Master";
    if (clean.includes("/line")) return "Line Master";
    if (clean.includes("/material")) return "Material Master";
    if (clean.includes("/supplier")) return "Supplier Master";
    if (clean.includes("/shipping")) return "Shipping Master";
    if (clean.includes("/source")) return "Source Location";
    if (clean.includes("/unit")) return "Unit Master";
    if (clean.includes("/po")) return "Purchase Order";
    if (clean.includes("/dc")) return "DC / Challan";
    return "Operations";
}

/**
 * Identify Action
 */
function resolveAction(method = "", url = "") {
    const clean = url.toLowerCase();
    if (clean.includes("/remove") || clean.includes("/delete") || method.toUpperCase() === "DELETE") {
        return "DELETE";
    }
    if (clean.includes("/cancel")) {
        return "CANCEL";
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
 * Resolve Source: 'admin' (Admin Panel Web) vs 'mobile' (Supervisor/Driver Mobile App)
 */
function resolveSource(req, role = "") {
    const url = (req.originalUrl || "").toLowerCase();
    const roleLower = String(role || "").toLowerCase();

    // 1. Explicit admin headers sent by Admin Panel Axios interceptor
    if (req.headers["x-admin-user"] || req.headers["x-admin-role"]) {
        return "admin";
    }

    // 2. Admin URL routes
    if (
        url.startsWith("/api/admin") ||
        url.startsWith("/api/roles") ||
        url.startsWith("/api/dc") ||
        url.startsWith("/api/po") ||
        url.startsWith("/api/material") ||
        url.startsWith("/api/supplier") ||
        url.startsWith("/api/shipping") ||
        url.startsWith("/api/source") ||
        url.startsWith("/api/unit")
    ) {
        return "admin";
    }

    // 3. Mobile app routes
    if (
        url.includes("/api/driver/") ||
        url.includes("/api/broiler/farm-activity/") ||
        url.includes("/api/broiler/feed-request/") ||
        url.includes("/api/broiler/feed-transfer/") ||
        url.includes("/api/broiler/feed-return/")
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
 * Generate specific description of WHAT changed — detailed field-level audit summary
 */
function generateChangeSummary(req, action, moduleName) {
    const body = req.body || {};
    const url = req.originalUrl || "";
    const cleanUrl = url.toLowerCase();

    // Extract ID from URL (last segment after stripping query string)
    const urlParts = url.split("?")[0].split("/").filter(Boolean);
    const targetId = urlParts[urlParts.length - 1] || "";

    // ─────────────────────────────────────────────────
    // 1. PASSWORD CHANGES
    // ─────────────────────────────────────────────────
    if (cleanUrl.includes("/change-password")) {
        if (cleanUrl.includes("/driver/")) {
            return `Mobile user password changed (User ID: #${targetId})`;
        }
        return `Admin account password changed (User ID: #${targetId})`;
    }

    // ─────────────────────────────────────────────────
    // 2. MOBILE USERS (Driver management from Admin)
    // ─────────────────────────────────────────────────
    if (moduleName === "Mobile Users") {
        const name = body.fullname || body.username || `User #${targetId}`;
        const category = body.category || "";
        if (action === "DELETE") {
            return `Deleted mobile user "${name}" (ID: #${targetId})`;
        }
        if (action === "CREATE") {
            const parts = [`Name: ${name}`];
            if (body.username) parts.push(`Username: ${body.username}`);
            if (body.role) parts.push(`Role: ${body.role}`);
            if (category) parts.push(`Category: ${category}`);
            return `Registered new mobile user — ${parts.join(" | ")}`;
        }
        if (action === "UPDATE") {
            // Defer to async block for DB lookup (old role/status comparison)
            return `__MOBILE_UPDATE__#${targetId}`;
        }
    }

    // ─────────────────────────────────────────────────
    // 3. ADMIN USERS
    // ─────────────────────────────────────────────────
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
            return `Deleted admin user (ID: #${targetId})`;
        }
    }

    // ─────────────────────────────────────────────────
    // 4. ROLES & PERMISSIONS
    // ─────────────────────────────────────────────────
    if (moduleName === "Roles & Permissions") {
        const roleName = body.role_name || body.name || `Role #${targetId}`;
        const category = body.category || "";
        if (action === "CREATE") {
            return `Created new role "${roleName}"${category ? ` for ${category}` : ""}`;
        }
        if (action === "UPDATE") {
            const perms = body.permissions
                ? ` | Permissions: ${Array.isArray(body.permissions) ? body.permissions.join(", ") : body.permissions}`
                : "";
            return `Updated role "${roleName}"${category ? ` (${category})` : ""}${perms}`;
        }
        if (action === "DELETE") {
            return `Deleted role "${roleName}" (ID: #${targetId})`;
        }
    }

    // ─────────────────────────────────────────────────
    // 5. DC / DELIVERY CHALLAN (Wagon)
    // ─────────────────────────────────────────────────
    if (moduleName === "DC / Challan") {
        if (cleanUrl.includes("/canceldc") || cleanUrl.includes("/cancel-dc")) {
            const reason = body.cancel_reason || body.reason || "No reason provided";
            return `Cancelled DC/Challan #${targetId} — Reason: "${reason}"`;
        }
        if (cleanUrl.includes("/arrived/")) {
            const arrived = body.arrived !== undefined ? body.arrived : body.status;
            return `Marked DC/Challan #${targetId} as ${arrived ? "Arrived" : "Not Arrived"}`;
        }
        if (action === "CREATE") {
            const parts = [];
            if (body.dc_no || body.challan_no) parts.push(`DC No: ${body.dc_no || body.challan_no}`);
            if (body.supplier_name || body.supplier) parts.push(`Supplier: ${body.supplier_name || body.supplier}`);
            if (body.material_name || body.material) parts.push(`Material: ${body.material_name || body.material}`);
            if (body.quantity || body.qty) parts.push(`Qty: ${body.quantity || body.qty}`);
            if (body.po_no) parts.push(`PO No: ${body.po_no}`);
            return `Created new DC/Challan — ${parts.join(" | ") || "New delivery challan entry"}`;
        }
        if (action === "UPDATE") {
            const parts = [];
            if (body.dc_no || body.challan_no) parts.push(`DC No: ${body.dc_no || body.challan_no}`);
            if (body.supplier_name || body.supplier) parts.push(`Supplier: ${body.supplier_name || body.supplier}`);
            if (body.quantity || body.qty) parts.push(`Qty: ${body.quantity || body.qty}`);
            if (body.status) parts.push(`Status: ${body.status}`);
            return `Updated DC/Challan #${targetId} — ${parts.join(" | ") || "Details updated"}`;
        }
        if (action === "CANCEL") {
            return `Cancelled DC/Challan #${targetId}`;
        }
    }

    // ─────────────────────────────────────────────────
    // 6. PURCHASE ORDER (Wagon)
    // ─────────────────────────────────────────────────
    if (moduleName === "Purchase Order") {
        if (action === "CREATE") {
            const parts = [];
            if (body.po_no) parts.push(`PO No: ${body.po_no}`);
            if (body.supplier__id) parts.push(`Supplier ID: ${body.supplier__id}`);
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
            if (body.status) parts.push(`Status: ${body.status}`);
            if (Array.isArray(body.materials)) parts.push(`Materials: ${body.materials.length} item(s)`);
            return `Updated Purchase Order #${targetId} — ${parts.join(" | ") || "Details updated"}`;
        }
        if (action === "DELETE") {
            return `Deleted Purchase Order #${targetId}`;
        }
    }

    // ─────────────────────────────────────────────────
    // 7. MATERIAL MASTER
    // ─────────────────────────────────────────────────
    if (moduleName === "Material Master") {
        const matName = body.name || body.material_name || `Material #${targetId}`;
        if (action === "CREATE") {
            const parts = [`Name: ${matName}`];
            if (body.material_code) parts.push(`Code: ${body.material_code}`);
            if (body.hsn_code) parts.push(`HSN: ${body.hsn_code}`);
            if (body.cgst !== undefined) parts.push(`CGST: ${body.cgst}%`);
            if (body.sgst !== undefined) parts.push(`SGST: ${body.sgst}%`);
            return `Created Material — ${parts.join(" | ")}`;
        }
        if (action === "UPDATE") {
            const parts = [`Name: ${matName}`];
            if (body.material_code) parts.push(`Code: ${body.material_code}`);
            if (body.hsn_code) parts.push(`HSN: ${body.hsn_code}`);
            if (body.status !== undefined) parts.push(`Status: ${body.status ? "Active" : "Inactive"}`);
            if (body.cgst !== undefined) parts.push(`CGST: ${body.cgst}%`);
            if (body.sgst !== undefined) parts.push(`SGST: ${body.sgst}%`);
            return `Updated Material "${matName}" (ID: #${targetId}) — ${parts.join(" | ")}`;
        }
        if (action === "DELETE") {
            return `Deleted Material "${matName}" (ID: #${targetId})`;
        }
    }

    // ─────────────────────────────────────────────────
    // 8. SUPPLIER MASTER
    // ─────────────────────────────────────────────────
    if (moduleName === "Supplier Master") {
        const supplierName = body.name || body.supplier_name || `Supplier #${targetId}`;
        if (action === "CREATE") {
            const parts = [`Name: ${supplierName}`];
            if (body.gst_no || body.gstin) parts.push(`GST: ${body.gst_no || body.gstin}`);
            if (body.pan_no) parts.push(`PAN: ${body.pan_no}`);
            if (body.state) parts.push(`State: ${body.state}`);
            if (body.email) parts.push(`Email: ${body.email}`);
            return `Created Supplier — ${parts.join(" | ")}`;
        }
        if (action === "UPDATE") {
            const parts = [`Name: ${supplierName}`];
            if (body.gst_no || body.gstin) parts.push(`GST: ${body.gst_no || body.gstin}`);
            if (body.status !== undefined) parts.push(`Status: ${body.status ? "Active" : "Inactive"}`);
            if (body.state) parts.push(`State: ${body.state}`);
            return `Updated Supplier "${supplierName}" (ID: #${targetId}) — ${parts.join(" | ")}`;
        }
        if (action === "DELETE") {
            return `Deleted Supplier "${supplierName}" (ID: #${targetId})`;
        }
    }

    // ─────────────────────────────────────────────────
    // 9. SHIPPING MASTER
    // ─────────────────────────────────────────────────
    if (moduleName === "Shipping Master") {
        const shipName = body.sap_name || body.name || body.address || `Shipping #${targetId}`;
        if (action === "CREATE") {
            const parts = [`Name: ${shipName}`];
            if (body.sap_code) parts.push(`SAP Code: ${body.sap_code}`);
            if (body.address) parts.push(`Address: ${body.address}`);
            if (body.state) parts.push(`State: ${body.state}`);
            return `Created Shipping Address — ${parts.join(" | ")}`;
        }
        if (action === "UPDATE") {
            const parts = [`Name: ${shipName}`];
            if (body.sap_code) parts.push(`SAP Code: ${body.sap_code}`);
            if (body.address) parts.push(`Address: ${body.address}`);
            if (body.status !== undefined) parts.push(`Status: ${body.status ? "Active" : "Inactive"}`);
            return `Updated Shipping Address "${shipName}" (ID: #${targetId}) — ${parts.join(" | ")}`;
        }
        if (action === "DELETE") {
            return `Deleted Shipping Address "${shipName}" (ID: #${targetId})`;
        }
    }

    // ─────────────────────────────────────────────────
    // 10. SOURCE LOCATION
    // ─────────────────────────────────────────────────
    if (moduleName === "Source Location") {
        const sourceName = body.name || body.location_name || `Location #${targetId}`;
        if (action === "CREATE") {
            const parts = [`Name: ${sourceName}`];
            if (body.code) parts.push(`Code: ${body.code}`);
            if (body.address) parts.push(`Address: ${body.address}`);
            return `Created Source Location — ${parts.join(" | ")}`;
        }
        if (action === "UPDATE") {
            const parts = [`Name: ${sourceName}`];
            if (body.code) parts.push(`Code: ${body.code}`);
            if (body.status !== undefined) parts.push(`Status: ${body.status ? "Active" : "Inactive"}`);
            return `Updated Source Location "${sourceName}" (ID: #${targetId}) — ${parts.join(" | ")}`;
        }
        if (action === "DELETE") {
            return `Deleted Source Location "${sourceName}" (ID: #${targetId})`;
        }
    }

    // ─────────────────────────────────────────────────
    // 11. UNIT MASTER
    // ─────────────────────────────────────────────────
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
            return `Deleted Unit "${unitName}" (ID: #${targetId})`;
        }
    }

    // ─────────────────────────────────────────────────
    // 12. PLANT MASTER (Broiler)
    // ─────────────────────────────────────────────────
    if (moduleName === "Plant Master") {
        const plantName = body.plant_name || body.name || `Plant #${targetId}`;
        if (action === "CREATE") {
            const parts = [`Name: ${plantName}`];
            if (body.plant_code) parts.push(`Code: ${body.plant_code}`);
            if (body.location) parts.push(`Location: ${body.location}`);
            return `Created Plant — ${parts.join(" | ")}`;
        }
        if (action === "UPDATE") {
            const parts = [`Name: ${plantName}`];
            if (body.plant_code) parts.push(`Code: ${body.plant_code}`);
            if (body.status !== undefined) parts.push(`Status: ${body.status ? "Active" : "Inactive"}`);
            return `Updated Plant "${plantName}" (ID: #${targetId}) — ${parts.join(" | ")}`;
        }
        if (action === "DELETE") {
            return `Deleted Plant "${plantName}" (ID: #${targetId})`;
        }
    }

    // ─────────────────────────────────────────────────
    // 13. FARMER MASTER (Broiler)
    // ─────────────────────────────────────────────────
    if (moduleName === "Farmer Master") {
        const farmerName = body.name || body.farmer_name || `Farmer #${targetId}`;
        if (action === "CREATE") {
            const parts = [`Name: ${farmerName}`];
            if (body.mobile) parts.push(`Mobile: ${body.mobile}`);
            if (body.village) parts.push(`Village: ${body.village}`);
            if (body.plant_id) parts.push(`Plant ID: ${body.plant_id}`);
            return `Created Farmer — ${parts.join(" | ")}`;
        }
        if (action === "UPDATE") {
            const parts = [`Name: ${farmerName}`];
            if (body.mobile) parts.push(`Mobile: ${body.mobile}`);
            if (body.status !== undefined) parts.push(`Status: ${body.status ? "Active" : "Inactive"}`);
            return `Updated Farmer "${farmerName}" (ID: #${targetId}) — ${parts.join(" | ")}`;
        }
        if (action === "DELETE") {
            return `Deleted Farmer "${farmerName}" (ID: #${targetId})`;
        }
    }

    // ─────────────────────────────────────────────────
    // 14. LINE MASTER (Broiler)
    // ─────────────────────────────────────────────────
    if (moduleName === "Line Master") {
        const lineName = body.line_name || body.name || `Line #${targetId}`;
        if (action === "CREATE") {
            const parts = [`Name: ${lineName}`];
            if (body.plant_id) parts.push(`Plant ID: ${body.plant_id}`);
            if (body.farmer_id) parts.push(`Farmer ID: ${body.farmer_id}`);
            return `Created Line — ${parts.join(" | ")}`;
        }
        if (action === "UPDATE") {
            const parts = [`Name: ${lineName}`];
            if (body.status !== undefined) parts.push(`Status: ${body.status ? "Active" : "Inactive"}`);
            return `Updated Line "${lineName}" (ID: #${targetId}) — ${parts.join(" | ")}`;
        }
        if (action === "DELETE") {
            return `Deleted Line "${lineName}" (ID: #${targetId})`;
        }
    }

    // ─────────────────────────────────────────────────
    // 15. FARM ACTIVITY (Broiler Mobile)
    // ─────────────────────────────────────────────────
    if (moduleName === "Farm Activity") {
        if (cleanUrl.includes("/remove") || cleanUrl.includes("/delete")) {
            return `Cancelled / Deleted Farm Activity entry (ID: #${targetId})`;
        }
        const parts = [];
        if (body.farmer || body.farmer_name) parts.push(`Farmer: ${body.farmer || body.farmer_name}`);
        if (body.plant || body.plant_name) parts.push(`Plant: ${body.plant || body.plant_name}`);
        if (body.mortality !== undefined) parts.push(`Mortality: ${body.mortality}`);
        if (body.total_farms !== undefined) parts.push(`Total Farms: ${body.total_farms}`);
        if (body.body_weight !== undefined) parts.push(`Body Weight: ${body.body_weight}`);
        if (body.feed_consumed !== undefined) parts.push(`Feed Consumed: ${body.feed_consumed}`);
        if (body.water_consumed !== undefined) parts.push(`Water Consumed: ${body.water_consumed}`);
        if (action === "UPDATE") {
            return `Updated Farm Activity #${targetId} — ${parts.join(" | ") || "Activity details updated"}`;
        }
        return `Submitted Farm Activity — ${parts.join(" | ") || "New entry created"}`;
    }

    // ─────────────────────────────────────────────────
    // 16. FEED REQUEST (Broiler Mobile)
    // ─────────────────────────────────────────────────
    if (moduleName === "Feed Request") {
        const parts = [];
        if (body.farmer || body.farmer_name) parts.push(`Farmer: ${body.farmer || body.farmer_name}`);
        if (body.plant || body.plant_id) parts.push(`Plant: ${body.plant || body.plant_id}`);
        if (body.quantity || body.requested_qty) parts.push(`Qty: ${body.quantity || body.requested_qty}`);
        if (body.feed_type || body.feed_name) parts.push(`Feed: ${body.feed_type || body.feed_name}`);
        if (action === "UPDATE") {
            const status = body.status || body.approval_status;
            if (status) parts.push(`Status: ${status}`);
            return `Updated Feed Request #${targetId} — ${parts.join(" | ") || "Request updated"}`;
        }
        if (action === "DELETE") return `Deleted Feed Request #${targetId}`;
        return `Created Feed Request — ${parts.join(" | ") || "New feed request"}`;
    }

    // ─────────────────────────────────────────────────
    // 17. FEED TRANSFER (Broiler Mobile)
    // ─────────────────────────────────────────────────
    if (moduleName === "Feed Transfer") {
        const parts = [];
        if (body.from_plant || body.from_location) parts.push(`From: ${body.from_plant || body.from_location}`);
        if (body.to_plant || body.to_location) parts.push(`To: ${body.to_plant || body.to_location}`);
        if (body.quantity || body.transfer_qty) parts.push(`Qty: ${body.quantity || body.transfer_qty}`);
        if (body.feed_type || body.feed_name) parts.push(`Feed: ${body.feed_type || body.feed_name}`);
        if (action === "UPDATE") return `Updated Feed Transfer #${targetId} — ${parts.join(" | ") || "Transfer updated"}`;
        if (action === "DELETE") return `Deleted Feed Transfer #${targetId}`;
        return `Created Feed Transfer — ${parts.join(" | ") || "New feed transfer"}`;
    }

    // ─────────────────────────────────────────────────
    // 18. FEED RETURN (Broiler Mobile)
    // ─────────────────────────────────────────────────
    if (moduleName === "Feed Return") {
        const parts = [];
        if (body.farmer || body.farmer_name) parts.push(`Farmer: ${body.farmer || body.farmer_name}`);
        if (body.plant || body.plant_id) parts.push(`Plant: ${body.plant || body.plant_id}`);
        if (body.quantity || body.return_qty) parts.push(`Qty: ${body.quantity || body.return_qty}`);
        if (action === "UPDATE") return `Updated Feed Return #${targetId} — ${parts.join(" | ") || "Return updated"}`;
        if (action === "DELETE") return `Deleted Feed Return #${targetId}`;
        return `Created Feed Return — ${parts.join(" | ") || "New feed return"}`;
    }

    // ─────────────────────────────────────────────────
    // 19. CHICK RECEIPT (Broiler)
    // ─────────────────────────────────────────────────
    if (cleanUrl.includes("/chick-receipt") || cleanUrl.includes("/chickreceipt")) {
        const parts = [];
        if (body.farmer || body.farmer_name) parts.push(`Farmer: ${body.farmer || body.farmer_name}`);
        if (body.plant || body.plant_name) parts.push(`Plant: ${body.plant || body.plant_name}`);
        if (body.chick_count !== undefined) parts.push(`Chick Count: ${body.chick_count}`);
        if (body.batch_no || body.batch) parts.push(`Batch: ${body.batch_no || body.batch}`);
        if (action === "UPDATE") return `Updated Chick Receipt #${targetId} — ${parts.join(" | ") || "Details updated"}`;
        if (action === "DELETE") return `Deleted Chick Receipt #${targetId}`;
        return `Created Chick Receipt — ${parts.join(" | ") || "New chick receipt entry"}`;
    }

    // ─────────────────────────────────────────────────
    // 20. SHED READINESS (Broiler)
    // ─────────────────────────────────────────────────
    if (cleanUrl.includes("/shed-readiness") || cleanUrl.includes("/shedreadiness")) {
        const parts = [];
        if (body.farmer || body.farmer_name) parts.push(`Farmer: ${body.farmer || body.farmer_name}`);
        if (body.plant || body.plant_name) parts.push(`Plant: ${body.plant || body.plant_name}`);
        if (body.status) parts.push(`Status: ${body.status}`);
        if (action === "UPDATE") return `Updated Shed Readiness #${targetId} — ${parts.join(" | ") || "Details updated"}`;
        if (action === "DELETE") return `Deleted Shed Readiness #${targetId}`;
        return `Created Shed Readiness entry — ${parts.join(" | ") || "New entry"}`;
    }

    // ─────────────────────────────────────────────────
    // 21. GENERIC MASTERS FALLBACK (name-based)
    // ─────────────────────────────────────────────────
    const genericName = body.name || body.plant_name || body.line_name || body.material_name
        || body.supplier_name || body.unit_name || body.location_name || null;

    if (genericName) {
        if (action === "CREATE") return `Created ${moduleName} — Name: "${genericName}"`;
        if (action === "UPDATE") {
            const statusPart = body.status !== undefined ? ` | Status: ${body.status ? "Active" : "Inactive"}` : "";
            return `Updated ${moduleName} "${genericName}" (ID: #${targetId})${statusPart}`;
        }
        if (action === "DELETE") return `Deleted ${moduleName} "${genericName}" (ID: #${targetId})`;
    }

    // ─────────────────────────────────────────────────
    // 22. FINAL FALLBACK
    // ─────────────────────────────────────────────────
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
    console.log("testttttttttt")
    // 1. Single execution guard per request (prevents duplicate logs)
    if (req._auditLogged) return next();


    const mutateMethods = ["POST", "PUT", "PATCH", "DELETE"];
    if (!mutateMethods.includes(req.method.toUpperCase())) return next();

    const cleanUrl = (req.originalUrl || "").split("?")[0].toLowerCase();
    if (cleanUrl.endsWith("/login") || cleanUrl.includes("/db/add-unique-constrains")) return next();

    // Mark request as processed by audit logger
    req._auditLogged = true;

    let username = "Unknown";
    let role = "Admin";
    let userId = null;
    let decodedCategory = null;

    // Extract from JWT Token in Authorization header
    try {
        const authHeader = req.headers["authorization"] || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (authHeader.split(" ")[1] || authHeader);
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
    if (req.headers["x-admin-user"]) {
        username = String(req.headers["x-admin-user"]);
    }
    if (req.headers["x-admin-role"]) {
        role = String(req.headers["x-admin-role"]);
    }

    // Fallbacks for mobile or unauthenticated requests
    if (username === "Unknown" || !username) {
        if (req.body?.user_id) username = String(req.body.user_id);
        else if (req.body?.username) username = String(req.body.username);
        else if (req.body?.created_by) username = String(req.body.created_by);
        else if (req.headers["username"]) username = String(req.headers["username"]);
    }

    const ipAddress = getCleanIpAddress(req);
    const category = resolveCategory(req, decodedCategory);
    const module_ = resolveModule(req.originalUrl);
    const action = resolveAction(req.method, req.originalUrl);
    const source = resolveSource(req, role);
    const changeSummary = generateChangeSummary(req, action, module_);
    const sanitized = sanitizeBody(req.body || {});

    // Save to DB asynchronously
    setImmediate(async () => {
        try {
            let finalSummary = changeSummary;

            // Mobile Users UPDATE: fetch old record and build a clean diff summary
            if (String(finalSummary).startsWith("__MOBILE_UPDATE__")) {
                const driverId = finalSummary.replace("__MOBILE_UPDATE__#", "");
                const reqBody = req.body || {};
                try {
                    const oldRows = await query(
                        "SELECT fullname, username, role, status FROM driver WHERE id = $1",
                        [driverId]
                    );
                    const old = (oldRows && oldRows.length > 0) ? oldRows[0] : {};
                    const parts = [];

                    // Name
                    if (reqBody.fullname) {
                        if (old.fullname && old.fullname !== reqBody.fullname)
                            parts.push(`Name: ${old.fullname} → ${reqBody.fullname}`);
                        else
                            parts.push(`Name: ${reqBody.fullname}`);
                    }

                    // Username
                    if (reqBody.username) {
                        if (old.username && old.username !== reqBody.username)
                            parts.push(`Username: ${old.username} → ${reqBody.username}`);
                        else
                            parts.push(`Username: ${reqBody.username}`);
                    }

                    // Role — most important: show old → new when changed
                    if (reqBody.role) {
                        if (old.role && old.role !== reqBody.role)
                            parts.push(`Role: ${old.role} → ${reqBody.role}`);
                        else
                            parts.push(`Role: ${reqBody.role}`);
                    }

                    // Status — show old → new when changed
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
                    req.originalUrl,
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

