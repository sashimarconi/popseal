const db = require("../_db");

const UTMIFY_API_URL = "https://api.utmify.com.br/api-credentials/orders";

function formatUtcDate(date) {
  const iso = new Date(date).toISOString();
  return iso.replace("T", " ").substring(0, 19);
}

async function sendUtmifyPaid({ token, orderId, createdAt, approvedDate, customer, products, trackingParameters, totalPriceInCents }) {
  if (!token) return;
  const payload = {
    orderId: String(orderId),
    platform: "Blackcat",
    paymentMethod: "pix",
    status: "paid",
    createdAt: formatUtcDate(createdAt),
    approvedDate: formatUtcDate(approvedDate || new Date()),
    refundedAt: null,
    customer,
    products,
    trackingParameters,
    commission: {
      totalPriceInCents,
      gatewayFeeInCents: 0,
      userCommissionInCents: totalPriceInCents,
    },
    isTest: false,
  };

  try {
    const resp = await fetch(UTMIFY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": token,
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("[UTMIFY] Erro ao enviar pago:", resp.status, data);
    }
  } catch (error) {
    console.error("[UTMIFY] Falha ao enviar pago:", error.message || error);
  }
}

async function safeGetLeadByTransactionId(id) {
  if (!db.getConnectionString()) return null;
  try {
    const result = await db.query(
      "SELECT id, created_at, cpf, nome, email, phone, amount_cents, title, tracking FROM leads WHERE transaction_id = $1 ORDER BY created_at DESC LIMIT 1",
      [String(id)],
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error("[BLACKCAT WEBHOOK] erro ao buscar lead:", error.message || error);
    return null;
  }
}

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

    if (isPaid && id) {
      if (db.getConnectionString()) {
        await db.query("UPDATE leads SET status = $1 WHERE transaction_id = $2", ["PAID", String(id)]);
        await db.query("UPDATE comprovantes SET status = $1 WHERE transaction_id = $2", ["paid", String(id)]);
      }

      const UTMIFY_API_TOKEN = process.env.UTMIFY_API_TOKEN;
      const lead = await safeGetLeadByTransactionId(id);
      const tracking = lead?.tracking ? JSON.parse(lead.tracking) : {};
      const utm = tracking?.utm || {};

      await sendUtmifyPaid({
        token: UTMIFY_API_TOKEN,
        orderId: id,
        createdAt: lead?.created_at || new Date(),
        approvedDate: new Date(),
        customer: {
          name: lead?.nome || "",
          email: lead?.email || "",
          phone: lead?.phone || null,
          document: lead?.cpf || null,
          country: "BR",
          ip: null,
        },
        products: [
          {
            id: "taxa_adesao",
            name: lead?.title || "Taxa de Adesão",
            planId: null,
            planName: null,
            quantity: 1,
            priceInCents: lead?.amount_cents || 0,
          },
        ],
        trackingParameters: {
          src: tracking?.src || utm?.src || null,
          sck: tracking?.sck || utm?.sck || null,
          utm_source: utm?.utm_source || utm?.source || null,
          utm_campaign: utm?.utm_campaign || null,
          utm_medium: utm?.utm_medium || null,
          utm_content: utm?.utm_content || null,
          utm_term: utm?.utm_term || null,
        },
        totalPriceInCents: lead?.amount_cents || 0,
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[BLACKCAT WEBHOOK] erro:", error);
    return res.status(500).json({ success: false });
  }
};
