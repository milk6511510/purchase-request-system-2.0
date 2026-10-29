const { Pool } = require("pg");

let pool;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("尚未設定 Neon 資料庫連線，請在伺服器環境設定 DATABASE_URL");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX) || 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 7000,
      application_name: "aiwa-purchase-request"
    });
  }
  return pool;
}

function query(text, values) {
  return getPool().query(text, values);
}

async function withTransaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}

module.exports = { query, withTransaction, closePool };
