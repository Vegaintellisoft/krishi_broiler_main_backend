const router = require('express').Router();

const { getAll, create, submit, getOne, remove, update, saveDraft, completeDraft, getDraftById, getDrafts, deleteDraft } = require("../../controllers/Broiler/broilerSupplyController");

router.post("/create", create);
router.post("/submit", submit);
router.get("/getAll", getAll);

router.get("/getOne/:id", getOne);
router.put("/update", update);
router.delete("/remove/:id", remove);
router.post(
    '/save-draft',
    saveDraft
);

router.put(
    "/complete-draft/:id",
    completeDraft
);

router.get("/drafts", getDrafts);

router.get("/draft/:id", getDraftById);
router.delete("/draft/:id", deleteDraft || remove);


module.exports = router;

