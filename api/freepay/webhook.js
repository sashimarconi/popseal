const db = require("../_db");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }

    let body = req.body;
    if (typeof body === "string") {
      body = JSON.parse(body);
    }

    const data = Array.isArray(body?.data) ? body.data[0] : body?.data || body;
    const statusRaw = data?.status || body?.status || "";
    const status = String(statusRaw).toUpperCase();
    const event = body?.event || body?.type || "";
    const id =
      data?.transactionId ||
      data?.transaction_id ||
      data?.id ||
      body?.transactionId ||
      body?.transaction_id ||
      body?.id ||
      "";

    console.log("[BLACKCAT WEBHOOK]", { id, status, event, payload: body });

    const isPaid = event === "transaction.paid" || status === "PAID";

    if (isPaid && id && db.getConnectionString()) {
      await db.query("UPDATE leads SET status = $1 WHERE transaction_id = $2", ["PAID", String(id)]);
      await db.query("UPDATE comprovantes SET status = $1 WHERE transaction_id = $2", ["paid", String(id)]);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[BLACKCAT WEBHOOK] erro:", error);
    return res.status(500).json({ success: false });
  }
};
