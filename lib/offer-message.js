function money(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

export function buildOfferMessage({ offer, affiliateUrl }) {
  const lines = ["🔥 *OFERTA ENCONTRADA*", "", `*${offer.title}*`, ""];

  if (offer.originalPrice && Number(offer.originalPrice) > Number(offer.price)) {
    lines.push(`De: ~${money(offer.originalPrice)}~`);
  }

  lines.push(`💰 *Por: ${money(offer.price)}*`);

  if (offer.discountPercent > 0) {
    lines.push(`📉 ${Math.round(offer.discountPercent)}% OFF`);
  }

  if (offer.freeShipping) {
    lines.push("🚚 Frete grátis");
  }

  if (offer.couponText) {
    lines.push(`🎟 ${offer.couponText}`);
  }

  lines.push("", "🛒 Comprar aqui:", affiliateUrl, "", "⚠️ Preço e disponibilidade podem mudar a qualquer momento.");

  return lines.join("\n");
}
