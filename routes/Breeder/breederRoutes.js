const express = require("express");
const bioSecurityRoutes = require("./bioSecurityRoutes");


const router = express.Router();

// group under /api/breeder/*

router.use("/bioSecurity", bioSecurityRoutes);

module.exports = router;
