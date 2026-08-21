import crypto from "node:crypto";
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
const SEARCH_TIMEOUT_MS = 25 * 1000;
const MAX_QUERY_LENGTH = 120;

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

function platformLabel(slug) {
  return slug === "mercado-livre" ? "Mercado Livre" : "Shopee";
}

function runPlatformSearch(slug, task) {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        slug,
        ok: false,
        offers: [],
        timedOut: true,
        warning: `${platformLabel(slug)} excedeu ${Math.round(SEARCH_TIMEOUT_MS / 1000)}s nesta busca. A outra plataforma continuou normalmente.`,
      });
    }, SEARCH_TIMEOUT_MS);
  });

  const execution = Promise.resolve()
    .then(task)
    .catch((error) => ({
      slug,
      ok: false,
      offers: [],
      warning: error?.message || `Falha ao consultar ${platformLabel(slug)}.`,
    }));

  return Promise.race([execution, timeout]).finally(() => clearTimeout(timeoutId));
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
    diagnostics: {
      pagesFetched: result.pagesFetched,
      totalFetched: result.totalFetched,
      truncated: result.truncated,
    },
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
      diagnostics: result.diagnostics || null,
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
    diagnostics: result.diagnostics || null,
    warning: warnings.join(" ") || null,
  };
}

async function recordSearchRuns({ supabase, results, query, platform, startedAt, requestId }) {
  const slugs = results
    .map((result) => result.slug)
    .filter((slug) => slug === "shopee" || slug === "mercado-livre");
  if (!slugs.length) return;

  try {
    const { data: marketplaces, error: marketplaceError } = await supabase
      .from("marketplaces")
      .select("id,slug")
      .in("slug", slugs);
    if (marketplaceError) throw marketplaceError;

    const ids = new Map((marketplaces || []).map((item) => [item.slug, item.id]));
    const completedAt = new Date();
    const durationMs = Math.max(completedAt.getTime() - startedAt.getTime(), 0);

    const rows = results
      .filter((result) => ids.has(result.slug))
      .map((result) => ({
        marketplace_id: ids.get(result.slug),
        niche_id: null,
        query,
        filters: {
          platform_filter: platform,
          request_id: requestId,
          duration_ms: durationMs,
          timed_out: Boolean(result.timedOut),
          diagnostics: result.diagnostics || null,
        },
        total_found: Array.isArray(result.offers) ? result.offers.length : 0,
        status: result.ok ? "completed" : "failed",
        error_message: result.ok ? null : String(result.warning || "Falha na busca.").slice(0, 500),
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
      }));

    if (!rows.length) return;
    const { error } = await supabase.from("search_runs").insert(rows);
    if (error) throw error;
  } catch (error) {
    console.error("Falha ao registrar histórico de busca:", error?.message || error);
  }
}

export async function GET(request) {
  const startedAt = new Date();
  const requestId = crypto.randomUUID();

  try {
    const { supabase } = await getAuthenticatedServerClient(request);
    const { searchParams } = new URL(request.url);
    const query = String(searchParams.get("query") || "").trim();
    const platform = String(searchParams.get("platform") || "all").trim().toLowerCase();

    if (query.length < 2) {
      return NextResponse.json({ error: "Informe pelo menos 2 caracteres para buscar.", requestId }, { status: 400 });
    }
    if (query.length > MAX_QUERY_LENGTH) {
      return NextResponse.json({ error: `A busca aceita no máximo ${MAX_QUERY_LENGTH} caracteres.`, requestId }, { status: 400 });
    }
    if (!VALID_PLATFORMS.has(platform)) {
      return NextResponse.json({ error: "Filtro de plataforma inválido.", requestId }, { status: 400 });
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
    if (wantsPlatform(platform, "shopee")) {
      tasks.push(runPlatformSearch("shopee", () => searchShopee(shopeeConnection, query)));
    }
    if (wantsPlatform(platform, "mercado-livre")) {
      tasks.push(runPlatformSearch("mercado-livre", () => searchMercadoLivre(mercadoConnection, query, supabase)));
    }

    const results = await Promise.all(tasks);
    const offers = results.flatMap((result) => result.offers || []).sort(rankOffers).slice(0, 80);
    const counts = {
      shopee: offers.filter((offer) => offer.marketplaceSlug === "shopee").length,
      mercadoLivre: offers.filter((offer) => offer.marketplaceSlug === "mercado-livre").length,
    };
    const warnings = results.map((result) => result.warning).filter(Boolean);
    const durationMs = Math.max(Date.now() - startedAt.getTime(), 0);

    await recordSearchRuns({
      supabase,
      results,
      query,
      platform,
      startedAt,
      requestId,
    });

    return NextResponse.json({
      source: "multi_marketplace",
      requestId,
      durationMs,
      platform,
      count: offers.length,
      counts,
      offers,
      warnings,
      warning: warnings.join(" "),
      sources: results.map((result) => ({
        slug: result.slug,
        ok: result.ok,
        timedOut: Boolean(result.timedOut),
        count: result.offers?.length || 0,
        diagnostics: result.diagnostics || null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error?.message || "Falha ao executar a busca geral.",
        requestId,
      },
      { status: error?.status || 500 }
    );
  }
}
