import crypto from "node:crypto";

const SHOPEE_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";

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

export async function searchShopeeOffers({ appId, secret, keyword, limit = 24 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 50);
  const safeKeyword = JSON.stringify(String(keyword || "").trim());
  const query = `{
    productOfferV2(keyword: ${safeKeyword}, sortType: 5, page: 1, limit: ${safeLimit}) {
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
  const nodes = data?.productOfferV2?.nodes || [];

  return nodes.map((node) => {
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
  });
}
