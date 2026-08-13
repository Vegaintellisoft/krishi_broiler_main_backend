const express = require("express");
const router = express.Router();
const {
    getAllLineFarm,
    createLineFarm,
    updateLineFarm,
    deleteLineFarm
} = require("../../controllers/Broiler/lineFarmController");

//  /api/broiler/line-farm

router.get("/getAll", getAllLineFarm);
router.post("/create", createLineFarm);
router.put("/update/:id", updateLineFarm);
router.delete("/delete/:id", deleteLineFarm);

module.exports = router;
