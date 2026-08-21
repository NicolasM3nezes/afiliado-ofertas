import { NextResponse } from "next/server";
import { createAuthenticatedSupabaseClient } from "@/lib/server-auth";
import { decryptSecret, encryptSecret, unsealServerValue } from "@/lib/crypto-secret";
import { exchangeMercadoLivreAuthorizationCode } from "@/lib/marketplaces/mercado-livre";

const COOKIE_NAME = "ml_oauth_state";
const MAX_STATE_AGE_MS = 10 * 60 * 1000;

function clearOAuthCookie(response) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/mercado-livre/callback",
    maxAge: 0,
  });
  return response;
}

function redirectResult(request, status, message = "") {
  const url = new URL("/", request.url);
  url.searchParams.set("mercado", status);
  if (message) url.searchParams.set("mercado_message", message.slice(0, 240));
  return url;
}

export async function GET(request) {
  try {
    const currentUrl = new URL(request.url);
    const providerError = currentUrl.searchParams.get("error");
    const providerErrorDescription = currentUrl.searchParams.get("error_description");
    if (providerError) {
      const response = NextResponse.redirect(
        redirectResult(request, "error", providerErrorDescription || providerError)
      );
      return clearOAuthCookie(response);
    }

    const code = String(currentUrl.searchParams.get("code") || "").trim();
    const state = String(currentUrl.searchParams.get("state") || "").trim();
    const sealedCookie = request.cookies.get(COOKIE_NAME)?.value || "";

    if (!code || !state || !sealedCookie) {
      const response = NextResponse.redirect(
        redirectResult(request, "error", "Retorno OAuth incompleto. Inicie a conexão novamente.")
      );
      return clearOAuthCookie(response);
    }

    const oauthState = unsealServerValue(sealedCookie);
    if (oauthState.state !== state) {
      throw Object.assign(new Error("O state retornado pelo Mercado Livre não corresponde à solicitação iniciada."), { status: 400 });
    }
    if (!oauthState.issuedAt || Date.now() - Number(oauthState.issuedAt) > MAX_STATE_AGE_MS) {
      throw Object.assign(new Error("A autorização expirou. Inicie a conexão novamente."), { status: 400 });
    }

    const supabase = createAuthenticatedSupabaseClient(oauthState.userToken);
    const { data: authData, error: authError } = await supabase.auth.getUser(oauthState.userToken);
    if (authError || !authData.user) {
      throw Object.assign(new Error("Sua sessão expirou durante a autorização. Entre novamente no painel."), { status: 401 });
    }

    const { data: connection, error } = await supabase
      .from("marketplace_connections")
      .select("id,account_identifier,encrypted_secret,secret_iv,secret_tag,metadata")
      .eq("marketplace_slug", "mercado-livre")
      .eq("connection_type", "oauth_app")
      .single();

    if (error) throw error;

    const clientSecret = decryptSecret({
      encryptedSecret: connection.encrypted_secret,
      secretIv: connection.secret_iv,
      secretTag: connection.secret_tag,
    });
    const redirectUri = String(connection.metadata?.redirect_uri || "").trim();

    const tokenResult = await exchangeMercadoLivreAuthorizationCode({
      clientId: connection.account_identifier,
      clientSecret,
      code,
      redirectUri,
      codeVerifier: oauthState.codeVerifier,
    });

    const encryptedAccess = encryptSecret(tokenResult.accessToken);
    const encryptedRefresh = tokenResult.refreshToken
      ? encryptSecret(tokenResult.refreshToken)
      : null;
    const now = new Date();
    const expiresAt = tokenResult.expiresIn > 0
      ? new Date(now.getTime() + tokenResult.expiresIn * 1000).toISOString()
      : null;

    const metadata = {
      ...(connection.metadata || {}),
      provider_user_id: tokenResult.userId,
      token_type: tokenResult.tokenType,
      scope: tokenResult.scope,
      last_authorized_at: now.toISOString(),
    };

    const updatePayload = {
      status: "connected",
      oauth_access_token_encrypted: encryptedAccess.encryptedSecret,
      oauth_access_token_iv: encryptedAccess.secretIv,
      oauth_access_token_tag: encryptedAccess.secretTag,
      oauth_expires_at: expiresAt,
      oauth_connected_at: now.toISOString(),
      last_tested_at: now.toISOString(),
      last_error: null,
      metadata,
      updated_at: now.toISOString(),
    };

    if (encryptedRefresh) {
      updatePayload.oauth_refresh_token_encrypted = encryptedRefresh.encryptedSecret;
      updatePayload.oauth_refresh_token_iv = encryptedRefresh.secretIv;
      updatePayload.oauth_refresh_token_tag = encryptedRefresh.secretTag;
    }

    const { error: updateError } = await supabase
      .from("marketplace_connections")
      .update(updatePayload)
      .eq("id", connection.id);
    if (updateError) throw updateError;

    const response = NextResponse.redirect(redirectResult(request, "connected"));
    return clearOAuthCookie(response);
  } catch (error) {
    const response = NextResponse.redirect(
      redirectResult(request, "error", error?.message || "Não foi possível concluir a autorização do Mercado Livre.")
    );
    return clearOAuthCookie(response);
  }
}
