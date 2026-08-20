import { NextResponse } from "next/server";
import { decryptSecret } from "@/lib/crypto-secret";
import { getAuthenticatedServerClient } from "@/lib/server-auth";
import { searchShopeeOffers } from "@/lib/shopee-affiliate";

function rankOffers(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.soldQuantity !== a.soldQuantity) return b.soldQuantity - a.soldQuantity;
  if (b.rating !== a.rating) return b.rating - a.rating;
  if (b.discountPercent !== a.discountPercent) return b.discountPercent - a.discountPercent;
  return b.commissionRate - a.commissionRate;
}

export async function GET(request) {
  try {
    const { supabase } = await getAuthenticatedServerClient(request);
    const { searchParams } = new URL(request.url);
    const query = String(searchParams.get("query") || "").trim();

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

    const result = await searchShopeeOffers({
      appId: connection.account_identifier,
      secret,
      keyword: query,
    });

    const relevantDiscounted = result.offers.filter((offer) =>
      Number(offer.discountPercent || 0) > 0
      && Number(offer.keywordRelevance || 0) >= 0.5
      && Number(offer.rating || 0) >= 4.3
      && Number(offer.soldQuantity || 0) >= 20
    );

    const strict = relevantDiscounted.filter((offer) =>
      Number(offer.rating || 0) >= 4.5
      && Number(offer.soldQuantity || 0) >= 50
      && Number(offer.score || 0) >= 55
    );

    const selectionMode = strict.length >= 12 ? "strict" : "expanded";
    const selected = selectionMode === "strict"
      ? strict
      : relevantDiscounted;

    const bestOffers = selected
      .sort(rankOffers)
      .slice(0, 60);

    return NextResponse.json({
      source: "shopee_affiliate_api",
      count: bestOffers.length,
      offers: bestOffers,
      pagesFetched: result.pagesFetched,
      totalFetched: result.totalFetched,
      totalQualified: selected.length,
      selectionMode,
      truncated: result.truncated,
      warning: bestOffers.length === 0
        ? "A Shopee não retornou produtos fortes o suficiente para esta palavra-chave. Tente um termo mais específico ou mais popular."
        : result.truncated
          ? "A busca avaliou o limite de segurança de páginas e exibiu somente os melhores produtos encontrados."
          : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Falha ao buscar ofertas na Shopee." },
      { status: error?.status || 500 }
    );
  }
}
