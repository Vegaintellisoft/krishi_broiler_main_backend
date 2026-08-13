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
    const tables = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema IN ('public', 'broiler')
      ORDER BY table_schema, table_name
    `);

    for (const t of tables.rows) {
      const fqn = `${t.table_schema}.${t.table_name}`;
      try {
        const cols = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_schema = $1 AND table_name = $2 AND data_type IN ('character varying', 'text', 'character')
        `, [t.table_schema, t.table_name]);

        if (cols.rows.length === 0) continue;

        const clauses = cols.rows.map(c => `UPPER("${c.column_name}") LIKE '%FSZ00987%'`).join(' OR ');
        const queryStr = `SELECT * FROM ${fqn} WHERE ${clauses} LIMIT 5`;
        const res = await client.query(queryStr);
        if (res.rows.length > 0) {
          console.log(`Found match in table: ${fqn}`);
          console.log(res.rows);
        }
      } catch (err) {
        // ignore errors
      }
    }
    console.log('Search finished.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
