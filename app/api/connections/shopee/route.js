import { NextResponse } from "next/server";
import { decryptSecret, encryptSecret } from "@/lib/crypto-secret";
import { getAuthenticatedServerClient } from "@/lib/server-auth";
import { testShopeeCredentials } from "@/lib/shopee-affiliate";

function fail(error, fallbackStatus = 500) {
  return NextResponse.json(
    {
      error: error?.message || "Falha na conexão Shopee.",
      code: error?.code || null,
    },
    { status: error?.status || fallbackStatus }
  );
}

export async function GET(request) {
  try {
    const { supabase } = await getAuthenticatedServerClient(request);
    const { data, error } = await supabase
      .from("marketplace_connections")
      .select("account_identifier,status,last_tested_at,last_error,updated_at,encrypted_secret,secret_iv,secret_tag")
      .eq("marketplace_slug", "shopee")
      .eq("connection_type", "affiliate_api")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ connected: false, connection: null });
    }

    let credentialsReadable = true;
    let credentialsError = null;

    if (data.status === "connected") {
      try {
        decryptSecret({
          encryptedSecret: data.encrypted_secret,
          secretIv: data.secret_iv,
          secretTag: data.secret_tag,
        });
      } catch (decryptError) {
        credentialsReadable = false;
        credentialsError = decryptError;
      }
    }

    const publicConnection = {
      account_identifier: data.account_identifier,
      status: credentialsReadable ? data.status : "reconnect_required",
      last_tested_at: data.last_tested_at,
      last_error: credentialsReadable ? data.last_error : credentialsError?.message,
      updated_at: data.updated_at,
      requires_reconnect: !credentialsReadable,
    };

    return NextResponse.json({
      connected: data.status === "connected" && credentialsReadable,
      connection: publicConnection,
      warning: credentialsReadable ? null : credentialsError?.message,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request) {
  try {
    const { supabase, user } = await getAuthenticatedServerClient(request);
    const body = await request.json();
    const appId = String(body.appId || "").trim();
    const secret = String(body.secret || "").trim();

    if (!appId || !secret) {
      return NextResponse.json({ error: "Informe o App ID e o Secret da Shopee." }, { status: 400 });
    }

    await testShopeeCredentials({ appId, secret });
    const encrypted = encryptSecret(secret);
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("marketplace_connections")
      .upsert({
        user_id: user.id,
        marketplace_slug: "shopee",
        connection_type: "affiliate_api",
        display_name: "Shopee Afiliados",
        account_identifier: appId,
        encrypted_secret: encrypted.encryptedSecret,
        secret_iv: encrypted.secretIv,
        secret_tag: encrypted.secretTag,
        status: "connected",
        last_tested_at: now,
        last_error: null,
        updated_at: now,
      }, { onConflict: "user_id,marketplace_slug,connection_type" });

    if (error) throw error;

    return NextResponse.json({
      connected: true,
      connection: {
        account_identifier: appId,
        status: "connected",
        last_tested_at: now,
        last_error: null,
        requires_reconnect: false,
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
      .eq("marketplace_slug", "shopee")
      .eq("connection_type", "affiliate_api");

    if (error) throw error;
    return NextResponse.json({ connected: false });
  } catch (error) {
    return fail(error);
  }
}
