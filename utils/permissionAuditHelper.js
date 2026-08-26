/**
 * permissionAuditHelper.js
 * Utility to parse, humanize, diff, and summarize role permission modifications
 * for Audit Log / Activity Monitor across Admin Panel & Mobile App (Wagon, Broiler, Breeder).
 */

const KEY_MAP = {
    // Wagon modules
    po: 'Purchase Order',
    purchaseorder: 'Purchase Order',
    purchase_order: 'Purchase Order',
    purchaseorders: 'Purchase Order',
    dc: 'DC / Challan',
    deliverychallan: 'DC / Challan',
    delivery_challan: 'DC / Challan',
    challan: 'DC / Challan',
    deliverychallans: 'DC / Challan',
    material: 'Material Master',
    materials: 'Material Master',
    materialmaster: 'Material Master',
    material_master: 'Material Master',
    supplier: 'Supplier Master',
    suppliers: 'Supplier Master',
    suppliermaster: 'Supplier Master',
    supplier_master: 'Supplier Master',
    shipping: 'Shipping Master',
    shippingmaster: 'Shipping Master',
    shipping_master: 'Shipping Master',
    shippingpoint: 'Shipping Master',
    source: 'Source Location',
    sourcelocation: 'Source Location',
    source_location: 'Source Location',
    unit: 'Unit Master',
    units: 'Unit Master',
    unitmaster: 'Unit Master',
    unit_master: 'Unit Master',
    report: 'Reports & Dispatch',
    reports: 'Reports & Dispatch',
    reportsdispatch: 'Reports & Dispatch',
    reports_dispatch: 'Reports & Dispatch',

    // User & Role Management
    roles: 'Roles & Permissions',
    rolespermissions: 'Roles & Permissions',
    roles_permissions: 'Roles & Permissions',
    rolemanagement: 'Roles & Permissions',
    role_management: 'Roles & Permissions',
    users: 'Admin Users',
    adminusers: 'Admin Users',
    admin_users: 'Admin Users',
    usermanagement: 'Admin Users',
    user_management: 'Admin Users',
    mobileusers: 'Mobile Users',
    mobile_users: 'Mobile Users',
    drivers: 'Mobile Users',
    driver: 'Mobile Users',
    activitylogs: 'Activity Logs',
    activity_logs: 'Activity Logs',
    auditlogs: 'Activity Logs',
    audit_logs: 'Activity Logs',

    // Broiler modules
    farmactivity: 'Farm Activity',
    farm_activity: 'Farm Activity',
    feedtransfer: 'Feed Transfer',
    feed_transfer: 'Feed Transfer',
    feedreturn: 'Feed Return',
    feed_return: 'Feed Return',
    chickplacement: 'Chick Placement',
    chick_placement: 'Chick Placement',
    mortality: 'Mortality Entry',
    mortalityentry: 'Mortality Entry',
    mortality_entry: 'Mortality Entry',
    dailyentry: 'Daily Entry',
    daily_entry: 'Daily Entry',
    tentativerate: 'Tentative Rate',
    tentative_rate: 'Tentative Rate',
    biosecurity: 'Bio Security',
    bio_security: 'Bio Security',
    feeddetails: 'Feed Details',
    feed_details: 'Feed Details',
    bos: 'Bill of Supply',
    billofsupply: 'Bill of Supply',
    bill_of_supply: 'Bill of Supply',
    broilersupply: 'Bill of Supply',
    broiler_supply: 'Bill of Supply',
    feedrequest: 'Feed Request',
    feed_request: 'Feed Request',
    feedapproval: 'Feed Approval',
    feed_approval: 'Feed Approval',
    issuemedicine: 'Issue Medicine',
    issue_medicine: 'Issue Medicine',
    shedreadiness: 'Shed Readiness',
    shed_readiness: 'Shed Readiness',
    farmerlocation: 'Farmer Location Master',
    farmer_location: 'Farmer Location Master',
    farmerline: 'Farmer Line Master',
    farmer_line: 'Farmer Line Master',
    linefarm: 'Line Farm Master',
    line_farm: 'Line Farm Master',
    geofenceconfig: 'Geofence Config',
    geofence_config: 'Geofence Config',
    chickreceipt: 'Chick Receipt',
    chick_receipt: 'Chick Receipt',
    sappostdate: 'SAP Post Date Config',
    sap_post_date: 'SAP Post Date Config',

    // Common Masters
    farmer: 'Farmer Master',
    farmermaster: 'Farmer Master',
    farmer_master: 'Farmer Master',
    plant: 'Plant Master',
    plantmaster: 'Plant Master',
    plant_master: 'Plant Master',
    line: 'Line Master',
    linemaster: 'Line Master',
    line_master: 'Line Master',
    shed: 'Shed Master',
    shedmaster: 'Shed Master',
    shed_master: 'Shed Master',
    flock: 'Flock Master',
    flockmaster: 'Flock Master',
    flock_master: 'Flock Master',

    // Mobile Specific
    dcarrived: 'DC Arrived',
    dc_arrived: 'DC Arrived',
    dcverify: 'DC Verification',
    dc_verify: 'DC Verification',
    dashboard: 'Dashboard',
    locationentry: 'Location Entry',
    location_entry: 'Location Entry',
    bluetoothentry: 'Bluetooth Entry',
    bluetooth_entry: 'Bluetooth Entry',

    // Actions
    view: 'View',
    read: 'View',
    list: 'View',
    get: 'View',
    add: 'Add',
    create: 'Add',
    insert: 'Add',
    post: 'Add',
    edit: 'Edit',
    update: 'Edit',
    put: 'Edit',
    patch: 'Edit',
    modify: 'Edit',
    delete: 'Delete',
    remove: 'Delete',
    destroy: 'Delete',
    export: 'Export',
    download: 'Export',
    print: 'Print',
    pdf: 'PDF',
    cancel: 'Cancel',
    canceldc: 'Cancel',
    sync: 'SAP Sync',
    sap: 'SAP Sync',
    sapsync: 'SAP Sync',
    syncsap: 'SAP Sync',
    action: 'Action',
    verify: 'Verify',
    approve: 'Approve',
    reject: 'Reject',
    status: 'Status Change',
    arrived: 'Mark Arrived'
};

/**
 * Humanize a permission key or action string
 */
function humanizeKey(str) {
    if (!str) return '';
    const clean = String(str).toLowerCase().replace(/[\s\-_]/g, '');
    if (KEY_MAP[clean]) return KEY_MAP[clean];
    return String(str)
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_\-]+/g, ' ')
        .trim()
        .replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Recursively flatten permissions object or array into key-path map: { [path]: boolean }
 */
function flattenPermissions(obj, prefix = '') {
    const res = {};
    if (obj === null || obj === undefined) return res;

    if (typeof obj === 'string') {
        try {
            obj = JSON.parse(obj);
        } catch (_) {
            return { [obj]: true };
        }
    }

    if (Array.isArray(obj)) {
        obj.forEach((item, idx) => {
            if (typeof item === 'string') {
                res[prefix ? `${prefix}.${item}` : item] = true;
            } else if (typeof item === 'object' && item !== null) {
                const itemKey = item.name || item.key || item.module || item.id || `item_${idx}`;
                Object.assign(res, flattenPermissions(item, prefix ? `${prefix}.${itemKey}` : itemKey));
            }
        });
        return res;
    }

    if (typeof obj === 'object') {
        for (const [key, value] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (typeof value === 'boolean') {
                res[fullKey] = value;
            } else if (typeof value === 'number') {
                res[fullKey] = Boolean(value);
            } else if (typeof value === 'string') {
                const lower = value.toLowerCase().trim();
                if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'active') {
                    res[fullKey] = true;
                } else if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'inactive') {
                    res[fullKey] = false;
                } else {
                    res[fullKey] = value;
                }
            } else if (Array.isArray(value)) {
                if (value.every(v => typeof v === 'string')) {
                    value.forEach(v => {
                        res[`${fullKey}.${v}`] = true;
                    });
                } else {
                    Object.assign(res, flattenPermissions(value, fullKey));
                }
            } else if (typeof value === 'object' && value !== null) {
                Object.assign(res, flattenPermissions(value, fullKey));
            }
        }
    }

    return res;
}

/**
 * Parse a keypath (e.g. 'admin.purchaseOrder.add' or 'mobile.dailyEntry') into { section, module, action }
 */
function parseKeyPath(path) {
    const parts = path.split('.').filter(Boolean);
    let section = null;
    let module = null;
    let action = null;

    const firstLower = (parts[0] || '').toLowerCase().replace(/[\s\-_]/g, '');
    if (
        firstLower === 'admin' ||
        firstLower === 'adminpanel' ||
        firstLower === 'adminpermissions' ||
        firstLower === 'wagonadmin' ||
        firstLower === 'broileradmin' ||
        firstLower === 'breederadmin'
    ) {
        section = 'Admin Panel';
        parts.shift();
    } else if (
        firstLower === 'mobile' ||
        firstLower === 'mobileapp' ||
        firstLower === 'mobilepermissions' ||
        firstLower === 'wagonmobile' ||
        firstLower === 'broilermobile' ||
        firstLower === 'breedermobile' ||
        firstLower === 'driver'
    ) {
        section = 'Mobile App';
        parts.shift();
    }

    if (parts.length === 1) {
        module = humanizeKey(parts[0]);
    } else if (parts.length >= 2) {
        module = humanizeKey(parts[0]);
        action = humanizeKey(parts.slice(1).join(' '));
    }

    return { section, module: module || 'General', action };
}

/**
 * Group parsed permission items by section -> module -> actions and format cleanly
 */
function groupEntries(list) {
    const bySection = {};
    list.forEach(item => {
        const sec = item.section || 'General';
        if (!bySection[sec]) bySection[sec] = {};
        if (!bySection[sec][item.module]) bySection[sec][item.module] = [];
        if (item.action) {
            bySection[sec][item.module].push(item.action);
        }
    });

    const outputParts = [];
    for (const [sec, modules] of Object.entries(bySection)) {
        const modStrings = [];
        for (const [mod, actions] of Object.entries(modules)) {
            if (actions.length > 0) {
                // Deduplicate action names
                const uniqueActions = Array.from(new Set(actions));
                modStrings.push(`${mod} (${uniqueActions.join(', ')})`);
            } else {
                modStrings.push(mod);
            }
        }
        if (modStrings.length > 0) {
            if (sec !== 'General') {
                outputParts.push(`${sec}: ${modStrings.join(', ')}`);
            } else {
                outputParts.push(modStrings.join(', '));
            }
        }
    }
    return outputParts.join(' | ');
}

/**
 * Compute the diff between old permissions and new permissions:
 * - deactivated: list of permissions turned from true to false or removed
 * - activated: list of permissions turned from false/unset to true
 */
function diffPermissions(oldPerms, newPerms) {
    const oldFlat = flattenPermissions(oldPerms);
    const newFlat = flattenPermissions(newPerms);

    const allKeys = Array.from(new Set([...Object.keys(oldFlat), ...Object.keys(newFlat)]));
    const deactivated = [];
    const activated = [];

    allKeys.forEach(key => {
        const oldVal = oldFlat[key];
        const newVal = newFlat[key];

        const parsed = parseKeyPath(key);

        if (oldVal === true && (newVal === false || newVal === undefined)) {
            deactivated.push(parsed);
        } else if ((oldVal === false || oldVal === undefined) && newVal === true) {
            activated.push(parsed);
        }
    });

    return {
        deactivated: groupEntries(deactivated),
        activated: groupEntries(activated),
        hasDeactivated: deactivated.length > 0,
        hasActivated: activated.length > 0
    };
}

/**
 * Format currently active permissions into a readable summary string
 */
function formatActivePermissions(perms) {
    if (!perms) return '';
    const flat = flattenPermissions(perms);
    const active = [];
    for (const [k, v] of Object.entries(flat)) {
        if (v === true) {
            active.push(parseKeyPath(k));
        }
    }
    return groupEntries(active);
}

/**
 * Format complete, human-readable summary for a role update
 */
function formatRoleChangeSummary({ roleName, category, oldRole = {}, newBody = {} }) {
    const parts = [];

    // 1. Check basic field changes
    if (oldRole.role_name && newBody.role_name && oldRole.role_name !== newBody.role_name) {
        parts.push(`Name: "${oldRole.role_name}" -> "${newBody.role_name}"`);
    }
    if (oldRole.category && newBody.category && oldRole.category !== newBody.category) {
        parts.push(`Category: ${oldRole.category} -> ${newBody.category}`);
    }
    if (oldRole.status !== undefined && newBody.status !== undefined) {
        const oldSt = oldRole.status ? 'Active' : 'Inactive';
        const newSt = newBody.status ? 'Active' : 'Inactive';
        if (oldSt !== newSt) {
            parts.push(`Status: ${oldSt} -> ${newSt}`);
        }
    }

    // 2. Check permissions diff
    if (newBody.permissions !== undefined) {
        if (oldRole && oldRole.permissions !== undefined) {
            const diff = diffPermissions(oldRole.permissions, newBody.permissions);
            if (diff.hasDeactivated) {
                parts.push(`Deactivated: ${diff.deactivated}`);
            }
            if (diff.hasActivated) {
                parts.push(`Activated: ${diff.activated}`);
            }
            if (!diff.hasDeactivated && !diff.hasActivated && !parts.length) {
                parts.push('Permissions re-saved');
            }
        } else {
            const activeSummary = formatActivePermissions(newBody.permissions);
            if (activeSummary) {
                parts.push(`Configured: ${activeSummary}`);
            }
        }
    }

    const nameLabel = newBody.role_name || oldRole.role_name || roleName || 'Role';
    const catLabel = newBody.category || oldRole.category || category || '';
    const catSuffix = catLabel ? ` (${catLabel})` : '';

    return `Updated role "${nameLabel}"${catSuffix}${parts.length ? ` | ${parts.join(' | ')}` : ''}`;
}

module.exports = {
    humanizeKey,
    flattenPermissions,
    parseKeyPath,
    groupEntries,
    diffPermissions,
    formatActivePermissions,
    formatRoleChangeSummary
};
