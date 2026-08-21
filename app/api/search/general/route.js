import { NextResponse } from "next/server";
import { decryptSecret } from "@/lib/crypto-secret";
import { getAuthenticatedServerClient } from "@/lib/server-auth";
import { searchShopeeOffers } from "@/lib/shopee-affiliate";
import {
  getMercadoLivreClientCredentialsToken,
  searchMercadoLivreBest,
} from "@/lib/marketplaces/mercado-livre";

const VALID_PLATFORMS = new Set(["all", "shopee", "mercado-livre"]);

function rankOffers(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.soldQuantity !== a.soldQuantity) return b.soldQuantity - a.soldQuantity;
  if (b.discountPercent !== a.discountPercent) return b.discountPercent - a.discountPercent;
  return Number(b.commissionRate || 0) - Number(a.commissionRate || 0);
}

function selectBestShopeeOffers(result) {
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

  const selected = strict.length >= 12 ? strict : relevantDiscounted;
  return selected
    .map((offer) => ({
      ...offer,
      marketplaceSlug: "shopee",
      marketplaceName: "Shopee",
      marketplaceCode: "S",
    }))
    .sort(rankOffers)
    .slice(0, 60);
}

function wantsPlatform(filter, slug) {
  return filter === "all" || filter === slug;
}

async function searchShopee(connection, query) {
  if (!connection || connection.status !== "connected") {
    return {
      slug: "shopee",
      ok: false,
      offers: [],
      warning: "Shopee não está conectada. Configure App ID e Secret na aba Conexões.",
    };
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

  return {
    slug: "shopee",
    ok: true,
    offers: selectBestShopeeOffers(result),
    warning: result.truncated
      ? "A Shopee atingiu o limite de segurança de páginas; os melhores resultados encontrados foram mantidos."
      : null,
  };
}

async function searchMercadoLivre(connection, query) {
  if (!connection) {
    return {
      slug: "mercado-livre",
      ok: false,
      offers: [],
      warning: "Mercado Livre ainda não está configurado. Salve Client ID, Client Secret e Redirect URI em Conexões.",
    };
  }

  const clientSecret = decryptSecret({
    encryptedSecret: connection.encrypted_secret,
    secretIv: connection.secret_iv,
    secretTag: connection.secret_tag,
  });

  let accessToken = "";
  let tokenWarning = null;

  try {
    const tokenResult = await getMercadoLivreClientCredentialsToken({
      clientId: connection.account_identifier,
      clientSecret,
    });

    if (tokenResult.ok) {
      accessToken = tokenResult.accessToken;
    } else {
      tokenWarning = tokenResult.message;
    }
  } catch (error) {
    tokenWarning = error?.message || "Não foi possível gerar token da aplicação Mercado Livre.";
  }

  let result = await searchMercadoLivreBest({ query, accessToken });

  // Alguns recursos públicos do Mercado Livre podem funcionar sem token de aplicação.
  // Se Client Credentials não estiver habilitado no app, tentamos a consulta pública antes de desistir.
  if (!result.ok && accessToken) {
    const publicResult = await searchMercadoLivreBest({ query, accessToken: "" });
    if (publicResult.ok) result = publicResult;
  } else if (!accessToken) {
    const publicResult = await searchMercadoLivreBest({ query, accessToken: "" });
    if (publicResult.ok) result = publicResult;
  }

  if (!result.ok) {
    return {
      slug: "mercado-livre",
      ok: false,
      offers: [],
      warning: [
        "Não foi possível buscar produtos reais do Mercado Livre.",
        result.warning,
        tokenWarning,
      ].filter(Boolean).join(" "),
    };
  }

  return {
    slug: "mercado-livre",
    ok: true,
    offers: result.offers,
    warning: tokenWarning && !accessToken
      ? `Mercado Livre consultado sem token de Client Credentials. ${tokenWarning}`
      : result.warning,
  };
}

export async function GET(request) {
  try {
    const { supabase } = await getAuthenticatedServerClient(request);
    const { searchParams } = new URL(request.url);
    const query = String(searchParams.get("query") || "").trim();
    const platform = String(searchParams.get("platform") || "all").trim().toLowerCase();

    if (query.length < 2) {
      return NextResponse.json({ error: "Informe pelo menos 2 caracteres para buscar." }, { status: 400 });
    }

    if (!VALID_PLATFORMS.has(platform)) {
      return NextResponse.json({ error: "Filtro de plataforma inválido." }, { status: 400 });
    }

    const { data: connections, error } = await supabase
      .from("marketplace_connections")
      .select("marketplace_slug,connection_type,account_identifier,encrypted_secret,secret_iv,secret_tag,status,metadata")
      .in("marketplace_slug", ["shopee", "mercado-livre"]);

    if (error) throw error;

    const shopeeConnection = (connections || []).find((item) =>
      item.marketplace_slug === "shopee" && item.connection_type === "affiliate_api"
    );
    const mercadoConnection = (connections || []).find((item) =>
      item.marketplace_slug === "mercado-livre" && item.connection_type === "oauth_app"
    );

    const tasks = [];
    if (wantsPlatform(platform, "shopee")) {
      tasks.push(searchShopee(shopeeConnection, query));
    }
    if (wantsPlatform(platform, "mercado-livre")) {
      tasks.push(searchMercadoLivre(mercadoConnection, query));
    }

    const settled = await Promise.allSettled(tasks);
    const results = settled.map((entry) => {
      if (entry.status === "fulfilled") return entry.value;
      return {
        slug: "unknown",
        ok: false,
        offers: [],
        warning: entry.reason?.message || "Uma das plataformas falhou durante a busca.",
      };
    });

    const offers = results
      .flatMap((result) => result.offers || [])
      .sort(rankOffers)
      .slice(0, 80);

    const counts = {
      shopee: offers.filter((offer) => offer.marketplaceSlug === "shopee").length,
      mercadoLivre: offers.filter((offer) => offer.marketplaceSlug === "mercado-livre").length,
    };

    const warnings = results
      .map((result) => result.warning)
      .filter(Boolean);

    return NextResponse.json({
      source: "multi_marketplace",
      platform,
      count: offers.length,
      counts,
      offers,
      warnings,
      warning: warnings.join(" "),
      sources: results.map((result) => ({
        slug: result.slug,
        ok: result.ok,
        count: result.offers?.length || 0,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Falha ao executar a busca geral." },
      { status: error?.status || 500 }
    );
  }
}
