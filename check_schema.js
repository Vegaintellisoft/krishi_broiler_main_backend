require('dotenv').config();
const { Client } = require('pg');
const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});
client.connect().then(async () => {
  const res = await client.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'broiler' AND table_name = 'bill_of_supply' ORDER BY ordinal_position"
  );
  console.log(JSON.stringify(res.rows, null, 2));
  client.end();
}).catch(e => {
  console.error(e.message);
  client.end();
});
