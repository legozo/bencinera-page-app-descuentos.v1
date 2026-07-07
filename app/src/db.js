const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "db",
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "gasolinera",
  password: process.env.DB_PASSWORD || "changeme",
  database: process.env.DB_NAME || "gasolinera",
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
