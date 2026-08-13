const router = require('express').Router();

const {getAll, addMaterial, updateMaterial, deleteMaterial} = require("../controllers/materialController");

router.get("/getAll", getAll);
router.post("/add", addMaterial);
router.put("/update/:updatedMaterialId", updateMaterial);
router.delete("/delete/:id", deleteMaterial);

module.exports = router;