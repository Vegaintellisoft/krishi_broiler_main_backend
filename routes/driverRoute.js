const router = require("express").Router();

const {
    register,
    login,
    getAll,
    udpateDriver,
    getById,
    deleteDriver
} = require("../controllers/driverController");


// api/driver
router.post("/register", register);
router.post("/login", login);
router.get("/getAll", getAll);
router.get("/get/:id", getById);
router.put("/update/:id", udpateDriver);
router.delete("/delete/:id", deleteDriver);

module.exports = router;