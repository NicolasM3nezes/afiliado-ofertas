import { NextResponse } from "next/server";
import { decryptSecret, encryptSecret } from "@/lib/crypto-secret";
import { getAuthenticatedServerClient } from "@/lib/server-auth";
import { searchShopeeOffers } from "@/lib/shopee-affiliate";
import {
  refreshMercadoLivreAccessToken,
  searchMercadoLivreBest,
} from "@/lib/marketplaces/mercado-livre";
import { enrichMercadoLivreAffiliateOffers } from "@/lib/marketplaces/mercado-livre-affiliate";

const VALID_PLATFORMS = new Set(["all", "shopee", "mercado-livre"]);
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

function rankOffers(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (Number(b.estimatedCommission || 0) !== Number(a.estimatedCommission || 0)) {
    return Number(b.estimatedCommission || 0) - Number(a.estimatedCommission || 0);
  }
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
    .map((offer) => {
      const commissionRate = Number(offer.commissionRate || 0);
      const providerEstimate = Number(offer.estimatedCommission || 0);
      const estimatedCommission = providerEstimate > 0
        ? providerEstimate
        : commissionRate > 0
          ? Number(((Number(offer.price || 0) * commissionRate) / 100).toFixed(2))
          : 0;

      return {
        ...offer,
        marketplaceSlug: "shopee",
        marketplaceName: "Shopee",
        marketplaceCode: "S",
        estimatedCommission,
        commissionEstimateType: providerEstimate > 0 ? "provider" : "rate_estimate",
        commissionNote: commissionRate > 0
          ? "Estimativa com base na comissão informada pela Affiliate API da Shopee."
          : null,
        affiliateLinkConfigured: Boolean(offer.affiliateUrl),
      };
    })
    .sort(rankOffers)
    .slice(0, 60);
}

function wantsPlatform(filter, slug) {
  return filter === "all" || filter === slug;
}

function decryptStoredValue(connection, prefix) {
  const encryptedSecret = connection[`${prefix}_encrypted`];
  const secretIv = connection[`${prefix}_iv`];
  const secretTag = connection[`${prefix}_tag`];
  if (!encryptedSecret || !secretIv || !secretTag) return "";
  return decryptSecret({ encryptedSecret, secretIv, secretTag });
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
  const offers = selectBestShopeeOffers(result);

  return {
    slug: "shopee",
    ok: true,
    offers,
    warning: result.truncated && offers.length < 10
      ? "A Shopee encerrou a paginação de segurança antes de formar uma lista grande; mantivemos os melhores produtos encontrados."
      : null,
  };
}

async function getValidMercadoLivreAccessToken(connection, supabase) {
  if (!connection || connection.status !== "connected") {
    return {
      accessToken: "",
      warning: "Mercado Livre está configurado, mas a conta ainda não foi autorizada. Vá em Conexões e clique em Conectar conta Mercado Livre.",
    };
  }

  const accessToken = decryptStoredValue(connection, "oauth_access_token");
  if (!accessToken) {
    return {
      accessToken: "",
      warning: "A conexão do Mercado Livre não possui access token. Autorize a conta novamente em Conexões.",
    };
  }

  const expiresAtMs = connection.oauth_expires_at
    ? new Date(connection.oauth_expires_at).getTime()
    : 0;
  const shouldRefresh = !expiresAtMs || expiresAtMs <= Date.now() + REFRESH_MARGIN_MS;
  if (!shouldRefresh) return { accessToken, warning: null };

  const refreshToken = decryptStoredValue(connection, "oauth_refresh_token");
  if (!refreshToken) {
    return {
      accessToken: "",
      warning: "O refresh token do Mercado Livre não está disponível. Conecte a conta novamente.",
    };
  }

  try {
    const clientSecret = decryptSecret({
      encryptedSecret: connection.encrypted_secret,
      secretIv: connection.secret_iv,
      secretTag: connection.secret_tag,
    });
    const refreshed = await refreshMercadoLivreAccessToken({
      clientId: connection.account_identifier,
      clientSecret,
      refreshToken,
    });

    const encryptedAccess = encryptSecret(refreshed.accessToken);
    const nextRefreshToken = refreshed.refreshToken || refreshToken;
    const encryptedRefresh = encryptSecret(nextRefreshToken);
    const expiresAt = refreshed.expiresIn > 0
      ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
      : null;
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("marketplace_connections")
      .update({
        oauth_access_token_encrypted: encryptedAccess.encryptedSecret,
        oauth_access_token_iv: encryptedAccess.secretIv,
        oauth_access_token_tag: encryptedAccess.secretTag,
        oauth_refresh_token_encrypted: encryptedRefresh.encryptedSecret,
        oauth_refresh_token_iv: encryptedRefresh.secretIv,
        oauth_refresh_token_tag: encryptedRefresh.secretTag,
        oauth_expires_at: expiresAt,
        status: "connected",
        last_tested_at: now,
        last_error: null,
        updated_at: now,
      })
      .eq("id", connection.id);
    if (error) throw error;

    return { accessToken: refreshed.accessToken, warning: null };
  } catch (error) {
    const message = error?.message || "Falha ao renovar token do Mercado Livre.";
    await supabase
      .from("marketplace_connections")
      .update({
        status: "error",
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);

    return {
      accessToken: "",
      warning: `${message} Abra Conexões e autorize a conta do Mercado Livre novamente.`,
    };
  }
}

async function searchMercadoLivre(connection, query, supabase) {
  if (!connection) {
    return {
      slug: "mercado-livre",
      ok: false,
      offers: [],
      warning: "Mercado Livre ainda não está configurado. Salve Client ID, Client Secret e Redirect URI em Conexões.",
    };
  }

  const tokenState = await getValidMercadoLivreAccessToken(connection, supabase);
  if (!tokenState.accessToken) {
    return {
      slug: "mercado-livre",
      ok: false,
      offers: [],
      warning: tokenState.warning,
    };
  }

  const result = await searchMercadoLivreBest({
    query,
    accessToken: tokenState.accessToken,
  });

  if (!result.ok) {
    return {
      slug: "mercado-livre",
      ok: false,
      offers: [],
      warning: `Não foi possível buscar produtos reais do Mercado Livre. ${result.warning || ""}`.trim(),
    };
  }

  const tracking = connection.metadata?.affiliate_tracking || null;
  const offers = await enrichMercadoLivreAffiliateOffers({
    offers: result.offers,
    accessToken: tokenState.accessToken,
    tracking,
  });

  const warnings = [];
  if (result.warning) warnings.push(result.warning);
  if (!tracking?.matt_word) {
    warnings.push("Mercado Livre conectado, mas o rastreamento de afiliado ainda não foi configurado. Cole um link completo de afiliado na aba Conexões para converter os links automaticamente.");
  }

  return {
    slug: "mercado-livre",
    ok: true,
    offers,
    warning: warnings.join(" ") || null,
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
      .select("id,marketplace_slug,connection_type,account_identifier,encrypted_secret,secret_iv,secret_tag,status,metadata,oauth_access_token_encrypted,oauth_access_token_iv,oauth_access_token_tag,oauth_refresh_token_encrypted,oauth_refresh_token_iv,oauth_refresh_token_tag,oauth_expires_at")
      .in("marketplace_slug", ["shopee", "mercado-livre"]);
    if (error) throw error;

    const shopeeConnection = (connections || []).find((item) =>
      item.marketplace_slug === "shopee" && item.connection_type === "affiliate_api"
    );
    const mercadoConnection = (connections || []).find((item) =>
      item.marketplace_slug === "mercado-livre" && item.connection_type === "oauth_app"
    );

    const tasks = [];
    if (wantsPlatform(platform, "shopee")) tasks.push(searchShopee(shopeeConnection, query));
    if (wantsPlatform(platform, "mercado-livre")) tasks.push(searchMercadoLivre(mercadoConnection, query, supabase));

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

    const offers = results.flatMap((result) => result.offers || []).sort(rankOffers).slice(0, 80);
    const counts = {
      shopee: offers.filter((offer) => offer.marketplaceSlug === "shopee").length,
      mercadoLivre: offers.filter((offer) => offer.marketplaceSlug === "mercado-livre").length,
    };
    const warnings = results.map((result) => result.warning).filter(Boolean);

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
