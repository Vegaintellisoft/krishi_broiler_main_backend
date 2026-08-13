const express = require('express');
const router = express.Router();
const {
    getAllFeedDetails,
    getFeedDetailById,
    createFeedDetail,
    updateFeedDetail,
    deleteFeedDetail
} = require('../../controllers/Breeder/feedDetailsController');

router.get('/', getAllFeedDetails);
router.get('/:id', getFeedDetailById);
router.post('/', createFeedDetail);
router.put('/:id', updateFeedDetail);
router.delete('/:id', deleteFeedDetail);

module.exports = router;