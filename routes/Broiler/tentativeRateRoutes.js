const router = require("express").Router();

const {
  getTentativeRates,
  addTentativeRate,
  updateTentativeRate
} = require("../../controllers/Broiler/tentativeRateController");

router.get("/", getTentativeRates);
router.post("/", addTentativeRate);
router.put("/:id", updateTentativeRate);



module.exports = router;