import { NextResponse } from "next/server";
import { encryptSecret } from "@/lib/crypto-secret";
import { getAuthenticatedServerClient } from "@/lib/server-auth";

function fail(error, fallbackStatus = 500) {
  return NextResponse.json(
    { error: error?.message || "Falha na configuração do Mercado Livre." },
    { status: error?.status || fallbackStatus }
  );
}

function normalizeRedirectUri(value) {
  const redirectUri = String(value || "").trim();
  if (!redirectUri) return "";
  let parsed;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw Object.assign(new Error("Informe uma Redirect URI válida."), { status: 400 });
  }
  if (parsed.protocol !== "https:") {
    throw Object.assign(new Error("A Redirect URI do Mercado Livre precisa usar HTTPS."), { status: 400 });
  }
  return parsed.toString();
}

export async function GET(request) {
  try {
    const { supabase } = await getAuthenticatedServerClient(request);
    const { data, error } = await supabase
      .from("marketplace_connections")
      .select("account_identifier,status,last_tested_at,last_error,metadata,updated_at")
      .eq("marketplace_slug", "mercado-livre")
      .eq("connection_type", "oauth_app")
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({
      configured: Boolean(data),
      connected: data?.status === "connected",
      connection: data
        ? {
            account_identifier: data.account_identifier,
            status: data.status,
            last_tested_at: data.last_tested_at,
            last_error: data.last_error,
            redirect_uri: data.metadata?.redirect_uri || "",
            pkce: data.metadata?.pkce !== false,
            updated_at: data.updated_at,
          }
        : null,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request) {
  try {
    const { supabase, user } = await getAuthenticatedServerClient(request);
    const body = await request.json();
    const clientId = String(body.clientId || "").trim();
    const clientSecret = String(body.clientSecret || "").trim();
    const redirectUri = normalizeRedirectUri(body.redirectUri);

    if (!clientId || !clientSecret || !redirectUri) {
      return NextResponse.json(
        { error: "Informe Client ID, Client Secret e Redirect URI." },
        { status: 400 }
      );
    }

    const encrypted = encryptSecret(clientSecret);
    const now = new Date().toISOString();
    const metadata = {
      redirect_uri: redirectUri,
      pkce: true,
      oauth_flows: ["authorization_code", "refresh_token", "client_credentials"],
      business_unit: "mercado_livre",
      search_enabled: true,
      configured_at: now,
    };

    const { error } = await supabase
      .from("marketplace_connections")
      .upsert({
        user_id: user.id,
        marketplace_slug: "mercado-livre",
        connection_type: "oauth_app",
        display_name: "Mercado Livre",
        account_identifier: clientId,
        encrypted_secret: encrypted.encryptedSecret,
        secret_iv: encrypted.secretIv,
        secret_tag: encrypted.secretTag,
        status: "pending",
        last_tested_at: null,
        last_error: null,
        metadata,
        updated_at: now,
      }, { onConflict: "user_id,marketplace_slug,connection_type" });

    if (error) throw error;

    return NextResponse.json({
      configured: true,
      connected: false,
      connection: {
        account_identifier: clientId,
        status: "pending",
        redirect_uri: redirectUri,
        pkce: true,
        updated_at: now,
      },
    });
  } catch (error) {
    return fail(error, 400);
  }
}

export async function DELETE(request) {
  try {
    const { supabase } = await getAuthenticatedServerClient(request);
    const { error } = await supabase
      .from("marketplace_connections")
      .delete()
      .eq("marketplace_slug", "mercado-livre")
      .eq("connection_type", "oauth_app");

    if (error) throw error;
    return NextResponse.json({ configured: false, connected: false });
  } catch (error) {
    return fail(error);
  }
}
