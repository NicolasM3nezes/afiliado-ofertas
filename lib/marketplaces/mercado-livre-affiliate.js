const CATEGORY_CACHE_TTL_MS = 30 * 60 * 1000;
const categoryCache = new Map();

const DIRECT_COMMISSION_BY_ROOT = new Map([
  ["beleza e cuidado pessoal", 16],
  ["calcados roupas e bolsas", 16],
  ["esportes e fitness", 16],

  ["acessorios para veiculos", 8],
  ["bebes", 8],
  ["brinquedos e hobbies", 8],
  ["casa moveis e decoracao", 8],
  ["construcao", 8],
  ["ferramentas", 8],
  ["games", 8],
  ["joias e relogios", 8],
  ["livros revistas e comics", 8],
  ["mais categorias", 8],

  ["cameras e acessorios", 4],
  ["celulares e telefones", 4],
  ["eletrodomesticos", 4],
  ["eletronicos audio e video", 4],
  ["informatica", 4],

  ["alimentos e bebidas", 0],
]);

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseTracking(tracking) {
  const mattWord = String(tracking?.matt_word || "").trim();
  const mattTool = String(tracking?.matt_tool || "").trim();
  return { mattWord, mattTool, configured: Boolean(mattWord) };
}

export function buildTrackedMercadoLivreUrl(productUrl, tracking) {
  const { mattWord, mattTool, configured } = parseTracking(tracking);
  if (!configured || !productUrl) return null;

  try {
    const url = new URL(productUrl);
    url.searchParams.set("matt_word", mattWord);
    if (mattTool) url.searchParams.set("matt_tool", mattTool);
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchCategoryInfo(categoryId, accessToken) {
  if (!categoryId) return null;

  const cached = categoryCache.get(categoryId);
  if (cached && Date.now() - cached.cachedAt < CATEGORY_CACHE_TTL_MS) {
    return cached.value;
  }

  const response = await fetch(
    `https://api.mercadolibre.com/categories/${encodeURIComponent(categoryId)}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  if (!data) return null;

  const path = Array.isArray(data.path_from_root) ? data.path_from_root : [];
  const root = path[0] || { id: data.id, name: data.name };
  const value = {
    categoryId: data.id || categoryId,
    categoryName: data.name || null,
    rootCategoryId: root?.id || null,
    rootCategoryName: root?.name || data.name || null,
  };

  categoryCache.set(categoryId, { cachedAt: Date.now(), value });
  return value;
}

function commissionRateForCategory(categoryInfo) {
  const key = normalizeText(categoryInfo?.rootCategoryName);
  if (!key) return null;
  if (DIRECT_COMMISSION_BY_ROOT.has(key)) return DIRECT_COMMISSION_BY_ROOT.get(key);

  // Pequenas variações de nomenclatura do catálogo.
  for (const [name, rate] of DIRECT_COMMISSION_BY_ROOT.entries()) {
    if (key.includes(name) || name.includes(key)) return rate;
  }
  return null;
}

function isGreenReputation(offer) {
  const reputation = String(
    offer?.raw?.listing?.seller?.reputation_level_id
      || offer?.raw?.listing?.seller?.reputation?.level_id
      || ""
  ).toLowerCase();

  if (!reputation) return true;
  return reputation.includes("green");
}

function isNewProduct(offer) {
  const condition = String(offer?.raw?.listing?.condition || "new").toLowerCase();
  return condition === "new";
}

async function enrichOneOffer(offer, accessToken, tracking) {
  const categoryInfo = await fetchCategoryInfo(offer.categoryExternalId, accessToken);
  const referenceRate = commissionRateForCategory(categoryInfo);
  const eligibleByProduct = isNewProduct(offer) && isGreenReputation(offer);
  const affiliateEligible = eligibleByProduct && Number(referenceRate || 0) > 0;
  const commissionRate = affiliateEligible ? Number(referenceRate || 0) : 0;
  const estimatedCommission = commissionRate > 0
    ? Number(((Number(offer.price || 0) * commissionRate) / 100).toFixed(2))
    : 0;
  const affiliateUrl = buildTrackedMercadoLivreUrl(offer.permalink, tracking);

  return {
    ...offer,
    affiliateUrl,
    affiliateLinkConfigured: Boolean(affiliateUrl),
    affiliateEligible,
    commissionRate,
    estimatedCommission,
    commissionEstimateType: commissionRate > 0 ? "direct_category_reference" : null,
    commissionCategory: categoryInfo?.rootCategoryName || null,
    commissionNote: commissionRate > 0
      ? "Estimativa de venda direta por categoria. O valor real depende da validação da venda e das regras vigentes do programa."
      : "Categoria ou anúncio sem estimativa de comissão disponível.",
    raw: {
      ...(offer.raw || {}),
      affiliate: {
        ...(offer.raw?.affiliate || {}),
        eligible: affiliateEligible,
        reference_rate: commissionRate,
        root_category_id: categoryInfo?.rootCategoryId || null,
        root_category_name: categoryInfo?.rootCategoryName || null,
        tracked_url_configured: Boolean(affiliateUrl),
      },
    },
  };
}

export async function enrichMercadoLivreAffiliateOffers({
  offers,
  accessToken,
  tracking,
}) {
  const list = Array.isArray(offers) ? offers : [];
  const output = [];

  for (let index = 0; index < list.length; index += 6) {
    const batch = list.slice(index, index + 6);
    const settled = await Promise.allSettled(
      batch.map((offer) => enrichOneOffer(offer, accessToken, tracking))
    );

    for (let itemIndex = 0; itemIndex < settled.length; itemIndex += 1) {
      const result = settled[itemIndex];
      output.push(result.status === "fulfilled" ? result.value : batch[itemIndex]);
    }
  }

  return output;
}
