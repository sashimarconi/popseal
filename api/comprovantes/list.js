const db = require("../_db");

let tableReady = false;
let leadsReady = false;

async function ensureComprovantesTable() {
  if (tableReady) return;
  await db.query(
    "CREATE TABLE IF NOT EXISTS comprovantes (" +
      "id SERIAL PRIMARY KEY, " +
      "created_at TIMESTAMPTZ DEFAULT NOW(), " +
      "transaction_id TEXT, " +
      "customer_name TEXT, " +
      "customer_cpf TEXT, " +
      "customer_email TEXT, " +
      "customer_phone TEXT, " +
      "file_url TEXT, " +
      "file_name TEXT, " +
      "size_bytes INTEGER, " +
      "mimetype TEXT, " +
      "status TEXT, " +
      "user_agent TEXT, " +
      "ip TEXT" +
    ")",
  );
  await db.query("ALTER TABLE comprovantes ADD COLUMN IF NOT EXISTS status TEXT");
  await db.query("ALTER TABLE comprovantes ADD COLUMN IF NOT EXISTS customer_phone TEXT");
  tableReady = true;
}

async function ensureLeadsTable() {
  if (leadsReady) return;
  await db.query(
    "CREATE TABLE IF NOT EXISTS leads (" +
      "id SERIAL PRIMARY KEY, " +
      "created_at TIMESTAMPTZ DEFAULT NOW(), " +
      "source TEXT, " +
      "cpf TEXT, " +
      "nome TEXT, " +
      "email TEXT, " +
      "phone TEXT, " +
      "amount_cents INTEGER, " +
      "title TEXT, " +
      "transaction_id TEXT, " +
      "status TEXT, " +
      "tracking TEXT, " +
      "user_agent TEXT, " +
      "ip TEXT" +
    ")",
  );
  await db.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS status TEXT");
  leadsReady = true;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }

    if (!db.getConnectionString()) {
      return res.status(500).json({ success: false, message: "Database not configured" });
    }

    const adminToken = process.env.ADMIN_TOKEN;
    const token = req.headers["x-admin-token"] || req.query.token || "";

    if (adminToken && token !== adminToken) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    await ensureComprovantesTable();
    await ensureLeadsTable();
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const result = await db.query(
      "SELECT id, created_at, transaction_id, customer_name, customer_cpf, customer_email, customer_phone, file_url, file_name, size_bytes, mimetype, status, 'comprovante' AS source FROM comprovantes " +
        "UNION ALL " +
        "SELECT id, created_at, transaction_id, nome AS customer_name, cpf AS customer_cpf, email AS customer_email, phone AS customer_phone, NULL AS file_url, NULL AS file_name, NULL AS size_bytes, NULL AS mimetype, status, 'lead' AS source FROM leads " +
        "ORDER BY created_at DESC LIMIT $1",
      [limit],
    );

    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[COMPROVANTES LIST] erro:", error);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};
