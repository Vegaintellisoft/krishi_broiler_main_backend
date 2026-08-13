/**
 * Migration: Add sap_post_date column to broiler.bill_of_supply_dc
 * Run once: node add_sap_post_date_column.js
 */
require('dotenv').config();
const { query, connectDB } = require('./config/db');

(async () => {
    try {
        await connectDB();
        await query(`
            ALTER TABLE broiler.bill_of_supply_dc
            ADD COLUMN IF NOT EXISTS sap_post_date DATE
        `);
        console.log('✅ sap_post_date column added (or already exists) in broiler.bill_of_supply_dc');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    }
})();
