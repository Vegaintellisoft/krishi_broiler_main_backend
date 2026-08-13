const express = require("express");
const router = express.Router();
const upload = require("../../middlewares/upload.middleware");
const controller = require("../../controllers/Breeder/bioSecurityController");

// Image upload + create
router.post("/", upload.array("images"), controller.createBioSecurity);

// CRUD
router.get("/", controller.getAllBioSecurity);
router.get("/:id", controller.getBioSecurityById);
router.put("/:id", upload.array("images"), controller.updateBioSecurity);
router.delete("/:id", controller.deleteBioSecurity);

module.exports = router;
