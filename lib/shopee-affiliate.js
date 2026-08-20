import crypto from "node:crypto";

const SHOPEE_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
const DEFAULT_PAGE_SIZE = 50;
const MAX_SEARCH_PAGES = 100;

function normalizePercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number <= 1 ? number * 100 : number) * 100) / 100;
}

function calculateScore(node) {
  const discount = Math.min(normalizePercent(node.priceDiscountRate), 40);
  const rating = Math.min(Math.max(Number(node.ratingStar || 0), 0) / 5 * 20, 20);
  const sales = Math.min(Math.log10(Number(node.sales || 0) + 1) * 4, 15);
  const commission = Math.min(normalizePercent(node.commissionRate), 20);
  return Math.round(Math.min(discount + rating + sales + commission + 5, 100));
}

export async function shopeeGraphql({ appId, secret, query }) {
  const body = JSON.stringify({ query });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash("sha256")
    .update(`${appId}${timestamp}${body}${secret}`)
    .digest("hex");

  const response = await fetch(SHOPEE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
    },
    body,
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Shopee respondeu HTTP ${response.status}.`);
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
    productOfferV2(keyword: "oferta", sortType: 5, page: 1, limit: 1) {
      pageInfo { page limit hasNextPage }
    }
  }`;
  await shopeeGraphql({ appId, secret, query });
  return true;
}

function normalizeShopeeNode(node) {
  const price = Number(node.priceMin || node.priceMax || 0);
  const discountPercent = normalizePercent(node.priceDiscountRate);
  const originalPrice = discountPercent > 0 && discountPercent < 100
    ? price / (1 - discountPercent / 100)
    : price;

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
    soldQuantity: Number(node.sales || 0),
    rating: Number(node.ratingStar || 0),
    sellerName: node.shopName || "Shopee",
    commissionRate: normalizePercent(node.commissionRate),
    sellerCommissionRate: normalizePercent(node.sellerCommissionRate),
    shopeeCommissionRate: normalizePercent(node.shopeeCommissionRate),
    freeShipping: false,
    couponText: null,
    categoryExternalId: null,
    score: calculateScore(node),
    raw: node,
  };
}

async function fetchShopeeOfferPage({ appId, secret, keyword, page, limit }) {
  const safeKeyword = JSON.stringify(String(keyword || "").trim());
  const query = `{
    productOfferV2(keyword: ${safeKeyword}, sortType: 5, page: ${page}, limit: ${limit}) {
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
        ratingStar
        priceDiscountRate
        shopId
        shopName
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
      const normalized = normalizeShopeeNode(node);
      if (!unique.has(normalized.externalId)) newItems += 1;
      unique.set(normalized.externalId, normalized);
    }

    const hasNextPage = Boolean(pageInfo?.hasNextPage);
    if (!hasNextPage || nodes.length === 0 || newItems === 0) break;

    page += 1;
  }

  if (page >= safeMaxPages) {
    truncated = true;
  }

  return {
    offers: Array.from(unique.values()),
    pagesFetched,
    totalFetched,
    truncated,
  };
}
