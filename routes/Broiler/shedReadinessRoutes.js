const router = require('express').Router();

const { getAll, getOne, create, remove, update } = require("../../controllers/Broiler/shedReadinessController")

router.post("/create",create );
router.get("/getAll", getAll);

router.get("/getOne/:id", getOne);
router.put("/update/:id", update );
router.delete("/remove/:id", remove);

module.exports = router;
