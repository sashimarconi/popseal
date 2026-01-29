const fs = require("fs/promises");
const path = require("path");
const formidable = require("formidable");
const { put } = require("@vercel/blob");
const { sql } = require("@vercel/postgres");

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

let comprovantesTableReady = false;

async function ensureComprovantesTable() {
  if (comprovantesTableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS comprovantes (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      transaction_id TEXT,
      customer_name TEXT,
      customer_cpf TEXT,
      customer_email TEXT,
      file_url TEXT,
      file_name TEXT,
      size_bytes INTEGER,
      mimetype TEXT,
      user_agent TEXT,
      ip TEXT
    )
  `;
  comprovantesTableReady = true;
}

function getFieldValue(value) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({ success: false, error: "Blob não configurado" });
    }

    if (!process.env.POSTGRES_URL && !process.env.POSTGRES_URL_NON_POOLING) {
      return res.status(500).json({ success: false, error: "Postgres não configurado" });
    }

    const form = formidable({
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

    const comprovante = files.comprovante;
    if (!comprovante) {
      return res.status(400).json({ success: false, error: "Arquivo de comprovante é obrigatório" });
    }

    const originalName = comprovante.originalFilename || "comprovante";
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tempPath = comprovante.filepath || comprovante.path;
    const fileBuffer = await fs.readFile(tempPath);
    const blobName = `comprovantes/${timestamp}_${safeName}`;

    const blob = await put(blobName, fileBuffer, {
      access: "private",
      contentType: comprovante.mimetype || comprovante.type || "application/octet-stream",
    });

    await fs.unlink(tempPath).catch(() => undefined);

    await ensureComprovantesTable();
    await sql`
      INSERT INTO comprovantes (
        transaction_id,
        customer_name,
        customer_cpf,
        customer_email,
        file_url,
        file_name,
        size_bytes,
        mimetype,
        user_agent,
        ip
      ) VALUES (
        ${getFieldValue(fields.transaction_id)},
        ${getFieldValue(fields.customer_name)},
        ${getFieldValue(fields.customer_cpf)},
        ${getFieldValue(fields.customer_email)},
        ${blob.url},
        ${path.basename(blob.pathname)},
        ${comprovante.size || 0},
        ${comprovante.mimetype || comprovante.type || ""},
        ${req.headers["user-agent"] || ""},
        ${req.headers["x-forwarded-for"] || req.socket?.remoteAddress || ""}
      )
    `;

    return res.status(200).json({ success: true, url: blob.url });
  } catch (error) {
    console.error("[UPLOAD] Erro:", error);
    return res.status(500).json({ success: false, error: "Erro ao salvar comprovante" });
  }
};
