const API_URL = "https://api.mercadolibre.com/sites/MLB/search";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

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
  const tokens = normalizeText(query)
    .split(" ")
    .filter((token) => token.length >= 2);

  if (!tokens.length) return 1;
  const hits = tokens.filter((token) => titleText.includes(token)).length;
  return hits / tokens.length;
}

function salesScore(soldQuantity) {
  const sold = Math.max(Number(soldQuantity || 0), 0);
  if (sold >= 10000) return 42;
  if (sold >= 5000) return 39;
  if (sold >= 2000) return 35;
  if (sold >= 1000) return 31;
  if (sold >= 500) return 27;
  if (sold >= 200) return 22;
  if (sold >= 100) return 18;
  if (sold >= 50) return 14;
  if (sold >= 20) return 9;
  return Math.min(sold / 4, 5);
}

function calculateScore({ discountPercent, freeShipping, soldQuantity, officialStore, condition, relevance }) {
  const discountScore = clamp(Number(discountPercent || 0) / 50, 0, 1) * 25;
  const shippingScore = freeShipping ? 10 : 0;
  const soldScore = salesScore(soldQuantity);
  const officialScore = officialStore ? 10 : 3;
  const conditionScore = condition === "new" ? 5 : 0;
  const relevanceScore = clamp(Number(relevance || 0), 0, 1) * 8;

  return Math.round(clamp(
    discountScore + shippingScore + soldScore + officialScore + conditionScore + relevanceScore,
    0,
    100
  ));
}

function qualityLabel(score, soldQuantity) {
  const sold = Number(soldQuantity || 0);
  if (score >= 78 && sold >= 500) return "Excelente";
  if (score >= 62 && sold >= 100) return "Muito bom";
  if (score >= 48) return "Bom";
  return "Regular";
}

function normalizeResult(item, query) {
  const price = Number(item.price || 0);
  const originalPrice = Number(item.original_price || 0) || null;
  const discountPercent = originalPrice && originalPrice > price
    ? ((originalPrice - price) / originalPrice) * 100
    : 0;
  const freeShipping = Boolean(item.shipping?.free_shipping);
  const soldQuantity = Number(item.sold_quantity || 0);
  const officialStore = Boolean(item.official_store_id);
  const relevance = keywordRelevance(item.title, query);
  const score = calculateScore({
    discountPercent,
    freeShipping,
    soldQuantity,
    officialStore,
    condition: item.condition,
    relevance,
  });

  return {
    marketplaceSlug: "mercado-livre",
    marketplaceName: "Mercado Livre",
    marketplaceCode: "ML",
    externalId: item.id,
    title: item.title,
    permalink: item.permalink,
    affiliateUrl: null,
    thumbnailUrl: item.thumbnail?.replace("http://", "https://") || null,
    price,
    originalPrice,
    discountPercent: Number(discountPercent.toFixed(2)),
    freeShipping,
    soldQuantity,
    rating: null,
    sellerName: item.seller?.nickname || (officialStore ? "Loja oficial" : "Mercado Livre"),
    officialStore,
    categoryExternalId: item.category_id || null,
    commissionRate: 0,
    keywordRelevance: relevance,
    score,
    qualityLabel: qualityLabel(score, soldQuantity),
    couponText: null,
    raw: item,
  };
}

export function getDemoOffers(query = "oferta") {
  const base = [
    ["Kit Parafusadeira 12V com maleta", 189.9, 299.9, true, 4280],
    ["Fone Bluetooth TWS com estojo", 79.9, 149.9, true, 9130],
    ["Air Fryer 4L digital", 279.9, 399.9, true, 5620],
    ["Jogo de ferramentas 129 peças", 219.9, 349.9, false, 1860],
    ["Smartwatch AMOLED esportivo", 159.9, 249.9, true, 7480],
    ["Aspirador portátil sem fio", 129.9, 199.9, true, 3270]
  ];

  return base.map(([title, price, originalPrice, freeShipping, soldQuantity], index) => {
    const discountPercent = ((originalPrice - price) / originalPrice) * 100;
    const relevance = keywordRelevance(`${title} ${query}`, query);
    const score = calculateScore({
      discountPercent,
      freeShipping,
      soldQuantity,
      officialStore: false,
      condition: "new",
      relevance,
    });

    return {
      marketplaceSlug: "mercado-livre",
      marketplaceName: "Mercado Livre",
      marketplaceCode: "ML",
      externalId: `DEMO-${index + 1}`,
      title: `${title} · ${query}`,
      permalink: "https://www.mercadolivre.com.br/",
      affiliateUrl: null,
      thumbnailUrl: null,
      price,
      originalPrice,
      discountPercent: Number(discountPercent.toFixed(2)),
      freeShipping,
      soldQuantity,
      rating: null,
      sellerName: "Vendedor demonstrativo",
      officialStore: false,
      categoryExternalId: "DEMO",
      commissionRate: 0,
      keywordRelevance: relevance,
      score,
      qualityLabel: qualityLabel(score, soldQuantity),
      couponText: index === 0 ? "Cupom pode estar disponível no anúncio" : null,
      raw: { demo: true },
    };
  });
}

export async function getMercadoLivreClientCredentialsToken({ clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: String(clientId || "").trim(),
    client_secret: String(clientSecret || "").trim(),
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    return {
      ok: false,
      status: response.status,
      accessToken: null,
      message: data.message || data.error_description || data.error || `Mercado Livre respondeu HTTP ${response.status} ao gerar token da aplicação.`,
    };
  }

  return {
    ok: true,
    status: response.status,
    accessToken: data.access_token,
    expiresIn: Number(data.expires_in || 0),
    message: null,
  };
}

export async function searchMercadoLivre({ query, limit = 50, offset = 0, accessToken = "" }) {
  const url = new URL(API_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(Math.min(Number(limit) || 50, 50)));
  url.searchParams.set("offset", String(Math.max(Number(offset) || 0, 0)));

  const headers = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(url, {
    headers,
    cache: "no-store",
  });

  if (response.status === 403) {
    return {
      ok: false,
      restricted: true,
      status: 403,
      message: "A busca do Mercado Livre retornou 403 para esta aplicação.",
      offers: [],
      paging: null,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      restricted: false,
      status: response.status,
      message: `Mercado Livre respondeu HTTP ${response.status}.`,
      offers: [],
      paging: null,
    };
  }

  const data = await response.json();
  return {
    ok: true,
    restricted: false,
    status: 200,
    offers: (data.results || []).map((item) => normalizeResult(item, query)),
    paging: data.paging || null,
  };
}

export async function searchMercadoLivreBest({ query, accessToken = "", maxPages = 4, pageSize = 50 }) {
  const unique = new Map();
  let warning = null;
  let pagesFetched = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await searchMercadoLivre({
      query,
      accessToken,
      limit: pageSize,
      offset: page * pageSize,
    });

    if (!result.ok) {
      warning = result.message;
      if (page === 0) {
        return { ok: false, offers: [], warning, pagesFetched, status: result.status };
      }
      break;
    }

    pagesFetched += 1;
    for (const offer of result.offers) {
      unique.set(offer.externalId, offer);
    }

    const total = Number(result.paging?.total || 0);
    const offset = Number(result.paging?.offset || page * pageSize);
    const limit = Number(result.paging?.limit || pageSize);
    if (!result.offers.length || (total > 0 && offset + limit >= total)) break;
  }

  const offers = Array.from(unique.values())
    .filter((offer) => Number(offer.discountPercent || 0) > 0)
    .filter((offer) => Number(offer.keywordRelevance || 0) >= 0.5)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.soldQuantity !== a.soldQuantity) return b.soldQuantity - a.soldQuantity;
      return b.discountPercent - a.discountPercent;
    })
    .slice(0, 60);

  return { ok: true, offers, warning, pagesFetched, status: 200 };
}
