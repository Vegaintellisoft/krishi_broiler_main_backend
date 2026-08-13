/**
 * Migration: Create broiler.sap_post_date_config table
 * Run once: node add_sap_post_date_config.js
 */
require('dotenv').config();
const { query, connectDB } = require('./config/db');

(async () => {
    try {
        await connectDB();

        // Create the config table
        await query(`
            CREATE TABLE IF NOT EXISTS broiler.sap_post_date_config (
                id SERIAL PRIMARY KEY,
                allowed_days INTEGER NOT NULL DEFAULT 3,
                updated_by VARCHAR(100),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Insert default row if empty
        const existing = await query(`SELECT id FROM broiler.sap_post_date_config LIMIT 1`);
        if (existing.length === 0) {
            await query(`INSERT INTO broiler.sap_post_date_config (allowed_days, updated_by) VALUES (3, 'System')`);
            console.log('✅ Default config row inserted (allowed_days = 3)');
        } else {
            console.log('ℹ️  Config row already exists, skipping insert.');
        }

        console.log('✅ broiler.sap_post_date_config table ready.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    }
})();
