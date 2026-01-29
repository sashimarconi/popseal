const { Pool } = require("pg");

let pool;

function getConnectionString() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL_UNPOOLED ||
    ""
  );
}

function getPool() {
  const connectionString = getConnectionString();
  if (!connectionString) return null;
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function query(text, params) {
  const clientPool = getPool();
  if (!clientPool) {
    throw new Error("Database not configured");
  }
  return clientPool.query(text, params);
}

module.exports = { getConnectionString, query };
