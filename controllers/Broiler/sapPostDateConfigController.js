const { query } = require('../../config/db');

// GET /api/broiler/sap-post-date-config  — returns the single config row
exports.getConfig = async (req, res) => {
    try {
        const result = await query(
            `SELECT * FROM broiler.sap_post_date_config ORDER BY id LIMIT 1`
        );
        if (result.length === 0) {
            return res.status(404).json({ status: false, message: 'Config not found' });
        }
        res.status(200).json({ status: true, data: result[0] });
    } catch (err) {
        console.error('Error fetching SAP post date config:', err);
        res.status(500).json({ status: false, message: err.message });
    }
};

// PUT /api/broiler/sap-post-date-config  — update allowed_days
exports.updateConfig = async (req, res) => {
    try {
        const { allowed_days, updated_by } = req.body;

        if (allowed_days === undefined || allowed_days === null || allowed_days === '') {
            return res.status(400).json({ status: false, message: 'allowed_days is required' });
        }

        const days = Number(allowed_days);
        if (!Number.isInteger(days) || days < 0) {
            return res.status(400).json({ status: false, message: 'allowed_days must be a non-negative integer' });
        }

        const result = await query(
            `UPDATE broiler.sap_post_date_config
             SET allowed_days = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = (SELECT id FROM broiler.sap_post_date_config ORDER BY id LIMIT 1)
             RETURNING *`,
            [days, updated_by || 'Admin']
        );

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: 'Config row not found' });
        }

        res.status(200).json({
            status: true,
            message: `SAP Post Date config updated. Allowed days: ${days}`,
            data: result[0]
        });
    } catch (err) {
        console.error('Error updating SAP post date config:', err);
        res.status(500).json({ status: false, message: err.message });
    }
};
