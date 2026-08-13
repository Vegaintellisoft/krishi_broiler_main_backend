const router = require("express").Router();

const {getAll, addSourceLocation, deleteSourceLocation, updateSourceLocation} = require("../controllers/sourceMasterController");

router.get("/getAll", getAll);
router.post("/add", addSourceLocation);
router.put("/update/:updatedSourceId", updateSourceLocation);
router.delete('/delete/:sourceId', deleteSourceLocation);

module.exports = router;