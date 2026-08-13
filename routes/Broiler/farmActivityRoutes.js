const router = require('express').Router();

const upload = require('../../config/multer.config');
const { create, getEntries, submit, getAll,getOne,remove,update } = require("../../controllers/Broiler/farmActivityController");

router.post("/create", upload.single('upload_mortality'), create);
router.get("/get-entries", getEntries);
router.post("/submit", submit);

router.get("/getAll", getAll);
router.get("/getOne/:id",getOne);
router.delete("/remove/:id",remove);
router.put("/update/:id", update);

module.exports = router;