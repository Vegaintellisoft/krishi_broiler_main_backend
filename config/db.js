const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: false,
  // ssl: {
  //   rejectUnauthorized: true,
  //   ca: process.env.DB_CA,
  // }
});


const connectDB = async () => {
  try {
    await pool.connect();
    console.log('Connected to PostgreSQL database');
    dbStatus();
  } catch (err) {
    console.error('Database connection error:', err);
  }
};

const query = async (qry, params = []) => {
  try {
    const res = await pool.query(qry, params);
    return res.rows;
  } catch (err) {
    console.error("Query Exec Error: \n", err);
    throw err;  // re-throw so callers get proper error messages instead of undefined
  }
}

const dbStatus = async () => {
  const dbInfo = await query("SELECT current_database(), current_schema()");
  console.log("DB Connected:", dbInfo);
}


module.exports = { pool, connectDB, query, dbStatus };
