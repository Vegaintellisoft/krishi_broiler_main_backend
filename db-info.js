/**
 * db-info.js
 * Quick connectivity check + summary of key broiler tables on the server DB.
 * Usage: node db-info.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: false,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('\n✅ Connected to PostgreSQL\n');
    console.log(`  Host    : ${process.env.DB_HOST}`);
    console.log(`  Database: ${process.env.DB_DATABASE}`);
    console.log(`  User    : ${process.env.DB_USER}\n`);

    const checks = [
      { label: 'broiler.farm_activity rows',  sql: `SELECT COUNT(*) FROM broiler.farm_activity` },
      { label: 'broiler.plant rows',           sql: `SELECT COUNT(*) FROM broiler.plant` },
      { label: 'broiler.farmer rows',          sql: `SELECT COUNT(*) FROM broiler.farmer` },
      { label: 'public.user_login_logs rows',  sql: `SELECT COUNT(*) FROM public.user_login_logs` },
      { label: 'public.driver rows',           sql: `SELECT COUNT(*) FROM public.driver` },
      { label: 'public.admin rows',            sql: `SELECT COUNT(*) FROM public.admin` },
    ];

    for (const check of checks) {
      try {
        const res = await client.query(check.sql);
        console.log(`  ✔  ${check.label}: ${res.rows[0].count}`);
      } catch (err) {
        console.log(`  ✘  ${check.label}: MISSING or ERROR — ${err.message}`);
      }
    }

    console.log('\nDone.\n');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
