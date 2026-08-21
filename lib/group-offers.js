export const DEFAULT_GROUP_TEMPLATE = `🔥 *{title}*

💰 *Por {price}*
{discount}
{shipping}

🛒 Comprar: {link}

⚠️ Preço e disponibilidade podem mudar.`;

export function formatMoney(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

export function slugifyGroup(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function queuePriority(offer) {
  const score = Number(offer?.score || 0);
  const commission = Math.min(Number(offer?.estimatedCommission || 0) / 2, 20);
  const discount = Math.min(Number(offer?.discountPercent || 0) / 4, 15);
  const rating = Number(offer?.rating || 0) >= 4.8 ? 5 : Number(offer?.rating || 0) >= 4.5 ? 3 : 0;
  const shipping = offer?.freeShipping ? 5 : 0;
  return Math.round(Math.min(100, score * 0.55 + commission + discount + rating + shipping));
}

export function renderGroupMessage(template, offer) {
  const link = offer?.affiliateUrl || offer?.affiliate_url || offer?.permalink || "";
  const price = Number(offer?.price || 0);
  const originalPrice = Number(offer?.originalPrice ?? offer?.original_price ?? 0);
  const discountPercent = Number(offer?.discountPercent ?? offer?.discount_percent ?? 0);
  const estimatedCommission = Number(offer?.estimatedCommission ?? offer?.estimated_commission ?? 0);
  const replacements = {
    "{title}": offer?.title || "Oferta",
    "{price}": formatMoney(price),
    "{original_price}": originalPrice > price ? formatMoney(originalPrice) : "",
    "{discount}": discountPercent > 0 ? `📉 *${Math.round(discountPercent)}% OFF*` : "",
    "{discount_percent}": discountPercent > 0 ? `${Math.round(discountPercent)}%` : "",
    "{shipping}": offer?.freeShipping || offer?.free_shipping ? "🚚 Frete grátis" : "",
    "{link}": link,
    "{marketplace}": offer?.marketplaceName || offer?.marketplace_slug || offer?.marketplaceSlug || "",
    "{commission}": estimatedCommission > 0 ? formatMoney(estimatedCommission) : "",
    "{score}": String(Math.round(Number(offer?.score || 0))),
  };

  let message = String(template || DEFAULT_GROUP_TEMPLATE);
  for (const [token, value] of Object.entries(replacements)) {
    message = message.split(token).join(value);
  }
  return message.replace(/\n{3,}/g, "\n\n").trim();
}

export function offerSnapshot(offer, groupTemplate = "") {
  return {
    marketplace_slug: offer.marketplaceSlug || offer.marketplace_slug || "shopee",
    external_id: String(offer.externalId || offer.external_id || ""),
    title: String(offer.title || "Oferta"),
    permalink: offer.permalink || null,
    affiliate_url: offer.affiliateUrl || offer.affiliate_url || offer.permalink || null,
    thumbnail_url: offer.thumbnailUrl || offer.thumbnail_url || null,
    seller_name: offer.sellerName || offer.seller_name || null,
    price: Number(offer.price || 0),
    original_price: Number(offer.originalPrice ?? offer.original_price ?? 0) || null,
    discount_percent: Number(offer.discountPercent ?? offer.discount_percent ?? 0),
    score: Number(offer.score || 0),
    estimated_commission: Number(offer.estimatedCommission ?? offer.estimated_commission ?? 0),
    commission_rate: Number(offer.commissionRate ?? offer.commission_rate ?? 0),
    rating: Number(offer.rating || 0) || null,
    sold_quantity: Number(offer.soldQuantity ?? offer.sold_quantity ?? 0),
    free_shipping: Boolean(offer.freeShipping ?? offer.free_shipping),
    priority: queuePriority(offer),
    message_text: renderGroupMessage(groupTemplate, offer),
    metadata: {
      quality_label: offer.qualityLabel || null,
      commission_category: offer.commissionCategory || null,
      category_external_id: offer.categoryExternalId || null,
    },
  };
}