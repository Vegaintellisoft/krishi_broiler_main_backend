const router = require('express').Router();

const { getAll, create, getOne, remove, update, getOneByDoc } = require("../../controllers/Broiler/feedRequestController");

router.post("/create",create );
router.get("/getAll", getAll);
router.get("/get-by-doc", getOneByDoc);

router.get("/getOne/:id", getOne);
router.put("/update/:id", update );
router.delete("/remove/:id", remove);

module.exports = router;
