import { NextResponse } from "next/server";
import { decryptSecret, encryptSecret } from "@/lib/crypto-secret";
import { getAuthenticatedServerClient } from "@/lib/server-auth";

function decryptField(connection, prefix) {
  const encryptedSecret = connection[`${prefix}_encrypted`];
  const secretIv = connection[`${prefix}_iv`];
  const secretTag = connection[`${prefix}_tag`];
  if (!encryptedSecret || !secretIv || !secretTag) return null;
  return decryptSecret({ encryptedSecret, secretIv, secretTag });
}

function writeEncryptedField(target, prefix, value) {
  if (!value) return;
  const encrypted = encryptSecret(value);
  target[`${prefix}_encrypted`] = encrypted.encryptedSecret;
  target[`${prefix}_iv`] = encrypted.secretIv;
  target[`${prefix}_tag`] = encrypted.secretTag;
}

export async function POST(request) {
  try {
    if (!String(process.env.APP_ENCRYPTION_KEY_PREVIOUS || "").trim()) {
      return NextResponse.json(
        { error: "APP_ENCRYPTION_KEY_PREVIOUS não está configurada. A rotação só deve ser executada durante uma troca de chave." },
        { status: 409 }
      );
    }

    const { supabase } = await getAuthenticatedServerClient(request);
    const { data: connections, error } = await supabase
      .from("marketplace_connections")
      .select("id,marketplace_slug,encrypted_secret,secret_iv,secret_tag,oauth_access_token_encrypted,oauth_access_token_iv,oauth_access_token_tag,oauth_refresh_token_encrypted,oauth_refresh_token_iv,oauth_refresh_token_tag");
    if (error) throw error;

    const rotated = [];
    const failed = [];

    for (const connection of connections || []) {
      try {
        const clientSecret = decryptSecret({
          encryptedSecret: connection.encrypted_secret,
          secretIv: connection.secret_iv,
          secretTag: connection.secret_tag,
        });
        const next = {};
        const encryptedClientSecret = encryptSecret(clientSecret);
        next.encrypted_secret = encryptedClientSecret.encryptedSecret;
        next.secret_iv = encryptedClientSecret.secretIv;
        next.secret_tag = encryptedClientSecret.secretTag;

        const accessToken = decryptField(connection, "oauth_access_token");
        const refreshToken = decryptField(connection, "oauth_refresh_token");
        writeEncryptedField(next, "oauth_access_token", accessToken);
        writeEncryptedField(next, "oauth_refresh_token", refreshToken);
        next.updated_at = new Date().toISOString();

        const { error: updateError } = await supabase
          .from("marketplace_connections")
          .update(next)
          .eq("id", connection.id);
        if (updateError) throw updateError;

        rotated.push(connection.marketplace_slug);
      } catch (rotateError) {
        failed.push({
          marketplace: connection.marketplace_slug,
          error: rotateError?.message || "Falha ao recriptografar conexão.",
        });
      }
    }

    return NextResponse.json({
      rotated,
      failed,
      complete: failed.length === 0,
      message: failed.length === 0
        ? "Credenciais recriptografadas com a chave atual. Agora APP_ENCRYPTION_KEY_PREVIOUS pode ser removida após validar as conexões."
        : "Algumas conexões não puderam ser recriptografadas. Não remova APP_ENCRYPTION_KEY_PREVIOUS ainda.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Falha na rotação das credenciais." },
      { status: error?.status || 500 }
    );
  }
}
