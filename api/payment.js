// Blackcat API Integration
// Pagamento via PIX com Blackcat Gateway

const db = require("./_db");

const BASE_URL = process.env.BLACKCAT_BASE_URL || "https://api.blackcatpagamentos.online/api";

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

async function saveLead(data) {
  if (!db.getConnectionString()) return;
  try {
    await ensureLeadsTable();
    await db.query(
      "INSERT INTO leads (" +
        "source, cpf, nome, email, phone, amount_cents, title, transaction_id, status, tracking, user_agent, ip" +
      ") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        data.source || "",
        data.cpf || "",
        data.nome || "",
        data.email || "",
        data.phone || "",
        data.amount_cents || null,
        data.title || "",
        data.transaction_id || "",
        data.status || "",
        data.tracking || "",
        data.user_agent || "",
        data.ip || "",
      ],
    );
  } catch (error) {
    console.error("[PAYMENT] Falha ao salvar lead:", error.message);
  }
}

async function handlePaymentRequest(req, res) {
  // Handle OPTIONS
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const BLACKCAT_API_KEY = process.env.BLACKCAT_API_KEY;
    const BLACKCAT_POSTBACK_URL = process.env.BLACKCAT_POSTBACK_URL;

    if (!BLACKCAT_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "Credenciais da Blackcat não configuradas",
      });
    }

    if (!BLACKCAT_POSTBACK_URL) {
      return res.status(500).json({
        success: false,
        message: "BLACKCAT_POSTBACK_URL não configurada",
      });
    }

    // Parse body
    let bodyData = req.body;
    if (typeof bodyData === "string") {
      bodyData = JSON.parse(bodyData);
    }

    const { cpf, nome, email, phone, amount, title, description } = bodyData;
    const customerFromBody = bodyData.customer && typeof bodyData.customer === "object"
      ? bodyData.customer
      : null;

    console.log("[PAYMENT] Dados recebidos:", { cpf, nome, email, phone });

    // Validação
    const validCpf = (cpf ?? customerFromBody?.taxId)?.toString().trim();
    const validNome = (nome ?? customerFromBody?.name)?.toString().trim();
    const validEmail = (email ?? customerFromBody?.email)?.toString().trim();
    const validPhone = (phone ?? customerFromBody?.cellphone)?.toString().trim();

    if (!validNome || !validEmail) {
      return res.status(400).json({
        success: false,
        message: "Nome e Email são obrigatórios",
      });
    }

    const FIXED_AMOUNT = amount || process.env.FIXED_AMOUNT || "64.73";
    const FIXED_TITLE = description || title || "Taxa de Adesão";

    const normalizeAmountToCents = (value) => {
      if (value === undefined || value === null || value === "") {
        const parsed = Number(String(FIXED_AMOUNT).replace(",", "."));
        return Math.round(parsed * 100);
      }
      if (typeof value === "string" && (value.includes(",") || value.includes("."))) {
        const parsed = Number(value.replace(",", "."));
        return Math.round(parsed * 100);
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return 0;
      if (!Number.isInteger(numeric)) {
        return Math.round(numeric * 100);
      }
      // Heurística: valores pequenos (<= 1000) tratamos como reais
      if (numeric <= 1000) return numeric * 100;
      return numeric;
    };

    const amountCents = normalizeAmountToCents(amount);

    if (!amountCents || amountCents < 100) {
      return res.status(400).json({
        success: false,
        message: "Amount inválido (mínimo 100 centavos)",
      });
    }

    const customer = {
      name: customerFromBody?.name || validNome,
      email: customerFromBody?.email || validEmail,
      cellphone: (customerFromBody?.cellphone || validPhone || "").toString().replace(/\D/g, ""),
      taxId: (customerFromBody?.taxId || validCpf || "").toString().replace(/\D/g, ""),
    };

    const trackingFromBody = bodyData.tracking;
    const tracking = (() => {
      if (trackingFromBody && typeof trackingFromBody === "object" && !Array.isArray(trackingFromBody)) {
        const utm = typeof trackingFromBody.utm === "object" && trackingFromBody.utm ? trackingFromBody.utm : {};
        const src = trackingFromBody.src || bodyData.src || req.headers.referer || "";
        return { utm, src };
      }
      if (typeof trackingFromBody === "string") {
        return { utm: {}, src: trackingFromBody };
      }
      const utm = typeof bodyData.utm === "object" && bodyData.utm ? bodyData.utm : {};
      const src = bodyData.src || req.headers.referer || "";
      return { utm, src };
    })();

    const documentType = customer.taxId && customer.taxId.length > 11 ? "cnpj" : "cpf";
    const payload = {
      amount: amountCents,
      currency: "BRL",
      paymentMethod: "pix",
      items: [
        {
          title: FIXED_TITLE,
          unitPrice: amountCents,
          quantity: 1,
          tangible: false,
        },
      ],
      customer: {
        name: customer.name,
        email: customer.email,
        phone: customer.cellphone,
        document: {
          type: documentType,
          number: customer.taxId,
        },
      },
      pix: {
        expiresInDays: 1,
      },
      postbackUrl: BLACKCAT_POSTBACK_URL,
      externalRef: "taxa_adesao",
      metadata: JSON.stringify({
        source: "popseal",
        cpf: customer.taxId,
        email: customer.email,
      }),
      utm_source: tracking?.utm?.utm_source || tracking?.utm?.source || tracking?.src || undefined,
      utm_medium: tracking?.utm?.utm_medium || undefined,
      utm_campaign: tracking?.utm?.utm_campaign || undefined,
      utm_content: tracking?.utm?.utm_content || undefined,
      utm_term: tracking?.utm?.utm_term || undefined,
    };

    const userAgent = bodyData.user_agent || req.headers["user-agent"] || "";

    await saveLead({
      timestamp: new Date().toISOString(),
      source: "payment_request",
      cpf: validCpf || "",
      nome: validNome || "",
      email: validEmail || "",
      phone: validPhone || "",
      amount_cents: amountCents,
      title: FIXED_TITLE,
      tracking: JSON.stringify(tracking || {}),
      user_agent: userAgent,
      ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
    });

    console.log("[PAYMENT] Enviando para Blackcat...");

    const resp = await fetch(`${BASE_URL}/sales/create-sale`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-API-Key": BLACKCAT_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("[PAYMENT] Erro Blackcat:", resp.status, data);
      return res.status(502).json({
        success: false,
        message: data?.error || "Falha ao criar PIX",
        detalhes: data?.details || data?.detalhes,
      });
    }

    const txData = Array.isArray(data?.data) ? data.data[0] : data?.data || data;
    const tx = txData?.transactionId || txData?.id || txData?.transaction_id || txData?.txid;
    const paymentData = txData?.paymentData || {};
    const pixText =
      paymentData?.copyPaste ||
      paymentData?.qrCode ||
      txData?.pix_code ||
      txData?.qr_code ||
      "";
    const pixQr =
      paymentData?.qrCodeBase64 ||
      paymentData?.qrCode ||
      txData?.pix_qr_code ||
      txData?.qr_code_image ||
      txData?.qr_code ||
      "";
    const looksLikeBase64 = (value) =>
      typeof value === "string" &&
      value.length > 100 &&
      /^[A-Za-z0-9+/=\s]+$/.test(value);
    const normalizeQrUrl = (value) => {
      if (!value) return value;
      const withScheme = !value.startsWith("http") && value.includes("/")
        ? `https://${value}`
        : value;
      return withScheme.startsWith("http") ? encodeURI(withScheme) : withScheme;
    };
    const pixQrWithPrefix = pixQr
      ? pixQr.startsWith("data:image")
        ? pixQr
        : pixQr.startsWith("http")
          ? pixQr
          : pixQr.startsWith("base64,")
            ? `data:image/png;${pixQr}`
            : looksLikeBase64(pixQr)
              ? `data:image/png;base64,${pixQr.trim()}`
              : normalizeQrUrl(pixQr)
      : "";

    if (!tx || !pixText) {
      return res.status(502).json({
        success: false,
        message: "Gateway não retornou dados esperados",
      });
    }

    await saveLead({
      timestamp: new Date().toISOString(),
      source: "payment_response",
      cpf: validCpf || "",
      nome: validNome || "",
      email: validEmail || "",
      phone: validPhone || "",
      amount_cents: txData?.amount || amountCents,
      title: FIXED_TITLE,
      transaction_id: String(tx),
      status: String(txData?.status || "PENDING"),
    });

    return res.status(200).json({
      success: true,
      transaction_id: String(tx),
      pix_code: String(pixText),
      amount: txData?.amount || amountCents,
      status: String(txData?.status || "PENDING"),
      qr_code: pixQrWithPrefix,
      pix_qr_code: pixQrWithPrefix,
    });

  } catch (error) {
    console.error("[PAYMENT] Erro:", error.message);
    return res.status(500).json({
      success: false,
      message: "Erro interno",
      error: error.message,
    });
  }
}

module.exports = handlePaymentRequest;
