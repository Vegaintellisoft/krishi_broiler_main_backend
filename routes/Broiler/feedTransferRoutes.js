const router = require('express').Router();

const { getAll, create, getOne, remove, update } = require("../../controllers/Broiler/feedTransferController");

router.post("/create",create );
router.get("/getAll", getAll);

router.get("/getOne/:id", getOne);
router.put("/update/:id", update );
router.delete("/remove/:id", remove);

module.exports = router;
