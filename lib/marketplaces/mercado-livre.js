const CATALOG_SEARCH_URL = "https://api.mercadolibre.com/products/search";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const SITE_ID = "MLB";
const DEFAULT_CATALOG_LIMIT = 24;
const DETAIL_CONCURRENCY = 6;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function keywordRelevance(title, query) {
  const titleText = normalizeText(title);
  const tokens = normalizeText(query).split(" ").filter((token) => token.length >= 2);
  if (!tokens.length) return 1;
  const hits = tokens.filter((token) => titleText.includes(token)).length;
  return hits / tokens.length;
}

function sellerReputationScore(value) {
  const reputation = String(value || "").toLowerCase();
  if (reputation.includes("green")) return 20;
  if (reputation.includes("yellow")) return 13;
  if (reputation.includes("orange")) return 7;
  if (reputation.includes("red")) return 2;
  return 6;
}

function calculateCatalogScore({
  discountPercent,
  freeShipping,
  officialStore,
  condition,
  relevance,
  sellerReputation,
  hasDeal,
}) {
  // No catálogo do Mercado Livre, desconto nem sempre vem em original_price.
  // Por isso ele é bônus de oportunidade, e não requisito para um produto ser forte.
  const discountScore = clamp(Number(discountPercent || 0) / 50, 0, 1) * 20;
  const shippingScore = freeShipping ? 15 : 0;
  const officialScore = officialStore ? 15 : 5;
  const conditionScore = condition === "new" ? 5 : 0;
  const relevanceScore = clamp(Number(relevance || 0), 0, 1) * 20;
  const reputationScore = sellerReputationScore(sellerReputation);
  const dealScore = hasDeal ? 5 : 0;

  return Math.round(clamp(
    discountScore
      + shippingScore
      + officialScore
      + conditionScore
      + relevanceScore
      + reputationScore
      + dealScore,
    0,
    100
  ));
}

function qualityLabel(score) {
  if (score >= 80) return "Excelente";
  if (score >= 68) return "Muito bom";
  if (score >= 54) return "Bom";
  return "Regular";
}

function getPicture(product) {
  const picture = Array.isArray(product?.pictures) ? product.pictures[0] : null;
  return picture?.secure_url || picture?.url || null;
}

function buildCatalogPermalink(product) {
  return product?.permalink || `https://www.mercadolivre.com.br/p/${product?.id || ""}`;
}

function normalizeCatalogOffer(product, listing, query, priceSnapshot = null) {
  if (!product || !listing) return null;

  const snapshotPrice = Number(priceSnapshot?.amount || 0);
  const listingPrice = Number(listing.price || 0);
  const price = snapshotPrice > 0 ? snapshotPrice : listingPrice;

  const snapshotRegular = Number(priceSnapshot?.regularAmount || 0);
  const listingOriginal = Number(listing.original_price || 0);
  const originalPrice = snapshotRegular > price
    ? snapshotRegular
    : listingOriginal > price
      ? listingOriginal
      : null;

  const discountPercent = originalPrice && originalPrice > price
    ? ((originalPrice - price) / originalPrice) * 100
    : 0;

  const title = product.name || product.family_name || "Produto Mercado Livre";
  const relevance = keywordRelevance(title, query);
  const freeShipping = Boolean(listing.shipping?.free_shipping);
  const officialStore = Boolean(listing.official_store_id);
  const sellerReputation = listing.seller?.reputation_level_id || "";
  const hasDeal = Boolean(priceSnapshot?.isPromotion)
    || (Array.isArray(listing.deal_ids) && listing.deal_ids.length > 0);

  const score = calculateCatalogScore({
    discountPercent,
    freeShipping,
    officialStore,
    condition: listing.condition,
    relevance,
    sellerReputation,
    hasDeal,
  });

  return {
    marketplaceSlug: "mercado-livre",
    marketplaceName: "Mercado Livre",
    marketplaceCode: "ML",
    externalId: listing.item_id || product.id,
    title,
    permalink: buildCatalogPermalink(product),
    affiliateUrl: null,
    thumbnailUrl: getPicture(product),
    price,
    originalPrice,
    discountPercent: Number(discountPercent.toFixed(2)),
    freeShipping,
    soldQuantity: 0,
    rating: null,
    sellerName: officialStore ? "Loja oficial" : "Mercado Livre",
    officialStore,
    categoryExternalId: listing.category_id || null,
    commissionRate: 0,
    keywordRelevance: relevance,
    score,
    qualityLabel: qualityLabel(score),
    couponText: hasDeal ? "Preço promocional no Mercado Livre" : null,
    raw: {
      catalogProductId: product.id,
      source: "mercado_livre_catalog",
      priceSource: priceSnapshot?.source || "catalog",
      product,
      listing,
    },
  };
}

async function tokenRequest(params) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const error = new Error(
      data.error_description || data.message || data.error || `Mercado Livre respondeu HTTP ${response.status} ao gerar token.`
    );
    error.status = response.status;
    error.providerCode = data.error || null;
    throw error;
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresIn: Number(data.expires_in || 0),
    tokenType: data.token_type || "Bearer",
    scope: data.scope || null,
    userId: data.user_id ? String(data.user_id) : null,
  };
}

async function mercadoLivreGet(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function providerErrorMessage(data, fallback) {
  return data?.message || data?.error_description || data?.error || fallback;
}

async function searchCatalogProducts({ query, accessToken, limit = DEFAULT_CATALOG_LIMIT }) {
  const url = new URL(CATALOG_SEARCH_URL);
  url.searchParams.set("status", "active");
  url.searchParams.set("site_id", SITE_ID);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(Math.min(Math.max(Number(limit) || DEFAULT_CATALOG_LIMIT, 1), 50)));

  const { response, data } = await mercadoLivreGet(url, accessToken);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      results: [],
      message: providerErrorMessage(
        data,
        `Mercado Livre respondeu HTTP ${response.status} na busca de catálogo.`
      ),
    };
  }

  return {
    ok: true,
    status: response.status,
    results: Array.isArray(data.results) ? data.results : [],
    paging: data.paging || null,
    message: null,
  };
}

async function getCatalogProductDetail(productId, accessToken) {
  const url = `https://api.mercadolibre.com/products/${encodeURIComponent(productId)}`;
  const { response, data } = await mercadoLivreGet(url, accessToken);
  if (!response.ok) return null;
  return data;
}

async function getDiscountedCatalogListings(productId, accessToken) {
  const url = new URL(`https://api.mercadolibre.com/products/${encodeURIComponent(productId)}/items`);
  url.searchParams.set("discount", "10-100");
  const { response, data } = await mercadoLivreGet(url, accessToken);
  if (!response.ok) return [];
  return Array.isArray(data.results) ? data.results : [];
}

function isMarketplacePrice(price) {
  const restrictions = price?.conditions?.context_restrictions;
  if (!Array.isArray(restrictions) || restrictions.length === 0) return true;
  return restrictions.includes("channel_marketplace");
}

function selectItemPriceSnapshot(data) {
  const prices = Array.isArray(data?.prices) ? data.prices.filter(isMarketplacePrice) : [];
  if (!prices.length) return null;

  const promotions = prices
    .filter((entry) => String(entry.type || "").toLowerCase() === "promotion")
    .filter((entry) => Number(entry.amount || 0) > 0)
    .sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));

  const promotion = promotions[0];
  if (promotion) {
    return {
      amount: Number(promotion.amount || 0),
      regularAmount: Number(promotion.regular_amount || 0) || null,
      isPromotion: true,
      source: "items_prices_promotion",
    };
  }

  const standards = prices
    .filter((entry) => String(entry.type || "").toLowerCase() === "standard")
    .filter((entry) => Number(entry.amount || 0) > 0)
    .sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));

  const standard = standards[0];
  if (!standard) return null;

  return {
    amount: Number(standard.amount || 0),
    regularAmount: Number(standard.regular_amount || 0) || null,
    isPromotion: false,
    source: "items_prices_standard",
  };
}

async function getItemPriceSnapshot(itemId, accessToken) {
  if (!itemId) return null;
  const url = `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}/prices`;
  const { response, data } = await mercadoLivreGet(url, accessToken);
  if (!response.ok) return null;
  return selectItemPriceSnapshot(data);
}

function chooseBestListing(product, listings, query) {
  const normalized = listings
    .map((listing) => normalizeCatalogOffer(product, listing, query))
    .filter(Boolean)
    .filter((offer) => offer.price > 0)
    .filter((offer) => offer.keywordRelevance >= 0.5)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.discountPercent !== a.discountPercent) return b.discountPercent - a.discountPercent;
      return Number(b.freeShipping) - Number(a.freeShipping);
    });

  return normalized[0] || null;
}

async function resolveCatalogOffer(candidate, query, accessToken) {
  const detail = await getCatalogProductDetail(candidate.id, accessToken);
  const product = detail || candidate;
  const winner = detail?.buy_box_winner || candidate?.buy_box_winner || null;

  let winnerOffer = null;
  if (winner) {
    const priceSnapshot = await getItemPriceSnapshot(winner.item_id, accessToken);
    winnerOffer = normalizeCatalogOffer(product, winner, query, priceSnapshot);
  }

  // Se o vencedor não expõe desconto, tentamos localizar uma publicação de catálogo
  // explicitamente filtrada por desconto. Se não houver, mantemos o vencedor normal.
  if (!winnerOffer || winnerOffer.discountPercent <= 0) {
    const discountedListings = await getDiscountedCatalogListings(candidate.id, accessToken);
    const discountedOffer = chooseBestListing(product, discountedListings, query);
    if (discountedOffer && (!winnerOffer || discountedOffer.score >= winnerOffer.score)) {
      return discountedOffer;
    }
  }

  if (
    winnerOffer
    && winnerOffer.price > 0
    && winnerOffer.keywordRelevance >= 0.5
  ) {
    return winnerOffer;
  }

  return null;
}

async function mapInBatches(items, batchSize, mapper) {
  const output = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const settled = await Promise.allSettled(batch.map(mapper));
    for (const entry of settled) {
      if (entry.status === "fulfilled" && entry.value) output.push(entry.value);
    }
  }
  return output;
}

export function buildMercadoLivreAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }) {
  const url = new URL("https://auth.mercadolivre.com.br/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", String(clientId));
  url.searchParams.set("redirect_uri", String(redirectUri));
  url.searchParams.set("state", String(state));
  url.searchParams.set("code_challenge", String(codeChallenge));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeMercadoLivreAuthorizationCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
  codeVerifier,
}) {
  return tokenRequest({
    grant_type: "authorization_code",
    client_id: String(clientId),
    client_secret: String(clientSecret),
    code: String(code),
    redirect_uri: String(redirectUri),
    code_verifier: String(codeVerifier),
  });
}

export async function refreshMercadoLivreAccessToken({ clientId, clientSecret, refreshToken }) {
  return tokenRequest({
    grant_type: "refresh_token",
    client_id: String(clientId),
    client_secret: String(clientSecret),
    refresh_token: String(refreshToken),
  });
}

export async function searchMercadoLivre({ query, limit = 20, accessToken = "" }) {
  const result = await searchMercadoLivreBest({
    query,
    accessToken,
    catalogLimit: Math.min(Math.max(Number(limit) || 20, 1), 50),
  });

  return {
    ok: result.ok,
    restricted: result.status === 403,
    status: result.status,
    message: result.warning,
    offers: result.offers,
    paging: null,
  };
}

export async function searchMercadoLivreBest({
  query,
  accessToken = "",
  catalogLimit = DEFAULT_CATALOG_LIMIT,
}) {
  if (!accessToken) {
    return {
      ok: false,
      offers: [],
      warning: "Mercado Livre ainda não possui access token OAuth válido.",
      pagesFetched: 0,
      status: 401,
    };
  }

  const catalog = await searchCatalogProducts({
    query,
    accessToken,
    limit: catalogLimit,
  });

  if (!catalog.ok) {
    const detail = catalog.status === 403
      ? "O endpoint de catálogo também foi recusado com 403 para esta aplicação."
      : catalog.message;

    return {
      ok: false,
      offers: [],
      warning: detail,
      pagesFetched: 0,
      status: catalog.status,
    };
  }

  const offers = await mapInBatches(
    catalog.results,
    DETAIL_CONCURRENCY,
    (candidate) => resolveCatalogOffer(candidate, query, accessToken)
  );

  const unique = new Map();
  for (const offer of offers) {
    const key = `${offer.marketplaceSlug}:${offer.externalId}`;
    const current = unique.get(key);
    if (!current || offer.score > current.score) unique.set(key, offer);
  }

  const ranked = Array.from(unique.values())
    .filter((offer) => offer.price > 0)
    .filter((offer) => offer.keywordRelevance >= 0.5)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.discountPercent !== a.discountPercent) return b.discountPercent - a.discountPercent;
      return Number(b.freeShipping) - Number(a.freeShipping);
    })
    .slice(0, 60);

  return {
    ok: true,
    offers: ranked,
    warning: ranked.length
      ? null
      : "O Mercado Livre respondeu pelo catálogo, mas não encontrei produtos relevantes para esta palavra-chave.",
    pagesFetched: 1,
    status: 200,
    source: "mercado_livre_catalog",
  };
}
