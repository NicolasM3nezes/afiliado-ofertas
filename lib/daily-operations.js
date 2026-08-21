import { offerSnapshot, queuePriority } from "@/lib/group-offers";

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function productKey(item) {
  return `${item.marketplaceSlug || item.marketplace_slug}:${String(item.externalId || item.external_id || "")}`;
}

function titleSignature(title) {
  const ignored = new Set(["de", "da", "do", "das", "dos", "com", "para", "e", "em", "o", "a"]);
  return normalize(title)
    .split(" ")
    .filter((token) => token.length > 2 && !ignored.has(token))
    .slice(0, 3)
    .join(" ");
}

export function offerFitsGroup(offer, group) {
  const slug = offer.marketplaceSlug || offer.marketplace_slug;
  const price = Number(offer.price || 0);
  const score = Number(offer.score || 0);
  const commission = Number(offer.estimatedCommission ?? offer.estimated_commission ?? 0);
  const title = normalize(offer.title);

  if (group.allowed_marketplaces?.length && !group.allowed_marketplaces.includes(slug)) {
    return { ok: false, reason: "marketplace" };
  }
  if (group.price_min != null && price < Number(group.price_min)) {
    return { ok: false, reason: "price_min" };
  }
  if (group.price_max != null && price > Number(group.price_max)) {
    return { ok: false, reason: "price_max" };
  }
  if (score < Number(group.min_score || 0)) {
    return { ok: false, reason: "score" };
  }
  if (commission < Number(group.min_commission || 0)) {
    return { ok: false, reason: "commission" };
  }
  const excluded = (group.excluded_keywords || []).map(normalize).filter(Boolean);
  if (excluded.some((term) => title.includes(term))) {
    return { ok: false, reason: "excluded_keyword" };
  }
  return { ok: true, reason: null };
}

function hoursSince(value, now = Date.now()) {
  if (!value) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - new Date(value).getTime()) / 3600000;
}

export function isRepeatBlocked(offer, group, queue, now = Date.now()) {
  const key = productKey(offer);
  const latest = (queue || [])
    .filter((row) => row.group_id === group.id && row.status === "published" && productKey(row) === key && row.published_at)
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))[0];
  if (!latest) return false;
  return hoursSince(latest.published_at, now) < Number(group.repeat_after_hours || 72);
}

function classifyOffer(offer, group) {
  const sold = Number(offer.soldQuantity ?? offer.sold_quantity ?? 0);
  const commission = Number(offer.estimatedCommission ?? offer.estimated_commission ?? 0);
  const price = Number(offer.price || 0);
  const commissionFloor = Math.max(Number(group.min_commission || 0) * 1.8, 8);
  const cheapCeiling = Math.min(Number(group.price_max || 100), 100);

  if (sold >= 500) return "campeao";
  if (commission >= commissionFloor) return "comissao";
  if (price > 0 && price <= cheapCeiling) return "achadinho";
  if (offer.freeShipping || offer.free_shipping) return "frete";
  return "oportunidade";
}

function dailyScore(offer, bucket) {
  const base = queuePriority(offer);
  const sold = Number(offer.soldQuantity ?? offer.sold_quantity ?? 0);
  const commission = Number(offer.estimatedCommission ?? offer.estimated_commission ?? 0);
  const shipping = offer.freeShipping || offer.free_shipping ? 4 : 0;
  const bucketBoost = bucket === "campeao" ? 8 : bucket === "comissao" ? 7 : bucket === "achadinho" ? 5 : bucket === "frete" ? 3 : 0;
  const salesBoost = Math.min(Math.log10(Math.max(sold, 1)) * 2.2, 8);
  const commissionBoost = Math.min(commission / 4, 8);
  return Math.round(Math.min(120, base + bucketBoost + salesBoost + commissionBoost + shipping));
}

export function selectDailyMix({ offers, group, queue, slots, now = Date.now() }) {
  const activeKeys = new Set(
    (queue || [])
      .filter((row) => row.group_id === group.id && ["queued", "prepared"].includes(row.status))
      .map(productKey)
  );
  const unique = new Map();

  for (const offer of offers || []) {
    const key = productKey(offer);
    if (!key || key.endsWith(":")) continue;
    if (activeKeys.has(key)) continue;
    if (!offerFitsGroup(offer, group).ok) continue;
    if (isRepeatBlocked(offer, group, queue, now)) continue;
    const bucket = classifyOffer(offer, group);
    const enriched = {
      ...offer,
      dailyBucket: bucket,
      dailyScore: dailyScore(offer, bucket),
      titleSignature: titleSignature(offer.title),
    };
    const previous = unique.get(key);
    if (!previous || enriched.dailyScore > previous.dailyScore) unique.set(key, enriched);
  }

  const buckets = new Map();
  for (const name of ["campeao", "comissao", "achadinho", "frete", "oportunidade"]) buckets.set(name, []);
  for (const offer of unique.values()) buckets.get(offer.dailyBucket)?.push(offer);
  for (const list of buckets.values()) list.sort((a, b) => b.dailyScore - a.dailyScore);

  const order = ["campeao", "comissao", "achadinho", "frete", "oportunidade"];
  const selected = [];
  const signatures = new Map();
  const target = Math.max(0, Number(slots || 0));

  while (selected.length < target) {
    let added = false;
    for (const bucket of order) {
      const list = buckets.get(bucket);
      while (list?.length) {
        const candidate = list.shift();
        const signature = candidate.titleSignature;
        const count = signature ? signatures.get(signature) || 0 : 0;
        if (signature && count >= 2) continue;
        selected.push(candidate);
        if (signature) signatures.set(signature, count + 1);
        added = true;
        break;
      }
      if (selected.length >= target) break;
    }
    if (!added) break;
  }

  return selected.map((offer) => ({
    offer,
    snapshot: {
      ...offerSnapshot(offer, group.message_template),
      metadata: {
        ...offerSnapshot(offer, group.message_template).metadata,
        daily_bucket: offer.dailyBucket,
        daily_score: offer.dailyScore,
        generated_by: "daily_operations_v1",
      },
    },
  }));
}

export function bucketLabel(bucket) {
  if (bucket === "campeao") return "Campeão de vendas";
  if (bucket === "comissao") return "Comissão alta";
  if (bucket === "achadinho") return "Achadinho";
  if (bucket === "frete") return "Frete grátis";
  return "Melhor oportunidade";
}
