import crypto from "node:crypto";

const SHOPEE_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
const DEFAULT_PAGE_SIZE = 50;
const MAX_SEARCH_PAGES = 20;
const REQUEST_TIMEOUT_MS = 10 * 1000;

function normalizePercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number <= 1 ? number * 100 : number) * 100) / 100;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function keywordRelevance(title, keyword) {
  const normalizedTitle = normalizeText(title);
  const tokens = normalizeText(keyword)
    .split(" ")
    .filter((token) => token.length >= 2);

  if (!tokens.length) return 1;
  const matched = tokens.filter((token) => normalizedTitle.includes(token)).length;
  return matched / tokens.length;
}

function normalizeShopTypes(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if (value === null || value === undefined || value === "") return [];
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? [asNumber] : [];
}

function shopQualityScore(shopType) {
  const types = normalizeShopTypes(shopType);
  if (types.includes(1)) return 10;
  if (types.includes(4)) return 9;
  if (types.includes(2)) return 7;
  return 3;
}

function ratingScore(rating) {
  const value = Number(rating || 0);
  if (value >= 4.9) return 25;
  if (value >= 4.8) return 23;
  if (value >= 4.7) return 20;
  if (value >= 4.6) return 17;
  if (value >= 4.5) return 14;
  if (value >= 4.4) return 10;
  if (value >= 4.3) return 6;
  return 0;
}

function salesScore(sales) {
  const value = Math.max(Number(sales || 0), 0);
  if (value >= 10000) return 35;
  if (value >= 5000) return 33;
  if (value >= 2000) return 30;
  if (value >= 1000) return 27;
  if (value >= 500) return 23;
  if (value >= 200) return 19;
  if (value >= 100) return 15;
  if (value >= 50) return 11;
  if (value >= 20) return 7;
  return Math.min(value / 5, 4);
}

function calculateScore(node, keyword) {
  const discount = Math.min(normalizePercent(node.priceDiscountRate) / 50, 1) * 15;
  const commission = Math.min(normalizePercent(node.commissionRate) / 20, 1) * 10;
  const rating = ratingScore(node.ratingStar);
  const sales = salesScore(node.sales);
  const shop = shopQualityScore(node.shopType);
  const relevance = keywordRelevance(node.productName, keyword) * 5;

  return Math.round(Math.min(discount + commission + rating + sales + shop + relevance, 100));
}

function qualityLabel(score, sales, rating) {
  if (score >= 82 && sales >= 500 && rating >= 4.7) return "Excelente";
  if (score >= 68 && sales >= 100 && rating >= 4.5) return "Muito bom";
  if (score >= 55 && sales >= 20 && rating >= 4.3) return "Bom";
  return "Regular";
}

export async function shopeeGraphql({ appId, secret, query }) {
  const body = JSON.stringify({ query });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash("sha256")
    .update(`${appId}${timestamp}${body}${secret}`)
    .digest("hex");

  let response;
  try {
    response = await fetch(SHOPEE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      const timeoutError = new Error("A API da Shopee demorou mais de 10 segundos para responder.");
      timeoutError.code = "SHOPEE_TIMEOUT";
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Shopee respondeu HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  if (data.errors?.length) {
    const first = data.errors[0];
    const detail = first?.extensions?.message || first?.message || "Erro da API Shopee.";
    const error = new Error(detail);
    error.code = first?.extensions?.code;
    throw error;
  }
  return data.data || {};
}

export async function testShopeeCredentials({ appId, secret }) {
  const query = `{
    productOfferV2(keyword: "oferta", listType: 2, sortType: 2, page: 1, limit: 1) {
      pageInfo { page limit hasNextPage }
    }
  }`;
  await shopeeGraphql({ appId, secret, query });
  return true;
}

function normalizeShopeeNode(node, keyword) {
  const price = Number(node.priceMin || node.priceMax || 0);
  const discountPercent = normalizePercent(node.priceDiscountRate);
  const originalPrice = discountPercent > 0 && discountPercent < 100
    ? price / (1 - discountPercent / 100)
    : price;
  const soldQuantity = Number(node.sales || 0);
  const rating = Number(node.ratingStar || 0);
  const relevance = keywordRelevance(node.productName, keyword);
  const score = calculateScore(node, keyword);

  return {
    marketplaceSlug: "shopee",
    externalId: `${node.shopId || "shop"}:${node.itemId}`,
    title: node.productName,
    permalink: node.productLink,
    affiliateUrl: node.offerLink || node.productLink,
    thumbnailUrl: node.imageUrl,
    price,
    originalPrice,
    discountPercent,
    soldQuantity,
    rating,
    sellerName: node.shopName || "Shopee",
    shopType: normalizeShopTypes(node.shopType),
    commissionRate: normalizePercent(node.commissionRate),
    sellerCommissionRate: normalizePercent(node.sellerCommissionRate),
    shopeeCommissionRate: normalizePercent(node.shopeeCommissionRate),
    estimatedCommission: Number(node.commission || 0),
    freeShipping: false,
    couponText: null,
    categoryExternalId: Array.isArray(node.productCatIds) ? node.productCatIds.at(-1) || null : null,
    keywordRelevance: relevance,
    score,
    qualityLabel: qualityLabel(score, soldQuantity, rating),
    raw: node,
  };
}

async function fetchShopeeOfferPage({ appId, secret, keyword, page, limit }) {
  const safeKeyword = JSON.stringify(String(keyword || "").trim());
  const query = `{
    productOfferV2(keyword: ${safeKeyword}, listType: 2, sortType: 2, page: ${page}, limit: ${limit}) {
      nodes {
        itemId
        productName
        productLink
        offerLink
        imageUrl
        priceMin
        priceMax
        sales
        commissionRate
        sellerCommissionRate
        shopeeCommissionRate
        commission
        ratingStar
        priceDiscountRate
        productCatIds
        shopId
        shopName
        shopType
      }
      pageInfo { page limit hasNextPage }
    }
  }`;

  const data = await shopeeGraphql({ appId, secret, query });
  const result = data?.productOfferV2 || {};
  return {
    nodes: result.nodes || [],
    pageInfo: result.pageInfo || {},
  };
}

export async function searchShopeeOffers({
  appId,
  secret,
  keyword,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = MAX_SEARCH_PAGES,
}) {
  const safePageSize = Math.min(Math.max(Number(pageSize) || DEFAULT_PAGE_SIZE, 1), 50);
  const safeMaxPages = Math.min(Math.max(Number(maxPages) || MAX_SEARCH_PAGES, 1), MAX_SEARCH_PAGES);
  const unique = new Map();
  let page = 1;
  let pagesFetched = 0;
  let totalFetched = 0;
  let truncated = false;

  while (page <= safeMaxPages) {
    const { nodes, pageInfo } = await fetchShopeeOfferPage({
      appId,
      secret,
      keyword,
      page,
      limit: safePageSize,
    });

    pagesFetched += 1;
    totalFetched += nodes.length;

    let newItems = 0;
    for (const node of nodes) {
      const normalized = normalizeShopeeNode(node, keyword);
      if (!unique.has(normalized.externalId)) newItems += 1;
      unique.set(normalized.externalId, normalized);
    }

    const hasNextPage = Boolean(pageInfo?.hasNextPage);
    if (!hasNextPage || nodes.length === 0 || newItems === 0) break;

    if (page === safeMaxPages) {
      truncated = true;
      break;
    }

    page += 1;
  }

  return {
    offers: Array.from(unique.values()),
    pagesFetched,
    totalFetched,
    truncated,
  };
}
