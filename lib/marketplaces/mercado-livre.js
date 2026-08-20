const API_URL = "https://api.mercadolibre.com/sites/MLB/search";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function calculateScore({ discountPercent, freeShipping, soldQuantity }) {
  const discountScore = clamp(Number(discountPercent || 0) * 1.4, 0, 55);
  const shippingScore = freeShipping ? 15 : 0;
  const soldScore = clamp(Math.log10(Number(soldQuantity || 0) + 1) * 10, 0, 30);
  return Math.round(clamp(discountScore + shippingScore + soldScore, 0, 100));
}

function normalizeResult(item) {
  const price = Number(item.price || 0);
  const originalPrice = Number(item.original_price || 0) || null;
  const discountPercent = originalPrice && originalPrice > price
    ? ((originalPrice - price) / originalPrice) * 100
    : 0;
  const freeShipping = Boolean(item.shipping?.free_shipping);
  const soldQuantity = Number(item.sold_quantity || 0);

  return {
    externalId: item.id,
    title: item.title,
    permalink: item.permalink,
    thumbnailUrl: item.thumbnail?.replace("http://", "https://") || null,
    price,
    originalPrice,
    discountPercent: Number(discountPercent.toFixed(2)),
    freeShipping,
    soldQuantity,
    sellerName: item.seller?.nickname || null,
    categoryExternalId: item.category_id || null,
    score: calculateScore({ discountPercent, freeShipping, soldQuantity }),
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
    return {
      externalId: `DEMO-${index + 1}`,
      title: `${title} · ${query}`,
      permalink: "https://www.mercadolivre.com.br/",
      thumbnailUrl: null,
      price,
      originalPrice,
      discountPercent: Number(discountPercent.toFixed(2)),
      freeShipping,
      soldQuantity,
      sellerName: "Vendedor demonstrativo",
      categoryExternalId: "DEMO",
      score: calculateScore({ discountPercent, freeShipping, soldQuantity }),
      couponText: index === 0 ? "Cupom pode estar disponível no anúncio" : null,
      raw: { demo: true },
    };
  });
}

export async function searchMercadoLivre({ query, limit = 20, accessToken }) {
  const url = new URL(API_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(Math.min(Number(limit) || 20, 50)));

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
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      restricted: false,
      status: response.status,
      message: `Mercado Livre respondeu HTTP ${response.status}.`,
      offers: [],
    };
  }

  const data = await response.json();
  return {
    ok: true,
    restricted: false,
    status: 200,
    offers: (data.results || []).map(normalizeResult),
  };
}
