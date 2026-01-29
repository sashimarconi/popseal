const fs = require("fs/promises");
const path = require("path");
const { IncomingForm } = require("formidable");
const { put } = require("@vercel/blob");
const db = require("../_db");

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

let comprovantesTableReady = false;

async function ensureComprovantesTable() {
  if (comprovantesTableReady) return;
  await db.query(
    "CREATE TABLE IF NOT EXISTS comprovantes (" +
      "id SERIAL PRIMARY KEY, " +
      "created_at TIMESTAMPTZ DEFAULT NOW(), " +
      "transaction_id TEXT, " +
      "customer_name TEXT, " +
      "customer_cpf TEXT, " +
      "customer_email TEXT, " +
      "file_url TEXT, " +
      "file_name TEXT, " +
      "size_bytes INTEGER, " +
      "mimetype TEXT, " +
      "user_agent TEXT, " +
      "ip TEXT" +
    ")",
  );
  comprovantesTableReady = true;
}

function getFieldValue(value) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function getFileValue(file) {
  if (Array.isArray(file)) return file[0];
  return file;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({ success: false, error: "Blob não configurado" });
    }

    if (!db.getConnectionString()) {
      return res.status(500).json({ success: false, error: "Postgres não configurado" });
    }

    const form = new IncomingForm({
      multiples: false,
      maxFileSize: MAX_FILE_SIZE,
      keepExtensions: true,
    });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, formFields, formFiles) => {
        if (err) return reject(err);
        resolve({ fields: formFields, files: formFiles });
      });
    });

    const comprovante = getFileValue(files.comprovante);
    if (!comprovante) {
      return res.status(400).json({ success: false, error: "Arquivo de comprovante é obrigatório" });
    }

    const originalName = comprovante.originalFilename || "comprovante";
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tempPath = comprovante.filepath || comprovante.path;
    if (!tempPath) {
      return res.status(400).json({ success: false, error: "Arquivo inválido (sem path)" });
    }
    const fileBuffer = await fs.readFile(tempPath);
    const blobName = `comprovantes/${timestamp}_${safeName}`;

    const blob = await put(blobName, fileBuffer, {
      access: "private",
      contentType: comprovante.mimetype || comprovante.type || "application/octet-stream",
    });

    await fs.unlink(tempPath).catch(() => undefined);

    await ensureComprovantesTable();
    await db.query(
      "INSERT INTO comprovantes (" +
        "transaction_id, customer_name, customer_cpf, customer_email, file_url, file_name, size_bytes, mimetype, user_agent, ip" +
      ") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        getFieldValue(fields.transaction_id),
        getFieldValue(fields.customer_name),
        getFieldValue(fields.customer_cpf),
        getFieldValue(fields.customer_email),
        blob.url,
        path.basename(blob.pathname),
        comprovante.size || 0,
        comprovante.mimetype || comprovante.type || "",
        req.headers["user-agent"] || "",
        req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
      ],
    );

    return res.status(200).json({ success: true, url: blob.url });
  } catch (error) {
    console.error("[UPLOAD] Erro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao salvar comprovante",
      detail: String(error?.message || error),
    });
  }
};
