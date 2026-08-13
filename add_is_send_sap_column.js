/**
 * Migration: Add is_send_sap column to broiler.bill_of_supply_dc
 * Run once on server: node add_is_send_sap_column.js
 */
require('dotenv').config();
const { query, connectDB } = require('./config/db');

(async () => {
    try {
        await connectDB();
        await query(`
            ALTER TABLE broiler.bill_of_supply_dc
            ADD COLUMN IF NOT EXISTS is_send_sap BOOLEAN DEFAULT false
        `);
        console.log('✅ is_send_sap column added (or already exists) in broiler.bill_of_supply_dc');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    }
})();
