import { NextResponse } from "next/server";
import { decryptSecret } from "@/lib/crypto-secret";
import { getAuthenticatedServerClient } from "@/lib/server-auth";
import { searchShopeeOffers } from "@/lib/shopee-affiliate";

export async function GET(request) {
  try {
    const { supabase } = await getAuthenticatedServerClient(request);
    const { searchParams } = new URL(request.url);
    const query = String(searchParams.get("query") || "").trim();
    const minDiscount = Number(searchParams.get("minDiscount") || 0);
    const minScore = Number(searchParams.get("minScore") || 0);
    const limit = Math.min(Number(searchParams.get("limit") || 24), 50);

    if (query.length < 2) {
      return NextResponse.json({ error: "Informe pelo menos 2 caracteres para buscar." }, { status: 400 });
    }

    const { data: connection, error } = await supabase
      .from("marketplace_connections")
      .select("account_identifier,encrypted_secret,secret_iv,secret_tag,status")
      .eq("marketplace_slug", "shopee")
      .eq("connection_type", "affiliate_api")
      .maybeSingle();

    if (error) throw error;
    if (!connection || connection.status !== "connected") {
      return NextResponse.json(
        { error: "Conecte sua API de Afiliados Shopee na aba Conexões antes de buscar." },
        { status: 409 }
      );
    }

    const secret = decryptSecret({
      encryptedSecret: connection.encrypted_secret,
      secretIv: connection.secret_iv,
      secretTag: connection.secret_tag,
    });

    const offers = await searchShopeeOffers({
      appId: connection.account_identifier,
      secret,
      keyword: query,
      limit,
    });

    const filtered = offers
      .filter((offer) => offer.discountPercent >= minDiscount)
      .filter((offer) => offer.score >= minScore)
      .sort((a, b) => b.score - a.score);

    return NextResponse.json({
      source: "shopee_affiliate_api",
      count: filtered.length,
      offers: filtered,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Falha ao buscar ofertas na Shopee." },
      { status: error?.status || 500 }
    );
  }
}
