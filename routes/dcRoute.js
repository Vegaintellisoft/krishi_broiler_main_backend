const router = require("express").Router();

const { getAll, addDC, updateDC, generateChallanPDF, generateChallanPDFByData,
    generateChallanPDFByViewData, cancelDC, getAllById, getTokenNo,
    toggleArrivedStatus, getDashboardData, updateTruckNo
} = require("../controllers/dcController");

router.get("/getAll{/:location_id}", getAll);
router.get("/getAllById/:user_id", getAllById);
router.get("/dashboard/:user_id", getDashboardData);
router.get("/getTokenNo", getTokenNo);
router.post("/add", addDC);
router.put("/update/:id", updateDC);
router.put("/arrived/:id", toggleArrivedStatus);
router.post("/getChallan", generateChallanPDFByData);
router.post("/getChallanByView", generateChallanPDFByViewData);
router.put("/cancelDc/:id", cancelDC);
router.put("/updateTruckNo/:id", updateTruckNo);

module.exports = router;