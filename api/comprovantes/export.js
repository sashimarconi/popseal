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

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
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
    const limit = Math.min(Number(req.query.limit || 500), 5000);
    const result = await db.query(
      "SELECT id, created_at, transaction_id, customer_name, customer_cpf, customer_email, customer_phone, status, file_url, 'comprovante' AS source FROM comprovantes " +
        "UNION ALL " +
        "SELECT id, created_at, transaction_id, nome AS customer_name, cpf AS customer_cpf, email AS customer_email, phone AS customer_phone, status, NULL AS file_url, 'lead' AS source FROM leads " +
        "ORDER BY created_at DESC LIMIT $1",
      [limit],
    );

    const header = [
      "id",
      "created_at",
      "transaction_id",
      "customer_name",
      "customer_cpf",
      "customer_email",
      "customer_phone",
      "status",
      "file_url",
      "source",
    ];

    const lines = [header.join(",")].concat(
      result.rows.map((row) =>
        header.map((key) => csvEscape(row[key])).join(","),
      ),
    );

    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=comprovantes.csv");
    return res.status(200).send(csv);
  } catch (error) {
    console.error("[COMPROVANTES EXPORT] erro:", error);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};
