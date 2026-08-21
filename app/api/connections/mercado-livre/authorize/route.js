import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedServerClient } from "@/lib/server-auth";
import { sealServerValue } from "@/lib/crypto-secret";
import { buildMercadoLivreAuthorizationUrl } from "@/lib/marketplaces/mercado-livre";

const COOKIE_NAME = "ml_oauth_state";

export async function POST(request) {
  try {
    const { supabase, token } = await getAuthenticatedServerClient(request);
    const { data: connection, error } = await supabase
      .from("marketplace_connections")
      .select("account_identifier,status,metadata")
      .eq("marketplace_slug", "mercado-livre")
      .eq("connection_type", "oauth_app")
      .maybeSingle();

    if (error) throw error;
    if (!connection) {
      return NextResponse.json(
        { error: "Salve Client ID, Client Secret e Redirect URI antes de conectar a conta." },
        { status: 400 }
      );
    }

    const redirectUri = String(connection.metadata?.redirect_uri || "").trim();
    if (!redirectUri) {
      return NextResponse.json({ error: "Redirect URI do Mercado Livre não configurada." }, { status: 400 });
    }

    const appOrigin = new URL(request.url).origin;
    const redirectOrigin = new URL(redirectUri).origin;
    if (appOrigin !== redirectOrigin) {
      return NextResponse.json(
        {
          error: `Para concluir o OAuth, abra o painel em ${redirectOrigin}. O Mercado Livre está configurado para retornar para ${redirectUri}, mas você está usando ${appOrigin}.`,
          code: "OAUTH_ORIGIN_MISMATCH",
          redirectOrigin,
        },
        { status: 409 }
      );
    }

    const state = crypto.randomBytes(32).toString("base64url");
    const codeVerifier = crypto.randomBytes(48).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

    const authorizationUrl = buildMercadoLivreAuthorizationUrl({
      clientId: connection.account_identifier,
      redirectUri,
      state,
      codeChallenge,
    });

    const sealedState = sealServerValue({
      state,
      codeVerifier,
      userToken: token,
      issuedAt: Date.now(),
    });

    const response = NextResponse.json({ authorizationUrl });
    response.cookies.set(COOKIE_NAME, sealedState, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/mercado-livre/callback",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Falha ao iniciar conexão com Mercado Livre." },
      { status: error?.status || 500 }
    );
  }
}
