const router = require('express').Router();

const {getAll, addPO, updatePO, deletePO} = require("../controllers/poController");

router.get("/getAll{/:user_id}", getAll);
router.post("/add", addPO);
router.put("/update/:id", updatePO);
router.delete("/delete/:id", deletePO)


module.exports = router;