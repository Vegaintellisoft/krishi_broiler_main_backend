const router = require("express").Router();

const {
    register,
    login,
    getMyPermissions,
    getAll,
    updateAdmin,
    changePassword,
    deleteAdmin,
    getTruckStatusSummary,
    getLoadingStatus,
    getDashboardSummary,
    getMonthlyPoSummary,
    getProjectStatusSummary,
    getAdminSummary,
    getAvailableAdmin,
    getFarmActivityReport,
    getBroilerDashboardReport,
    getBroilerFarmActivityDetails
} = require("../controllers/adminController");

const { getMobileActivity, getAdminAuditLog } = require("../controllers/activityLogController");

// api/admin
router.post("/register", register);
router.post("/login", login);
router.get("/me/permissions", getMyPermissions);
router.get("/getAll{/:category}", getAll);
router.get("/getAvailableAdmin", getAvailableAdmin);
router.put("/update/:id", updateAdmin);
router.put("/change-password/:id", changePassword);
router.delete("/delete/:id", deleteAdmin);
router.get("/truck-status", getTruckStatusSummary);
router.get("/loading-status", getLoadingStatus);
router.get("/dashboard-summary", getDashboardSummary);
router.get("/monthly-po-summary", getMonthlyPoSummary);
router.get("/project-status-summary", getProjectStatusSummary);
router.get("/getAdminSummary", getAdminSummary);
router.get("/farm-activity-report", getFarmActivityReport);
router.get("/broiler-dashboard-report", getBroilerDashboardReport);
router.get("/broiler-farm-activity-details", getBroilerFarmActivityDetails);

// --- Activity Monitor Routes ---
router.get("/activity-logs/mobile", getMobileActivity);
router.get("/activity-logs/admin", getAdminAuditLog);

module.exports = router;
