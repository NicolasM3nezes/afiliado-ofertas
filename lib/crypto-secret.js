import crypto from "node:crypto";

function getKey() {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) throw new Error("APP_ENCRYPTION_KEY não configurada no servidor.");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encryptedSecret: encrypted.toString("base64"),
    secretIv: iv.toString("base64"),
    secretTag: tag.toString("base64"),
  };
}

export function decryptSecret({ encryptedSecret, secretIv, secretTag }) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(secretIv, "base64")
  );
  decipher.setAuthTag(Buffer.from(secretTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedSecret, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
