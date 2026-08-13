const router = require('express').Router();

const {getAll, addSupplier, updateSupplier, deleteSupplier} = require("../controllers/supplierController");

router.get("/getAll", getAll);
router.post("/add", addSupplier);
router.put("/update/:updatedSupplierId", updateSupplier);
router.delete("/delete/:id", deleteSupplier);

module.exports = router;