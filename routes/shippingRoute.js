const router = require("express").Router();

const {getAll, addShipping, updateShipping, deleteShipping} = require("../controllers/shippingController");

router.get("/getAll", getAll);
router.post("/add", addShipping);
router.put("/update/:updatedShippingId", updateShipping);
router.delete('/delete/:shippingId', deleteShipping);

module.exports = router;