const CATALOG_SEARCH_URL = "https://api.mercadolibre.com/products/search";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const SITE_ID = "MLB";
const DEFAULT_CATALOG_LIMIT = 50;
const DETAIL_CONCURRENCY = 6;
const MIN_RELEVANCE = 0.18;

const STOPWORDS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas",
  "para", "por", "com", "sem", "um", "uma", "uns", "umas", "the", "of", "for", "and",
]);

const SEARCH_NOISE = new Set(["oferta", "ofertas", "promocao", "promocoes", "barato", "barata", "desconto"]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function searchableProductText(product) {
  const attributes = Array.isArray(product?.attributes)
    ? product.attributes.flatMap((attribute) => [
        attribute?.name,
        attribute?.value_name,
        ...(Array.isArray(attribute?.values) ? attribute.values.map((value) => value?.name) : []),
      ])
    : [];
  const features = Array.isArray(product?.main_features)
    ? product.main_features.flatMap((feature) => [feature?.text, feature?.value_name, feature?.name])
    : [];

  return normalizeText([
    product?.name,
    product?.family_name,
    product?.domain_id,
    ...attributes,
    ...features,
  ].filter(Boolean).join(" "));
}

function keywordRelevance(product, query) {
  const text = searchableProductText(product);
  const normalizedQuery = normalizeText(query);
  const tokens = meaningfulTokens(query);
  if (!tokens.length) return 1;
  if (normalizedQuery && text.includes(normalizedQuery)) return 1;

  const words = text.split(" ").filter(Boolean);
  let points = 0;
  for (const token of tokens) {
    if (text.includes(token)) {
      points += 1;
      continue;
    }
    if (token.length >= 5) {
      const stem = token.slice(0, Math.max(4, token.length - 2));
      if (words.some((word) => word.startsWith(stem))) points += 0.75;
    }
  }
  return clamp(points / tokens.length, 0, 1);
}

function buildQueryVariants(query) {
  const raw = String(query || "").trim();
  const normalized = normalizeText(raw);
  const tokens = meaningfulTokens(raw);
  const useful = tokens.filter((token) => !SEARCH_NOISE.has(token));
  const variants = [raw];

  const compact = useful.slice(0, 6).join(" ");
  if (compact && normalizeText(compact) !== normalized) variants.push(compact);

  if (useful.length >= 3) variants.push(useful.slice(0, 3).join(" "));
  else if (useful.length === 2) variants.push(useful.join(" "));

  return Array.from(new Set(variants.map((value) => value.trim()).filter((value) => value.length >= 2))).slice(0, 3);
}

function sellerReputationLevel(listing) {
  return String(
    listing?.seller?.reputation_level_id
      || listing?.seller?.reputation?.level_id
      || listing?.seller?.seller_reputation?.level_id
      || ""
  ).toLowerCase();
}

function sellerReputationScore(value) {
  const reputation = String(value || "").toLowerCase();
  if (reputation.includes("green")) return 20;
  if (reputation.includes("yellow")) return 13;
  if (reputation.includes("orange")) return 7;
  if (reputation.includes("red")) return 2;
  return 6;
}

function calculateCatalogScore({ discountPercent, freeShipping, officialStore, condition, relevance, sellerReputation, hasDeal }) {
  const discountScore = clamp(Number(discountPercent || 0) / 50, 0, 1) * 15;
  const shippingScore = freeShipping ? 15 : 0;
  const officialScore = officialStore ? 15 : 5;
  const conditionScore = condition === "new" ? 5 : 0;
  const relevanceScore = clamp(Number(relevance || 0), 0, 1) * 25;
  const reputationScore = sellerReputationScore(sellerReputation);
  const dealScore = hasDeal ? 5 : 0;
  return Math.round(clamp(discountScore + shippingScore + officialScore + conditionScore + relevanceScore + reputationScore + dealScore, 0, 100));
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

function normalizeCatalogOffer(product, listing, query, priceSnapshot = null, relevanceFloor = 0) {
  if (!product || !listing) return null;

  const snapshotPrice = Number(priceSnapshot?.amount || 0);
  const listingPrice = Number(listing.price || 0);
  const price = snapshotPrice > 0 ? snapshotPrice : listingPrice;
  if (!(price > 0)) return null;

  const snapshotRegular = Number(priceSnapshot?.regularAmount || 0);
  const listingOriginal = Number(listing.original_price || 0);
  const originalPrice = snapshotRegular > price ? snapshotRegular : listingOriginal > price ? listingOriginal : null;
  const discountPercent = originalPrice && originalPrice > price ? ((originalPrice - price) / originalPrice) * 100 : 0;

  const title = product.name || product.family_name || "Produto Mercado Livre";
  const relevance = Math.max(keywordRelevance(product, query), Number(relevanceFloor || 0));
  const freeShipping = Boolean(listing.shipping?.free_shipping);
  const officialStore = Boolean(listing.official_store_id);
  const sellerReputation = sellerReputationLevel(listing);
  const hasDeal = Boolean(priceSnapshot?.isPromotion) || (Array.isArray(listing.deal_ids) && listing.deal_ids.length > 0);
  const soldQuantity = Number(listing.sold_quantity || product.sold_quantity || 0);

  const score = calculateCatalogScore({
    discountPercent,
    freeShipping,
    officialStore,
    condition: listing.condition || "new",
    relevance,
    sellerReputation,
    hasDeal,
  });

  return {
    marketplaceSlug: "mercado-livre",
    marketplaceName: "Mercado Livre",
    marketplaceCode: "ML",
    externalId: listing.item_id || listing.id || product.id,
    title,
    permalink: buildCatalogPermalink(product),
    affiliateUrl: null,
    thumbnailUrl: getPicture(product),
    price,
    originalPrice,
    discountPercent: Number(discountPercent.toFixed(2)),
    freeShipping,
    soldQuantity,
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
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const error = new Error(data.error_description || data.message || data.error || `Mercado Livre respondeu HTTP ${response.status} ao gerar token.`);
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
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
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
  url.searchParams.set("skip_cache", "true");

  const { response, data } = await mercadoLivreGet(url, accessToken);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      results: [],
      message: providerErrorMessage(data, `Mercado Livre respondeu HTTP ${response.status} na busca de catálogo.`),
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

async function searchCatalogCandidates({ query, accessToken, limit }) {
  const variants = buildQueryVariants(query);
  const candidates = new Map();
  const queriesTried = [];
  let firstError = null;

  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    const result = await searchCatalogProducts({ query: variant, accessToken, limit });
    queriesTried.push(variant);
    if (!result.ok) {
      firstError ||= result;
      if (index === 0) break;
      continue;
    }

    const floor = index === 0 ? 0.35 : 0.2;
    for (const candidate of result.results) {
      if (!candidate?.id) continue;
      const current = candidates.get(candidate.id);
      if (!current) candidates.set(candidate.id, { ...candidate, __relevanceFloor: floor, __sourceQuery: variant });
      else if (floor > Number(current.__relevanceFloor || 0)) current.__relevanceFloor = floor;
    }

    if (candidates.size >= 24) break;
  }

  return {
    ok: !firstError || candidates.size > 0,
    status: firstError?.status || 200,
    message: candidates.size ? null : firstError?.message || null,
    results: Array.from(candidates.values()).slice(0, 50),
    queriesTried,
  };
}

async function getCatalogProductDetail(productId, accessToken) {
  const url = `https://api.mercadolibre.com/products/${encodeURIComponent(productId)}`;
  const { response, data } = await mercadoLivreGet(url, accessToken);
  if (!response.ok) return null;
  return data;
}

async function getCatalogListings(productId, accessToken, { discountedOnly = false } = {}) {
  const url = new URL(`https://api.mercadolibre.com/products/${encodeURIComponent(productId)}/items`);
  if (discountedOnly) url.searchParams.set("discount", "10-100");
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

function sortOffers(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.keywordRelevance !== a.keywordRelevance) return b.keywordRelevance - a.keywordRelevance;
  if (b.soldQuantity !== a.soldQuantity) return b.soldQuantity - a.soldQuantity;
  if (b.discountPercent !== a.discountPercent) return b.discountPercent - a.discountPercent;
  return Number(b.freeShipping) - Number(a.freeShipping);
}

function chooseBestListing(product, listings, query, relevanceFloor = 0) {
  return listings
    .map((listing) => normalizeCatalogOffer(product, listing, query, null, relevanceFloor))
    .filter(Boolean)
    .filter((offer) => offer.keywordRelevance >= MIN_RELEVANCE)
    .sort(sortOffers)[0] || null;
}

async function resolveCatalogOffer(candidate, query, accessToken) {
  const detail = await getCatalogProductDetail(candidate.id, accessToken);
  const product = detail || candidate;
  const relevanceFloor = Number(candidate.__relevanceFloor || 0);
  const productRelevance = Math.max(keywordRelevance(product, query), relevanceFloor);
  if (productRelevance < MIN_RELEVANCE) return null;

  const winner = detail?.buy_box_winner || candidate?.buy_box_winner || null;
  if (winner) {
    const priceSnapshot = await getItemPriceSnapshot(winner.item_id || winner.id, accessToken);
    const winnerOffer = normalizeCatalogOffer(product, winner, query, priceSnapshot, relevanceFloor);
    if (winnerOffer) return winnerOffer;
  }

  // buy_box_winner pode ser null mesmo para um produto de catálogo válido.
  // Nesse caso buscamos as publicações associadas sem exigir desconto.
  const listings = await getCatalogListings(candidate.id, accessToken);
  const bestListing = chooseBestListing(product, listings, query, relevanceFloor);
  if (bestListing) return bestListing;

  // Última tentativa: produtos com publicação promocional associada.
  const discountedListings = await getCatalogListings(candidate.id, accessToken, { discountedOnly: true });
  return chooseBestListing(product, discountedListings, query, relevanceFloor);
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

export async function exchangeMercadoLivreAuthorizationCode({ clientId, clientSecret, code, redirectUri, codeVerifier }) {
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

export async function searchMercadoLivreBest({ query, accessToken = "", catalogLimit = DEFAULT_CATALOG_LIMIT }) {
  if (!accessToken) {
    return {
      ok: false,
      offers: [],
      warning: "Mercado Livre ainda não possui access token OAuth válido.",
      pagesFetched: 0,
      status: 401,
    };
  }

  const catalog = await searchCatalogCandidates({
    query,
    accessToken,
    limit: Math.min(Math.max(Number(catalogLimit) || DEFAULT_CATALOG_LIMIT, 1), 50),
  });

  if (!catalog.ok) {
    const detail = catalog.status === 403
      ? "O endpoint de catálogo também foi recusado com 403 para esta aplicação."
      : catalog.message;
    return {
      ok: false,
      offers: [],
      warning: detail,
      pagesFetched: catalog.queriesTried?.length || 0,
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
    .filter((offer) => offer.keywordRelevance >= MIN_RELEVANCE)
    .sort(sortOffers)
    .slice(0, 60);

  return {
    ok: true,
    offers: ranked,
    warning: ranked.length ? null : "O Mercado Livre respondeu pelo catálogo, mas não encontrei publicações compráveis para esta palavra-chave.",
    pagesFetched: catalog.queriesTried?.length || 1,
    status: 200,
    source: "mercado_livre_catalog_v2",
    diagnostics: {
      queriesTried: catalog.queriesTried || [query],
      catalogCandidates: catalog.results.length,
      resolvedOffers: offers.length,
    },
  };
}
