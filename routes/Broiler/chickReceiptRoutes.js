const router = require('express').Router();

const { create, getPODetails, getDeliveryPODetails, getPOByDc, getDCNumbers, getDCNumbersFromSAP, getPOByDcFromSAP } = require("../../controllers/Broiler/chickReceiptController")

router.post("/create", create);

router.get("/get-po", getPODetails);
router.get("/get-delivery-po", getDeliveryPODetails);
router.get("/get-po-by-dc", getPOByDc);
router.get("/get-dcno", getDCNumbers);
router.get("/get-dcno-sap", getDCNumbersFromSAP);
router.get("/get-po-by-dc-sap", getPOByDcFromSAP);

module.exports = router;
