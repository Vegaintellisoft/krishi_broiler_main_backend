/**
 * Migration: Add bluetooth_entry column to driver table
 * Run once: node add_bluetooth_entry_column.js
 */
require('dotenv').config();
const { query, connectDB } = require('./config/db');

(async () => {
    try {
        await connectDB();
        await query(`
            ALTER TABLE driver
            ADD COLUMN IF NOT EXISTS bluetooth_entry BOOLEAN DEFAULT FALSE
        `);
        console.log('✅ bluetooth_entry column added (or already exists) in driver table');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    }
})();
