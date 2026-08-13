const { query } = require('../../config/db');

// GET ALL
const getAllFeedDetails = async (req, res) => {
    try {
        const result = await query(
            `SELECT * FROM breeder.feed_details ORDER BY id DESC`
        );
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET BY ID
const getFeedDetailById = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await query(
            `SELECT * FROM breeder.feed_details WHERE id = $1`,
            [id]
        );
        if (result.length === 0)
            return res.status(404).json({ success: false, message: 'Record not found' });

        res.status(200).json({ success: true, data: result[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// CREATE
const createFeedDetail = async (req, res) => {
    try {
        const {
            date,
            chick_crumbles_uom, grower_mash_uom, finisher_pellet_uom,
            chick_crumbles_avl_stock, grower_mash_avl_stock, finisher_pellet_avl_stock,
            chick_crumbles_con_qty, grower_mash_con_qty, finisher_pellet_con_qty
        } = req.body;

        const result = await query(
            `INSERT INTO breeder.feed_details (
                date,
                chick_crumbles_uom, grower_mash_uom, finisher_pellet_uom,
                chick_crumbles_avl_stock, grower_mash_avl_stock, finisher_pellet_avl_stock,
                chick_crumbles_con_qty, grower_mash_con_qty, finisher_pellet_con_qty
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            ) RETURNING *`,
            [
                date,
                chick_crumbles_uom, grower_mash_uom, finisher_pellet_uom,
                chick_crumbles_avl_stock, grower_mash_avl_stock, finisher_pellet_avl_stock,
                chick_crumbles_con_qty, grower_mash_con_qty, finisher_pellet_con_qty
            ]
        );
        res.status(201).json({ success: true, data: result[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
        console.log("Error in createFeedDetail", error);
    }
};

// UPDATE
const updateFeedDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            date,
            chick_crumbles_uom, grower_mash_uom, finisher_pellet_uom,
            chick_crumbles_avl_stock, grower_mash_avl_stock, finisher_pellet_avl_stock,
            chick_crumbles_con_qty, grower_mash_con_qty, finisher_pellet_con_qty
        } = req.body;

        const result = await query(
            `UPDATE breeder.feed_details SET
                date = $1,
                chick_crumbles_uom = $2, grower_mash_uom = $3, finisher_pellet_uom = $4,
                chick_crumbles_avl_stock = $5, grower_mash_avl_stock = $6, finisher_pellet_avl_stock = $7,
                chick_crumbles_con_qty = $8, grower_mash_con_qty = $9, finisher_pellet_con_qty = $10
            WHERE id = $11
            RETURNING *`,
            [
                date,
                chick_crumbles_uom, grower_mash_uom, finisher_pellet_uom,
                chick_crumbles_avl_stock, grower_mash_avl_stock, finisher_pellet_avl_stock,
                chick_crumbles_con_qty, grower_mash_con_qty, finisher_pellet_con_qty,
                id
            ]
        );
        if (result.length === 0)
            return res.status(404).json({ success: false, message: 'Record not found' });

        res.status(200).json({ success: true, data: result[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE
const deleteFeedDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await query(
            `DELETE FROM breeder.feed_details WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.length === 0)
            return res.status(404).json({ success: false, message: 'Record not found' });

        res.status(200).json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getAllFeedDetails,
    getFeedDetailById,
    createFeedDetail,
    updateFeedDetail,
    deleteFeedDetail
};