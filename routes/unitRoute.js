const router = require('express').Router();

const {getAll, addUnit, updateUnit, deleteUnit} = require("../controllers/unitController")

router.get("/getAll", getAll);
router.post("/add", addUnit);
router.put("/update/:id", updateUnit);
router.delete("/delete/:id", deleteUnit)


module.exports = router;