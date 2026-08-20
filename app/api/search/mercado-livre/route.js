import { NextResponse } from "next/server";
import { getDemoOffers, searchMercadoLivre } from "@/lib/marketplaces/mercado-livre";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("query") || "").trim();
  const limit = Number(searchParams.get("limit") || 20);
  const minDiscount = Number(searchParams.get("minDiscount") || 0);
  const minScore = Number(searchParams.get("minScore") || 0);

  if (query.length < 2) {
    return NextResponse.json({ error: "Informe pelo menos 2 caracteres para buscar." }, { status: 400 });
  }

  const accessToken = process.env.MERCADO_LIVRE_ACCESS_TOKEN || "";
  const allowDemo = process.env.ALLOW_DEMO_OFFERS !== "false";

  let result;
  if (accessToken) {
    result = await searchMercadoLivre({ query, limit, accessToken });
  } else {
    result = {
      ok: false,
      restricted: false,
      status: 0,
      message: "Token do Mercado Livre ainda não configurado.",
      offers: [],
    };
  }

  let source = "mercado_livre_api";
  let warning = null;
  let offers = result.offers;

  if ((!result.ok || offers.length === 0) && allowDemo) {
    source = "demo";
    warning = result.message || "Fonte real indisponível; usando ofertas simuladas para validar o fluxo local.";
    offers = getDemoOffers(query);
  }

  const filtered = offers
    .filter((offer) => offer.discountPercent >= minDiscount)
    .filter((offer) => offer.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(limit, 50));

  return NextResponse.json({
    source,
    warning,
    count: filtered.length,
    offers: filtered,
  });
}
