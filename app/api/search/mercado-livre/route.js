import { NextResponse } from "next/server";
import { searchMercadoLivre } from "@/lib/marketplaces/mercado-livre";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = String(searchParams.get("query") || "").trim();
  const limit = Number(searchParams.get("limit") || 20);

  if (query.length < 2) {
    return NextResponse.json({ error: "Informe pelo menos 2 caracteres para buscar." }, { status: 400 });
  }

  const accessToken = String(process.env.MERCADO_LIVRE_ACCESS_TOKEN || "").trim();
  if (!accessToken) {
    return NextResponse.json(
      {
        error: "Esta rota legada não usa mais ofertas demo. Use /api/search/general, que utiliza a conexão OAuth salva no Supabase.",
      },
      { status: 409 }
    );
  }

  const result = await searchMercadoLivre({ query, limit, accessToken });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message || "Falha na busca do Mercado Livre." },
      { status: result.status || 502 }
    );
  }

  const offers = result.offers
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(limit, 1), 50));

  return NextResponse.json({
    source: "mercado_livre_api",
    count: offers.length,
    offers,
  });
}
