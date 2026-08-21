const express = require("express");
const broilerMasterRoutes = require("./masters/masterRoutes");
const farmActivityRoutes = require("./farmActivityRoutes");
const shedReadinessRoutes = require("./shedReadinessRoutes");
const IssueMedicineRoutes = require("../Broiler/IssueMedicineRoutes");
const feedTransferRoutes = require("../Broiler/feedTransferRoutes");
const feedReturnRoutes = require("../Broiler/feedReturnRoutes");
const broilerSupplyRoutes = require("../Broiler/broilerSupplyRoutes");
const feedRequestRoutes = require("../Broiler/feedRequestRoutes");
const feedApprovalRoutes = require("../Broiler/feedApprovalRoutes");

const plantRoutes = require("../Broiler/plantRoutes");
const farmerRoutes = require("../Broiler/farmerRoutes");
const chickReceiptRoutes = require("../Broiler/chickReceiptRoutes");

const sapRoutes = require("./sapRoutes");
const tentativeRateRoutes = require("./tentativeRateRoutes");
const sapPostDateConfigRoutes = require("./sapPostDateConfigRoutes");
const geofenceConfigRoutes = require("./geofenceConfigRoutes");
const lineFarmRoutes = require("./lineFarmRoutes");
const farmerLineRoutes = require("./farmerLineRoutes");

const router = express.Router();

// group under /api/broiler/*
router.use("/tentative-rate", tentativeRateRoutes);
router.use("/master", broilerMasterRoutes);
router.use("/farm-activity", farmActivityRoutes);
router.use("/shed-readiness", shedReadinessRoutes);
router.use("/issue-medicine", IssueMedicineRoutes);
router.use("/feed-transfer", feedTransferRoutes);
router.use("/feed-return", feedReturnRoutes);
router.use("/bill-of-supply", broilerSupplyRoutes);
router.use("/feed-request", feedRequestRoutes);
router.use("/feedApproval", feedApprovalRoutes);

router.use("/plant", plantRoutes);
router.use("/farmer", farmerRoutes);
router.use("/chick-receipt", chickReceiptRoutes);

router.use("/sap", sapRoutes);
router.use("/sap-post-date-config", sapPostDateConfigRoutes);
router.use("/geofence-config", geofenceConfigRoutes);
router.use("/line-farm", lineFarmRoutes);
router.use("/farmer-line", farmerLineRoutes);

module.exports = router;
