import crypto from "node:crypto";

function keyFromSecret(secret) {
  return crypto.createHash("sha256").update(secret).digest();
}

function getPrimarySecret() {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) {
    const error = new Error("APP_ENCRYPTION_KEY não configurada no servidor.");
    error.code = "ENCRYPTION_KEY_MISSING";
    error.status = 500;
    throw error;
  }
  return secret;
}

function getDecryptionSecrets() {
  const primary = getPrimarySecret();
  const previous = String(process.env.APP_ENCRYPTION_KEY_PREVIOUS || "").trim();
  return [...new Set([primary, previous].filter(Boolean))];
}

function decryptWithSecret({ encryptedSecret, secretIv, secretTag }, secret) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyFromSecret(secret),
    Buffer.from(secretIv, "base64")
  );
  decipher.setAuthTag(Buffer.from(secretTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedSecret, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFromSecret(getPrimarySecret()), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encryptedSecret: encrypted.toString("base64"),
    secretIv: iv.toString("base64"),
    secretTag: tag.toString("base64"),
  };
}

export function decryptSecret(payload) {
  let lastError = null;

  for (const secret of getDecryptionSecrets()) {
    try {
      return decryptWithSecret(payload, secret);
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error(
    "Não consegui abrir a credencial criptografada. A chave local de criptografia mudou; salve a conexão novamente."
  );
  error.code = "CREDENTIALS_RECONNECT_REQUIRED";
  error.status = 409;
  error.cause = lastError;
  throw error;
}

export function sealServerValue(value) {
  const encrypted = encryptSecret(JSON.stringify(value));
  return Buffer.from(JSON.stringify(encrypted), "utf8").toString("base64url");
}

export function unsealServerValue(value) {
  try {
    const payload = JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
    return JSON.parse(decryptSecret(payload));
  } catch (cause) {
    const error = new Error("Estado OAuth inválido ou expirado.");
    error.code = "INVALID_OAUTH_STATE";
    error.status = 400;
    error.cause = cause;
    throw error;
  }
}
