const router = require("express").Router();

const {
    getAllRoles,
    addRole,
    updateRole,
    deleteRole,
    checkUsersWithRole,
    reassignAndDeleteRole
} = require("../controllers/roleController");

// /api/roles/

router.get("/getAll", getAllRoles);
router.get("/getAll/:category", getAllRoles);
router.post("/add", addRole);
router.put("/update/:id", updateRole);
router.delete("/delete/:id", deleteRole);
router.get("/checkUsers/:id", checkUsersWithRole);
router.post("/reassignAndDelete/:id", reassignAndDeleteRole);

module.exports = router;