const db = require("../_db");

let leadsTableReady = false;

async function ensureLeadsTable() {
  if (leadsTableReady) return;
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
  leadsTableReady = true;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }

    if (!db.getConnectionString()) {
      return res.status(500).json({ success: false, message: "Database not configured" });
    }

    let body = req.body;
    if (typeof body === "string") {
      body = JSON.parse(body);
    }

    const cpf = String(body?.cpf || "").replace(/\D/g, "");
    const nome = String(body?.nome || "").trim();
    const email = String(body?.email || "").trim();
    const phone = String(body?.phone || "").replace(/\D/g, "");
    const nomeMae = String(body?.nome_mae || body?.nomeMae || "").trim();

    if (!cpf && !nome && !email && !phone) {
      return res.status(400).json({ success: false, message: "Dados insuficientes" });
    }

    const trackingRaw = body?.tracking && typeof body.tracking === "object" ? body.tracking : {};
    const tracking = { ...trackingRaw, nome_mae: nomeMae };

    await ensureLeadsTable();
    await db.query(
      "INSERT INTO leads (" +
        "source, cpf, nome, email, phone, amount_cents, title, transaction_id, status, tracking, user_agent, ip" +
      ") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        body?.source || "funnel",
        cpf,
        nome,
        email,
        phone,
        body?.amount_cents || null,
        body?.title || "Lead Funil",
        body?.transaction_id || "",
        body?.status || "LEAD",
        JSON.stringify(tracking || {}),
        body?.user_agent || req.headers["user-agent"] || "",
        req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
      ],
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[LEADS] Erro ao salvar lead:", error.message || error);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};
