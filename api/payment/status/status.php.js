const BASE_URL = process.env.BLACKCAT_BASE_URL || "https://api.blackcatpagamentos.online/api";

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    const BLACKCAT_API_KEY = process.env.BLACKCAT_API_KEY;
    if (!BLACKCAT_API_KEY) {
      return res.status(500).json({ success: false, message: "Credenciais da Blackcat não configuradas" });
    }

    const id = String(req.query.id || req.query.transaction_id || "").trim();
    if (!id) return res.status(400).json({ success: false, message: "id é obrigatório" });

    const url = `${BASE_URL}/sales/${encodeURIComponent(id)}/status`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-API-Key": BLACKCAT_API_KEY,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      const txData = Array.isArray(data?.data) ? data.data[0] : data?.data || data;
      const status = txData?.status || data?.status || data?.payment_status || "PENDING";
      return res.json({ success: true, status, transaction: txData || data });
    }

    return res.status(502).json({
      success: false,
      message: "Não foi possível consultar status",
      response: { status: response.status, data },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Erro interno", error: String(e?.message || e) });
  }
};
