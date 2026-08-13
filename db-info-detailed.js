/**
 * db-info-detailed.js
 * Detailed diagnostics for the Broiler Dashboard.
 * Shows table schemas and sample data for troubleshooting.
 * Usage: node db-info-detailed.js
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

async function checkTable(client, schema, table) {
  const fqn = `${schema}.${table}`;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  TABLE: ${fqn}`);
  console.log('─'.repeat(60));

  // Check existence
  const exists = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2
    ) AS exists
  `, [schema, table]);

  if (!exists.rows[0].exists) {
    console.log(`  ✘  Table does NOT EXIST on this database.\n`);
    return;
  }

  // Column info
  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `, [schema, table]);

  console.log(`  Columns (${cols.rows.length}):`);
  cols.rows.forEach(c => {
    console.log(`    - ${c.column_name.padEnd(30)} ${c.data_type}`);
  });

  // Row count
  const count = await client.query(`SELECT COUNT(*) FROM ${fqn}`);
  console.log(`\n  Row count: ${count.rows[0].count}`);

  // Sample rows
  try {
    const sample = await client.query(`SELECT * FROM ${fqn} ORDER BY 1 DESC LIMIT 3`);
    if (sample.rows.length > 0) {
      console.log(`\n  Latest 3 rows:`);
      sample.rows.forEach((r, i) => console.log(`  [${i+1}]`, JSON.stringify(r)));
    }
  } catch (e) {
    console.log(`  (Could not fetch sample rows: ${e.message})`);
  }
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('\n========================================');
    console.log(' Broiler Dashboard — DB Detailed Info');
    console.log('========================================');
    console.log(`  Host    : ${process.env.DB_HOST}`);
    console.log(`  Database: ${process.env.DB_DATABASE}\n`);

    await checkTable(client, 'public', 'user_login_logs');
    await checkTable(client, 'broiler', 'farm_activity');
    await checkTable(client, 'broiler', 'plant');
    await checkTable(client, 'broiler', 'farmer');
    await checkTable(client, 'public', 'driver');
    await checkTable(client, 'public', 'admin');

    // Dashboard report test query
    console.log('\n\n========================================');
    console.log(' Dashboard Report Test Query');
    console.log('========================================');
    try {
      const report = await client.query(`
        SELECT
          TO_CHAR(fa.date::date, 'YYYY-MM-DD') AS period_date,
          fa.plant,
          COUNT(*)::int AS posted
        FROM broiler.farm_activity fa
        WHERE fa.date::date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY period_date, fa.plant
        ORDER BY period_date DESC
        LIMIT 5
      `);
      console.log(`  Found ${report.rows.length} rows. Sample:`);
      report.rows.forEach(r => console.log(' ', JSON.stringify(r)));
    } catch(e) {
      console.log(`  ✘ Report query failed: ${e.message}`);
    }

    console.log('\n✅ Done.\n');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
