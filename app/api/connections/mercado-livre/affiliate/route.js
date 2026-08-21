import { NextResponse } from "next/server";
import { getAuthenticatedServerClient } from "@/lib/server-auth";

function fail(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function extractTracking(sampleUrl) {
  let url;
  try {
    url = new URL(String(sampleUrl || "").trim());
  } catch {
    throw new Error("Cole um link completo e válido do Mercado Livre.");
  }

  const host = url.hostname.toLowerCase();
  if (!host.endsWith("mercadolivre.com.br")) {
    if (host === "meli.la") {
      throw new Error("Use o link completo do Mercado Livre, não o link curto meli.la. No gerador de links, escolha a opção de link completo.");
    }
    throw new Error("O link precisa ser do Mercado Livre Brasil.");
  }

  const mattWord = String(url.searchParams.get("matt_word") || "").trim();
  const mattTool = String(url.searchParams.get("matt_tool") || "").trim();

  if (!mattWord) {
    throw new Error("Não encontrei matt_word nesse link. Gere um link de afiliado completo na Central do Mercado Livre e cole aqui.");
  }

  return {
    matt_word: mattWord,
    matt_tool: mattTool || null,
  };
}

export async function GET(request) {
  try {
    const { supabase } = await getAuthenticatedServerClient(request);
    const { data, error } = await supabase
      .from("marketplace_connections")
      .select("metadata")
      .eq("marketplace_slug", "mercado-livre")
      .eq("connection_type", "oauth_app")
      .maybeSingle();

    if (error) throw error;
    const tracking = data?.metadata?.affiliate_tracking || null;

    return NextResponse.json({
      configured: Boolean(tracking?.matt_word),
      tracking: tracking?.matt_word
        ? {
            matt_word: tracking.matt_word,
            matt_tool: tracking.matt_tool || null,
            configured_at: tracking.configured_at || null,
          }
        : null,
    });
  } catch (error) {
    return fail(error?.message || "Falha ao carregar configuração de afiliado.", error?.status || 500);
  }
}

export async function POST(request) {
  try {
    const { supabase } = await getAuthenticatedServerClient(request);
    const body = await request.json();
    const tracking = extractTracking(body.sampleUrl);

    const { data: connection, error: readError } = await supabase
      .from("marketplace_connections")
      .select("id,metadata")
      .eq("marketplace_slug", "mercado-livre")
      .eq("connection_type", "oauth_app")
      .maybeSingle();

    if (readError) throw readError;
    if (!connection) return fail("Configure primeiro a conexão do Mercado Livre.", 409);

    const configuredAt = new Date().toISOString();
    const metadata = {
      ...(connection.metadata || {}),
      affiliate_tracking: {
        ...tracking,
        configured_at: configuredAt,
        source: "sample_full_affiliate_url",
      },
    };

    const { error: updateError } = await supabase
      .from("marketplace_connections")
      .update({ metadata, updated_at: configuredAt })
      .eq("id", connection.id);

    if (updateError) throw updateError;

    return NextResponse.json({
      configured: true,
      tracking: {
        ...tracking,
        configured_at: configuredAt,
      },
    });
  } catch (error) {
    return fail(error?.message || "Não foi possível salvar o rastreamento de afiliado.", error?.status || 400);
  }
}

export async function DELETE(request) {
  try {
    const { supabase } = await getAuthenticatedServerClient(request);
    const { data: connection, error: readError } = await supabase
      .from("marketplace_connections")
      .select("id,metadata")
      .eq("marketplace_slug", "mercado-livre")
      .eq("connection_type", "oauth_app")
      .maybeSingle();

    if (readError) throw readError;
    if (!connection) return NextResponse.json({ configured: false });

    const metadata = { ...(connection.metadata || {}) };
    delete metadata.affiliate_tracking;

    const { error: updateError } = await supabase
      .from("marketplace_connections")
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq("id", connection.id);

    if (updateError) throw updateError;
    return NextResponse.json({ configured: false });
  } catch (error) {
    return fail(error?.message || "Falha ao remover rastreamento de afiliado.", error?.status || 500);
  }
}
