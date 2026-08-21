import { DEFAULT_GROUP_TEMPLATE, slugifyGroup } from "@/lib/group-offers";

const MEN_GROUP_TEMPLATE = `🔥 *OFERTA MASCULINA DO DIA*
_oferta por tempo limitado_

*{title}*

{price_line}
{discount}
{shipping}
{coupon}
{sold}
{rating}
{seller}

🛒 *Comprar:*
{link}

⚠️ Preço e disponibilidade podem mudar.`;

export const GROUP_PRESETS = [
  {
    key: "masculino",
    icon: "♂",
    name: "Ofertas para Homens",
    description: "Moda masculina completa: roupas, tênis, relógios, perfumes, acessórios, cuidados pessoais e lifestyle.",
    audience: "Homens adultos interessados em estilo, preço bom, marcas, autocuidado, acessórios e produtos para o dia a dia.",
    keywords: ["moda masculina", "tênis masculino", "perfume masculino", "acessórios masculinos"],
    excludedKeywords: ["feminino", "feminina", "infantil", "menina", "bebê"],
    marketplaces: ["shopee", "mercado-livre"],
    priceMin: 15,
    priceMax: 1500,
    minScore: 55,
    minCommission: 1,
    dailyLimit: 12,
    repeatAfterHours: 72,
    messageTemplate: MEN_GROUP_TEMPLATE,
    recommended: true,
  },
  {
    key: "achadinhos",
    icon: "⚡",
    name: "Achadinhos até R$ 50",
    description: "Produtos baratos, fáceis de comprar por impulso e com boa rotatividade.",
    audience: "Público que gosta de preço baixo, utilidades e compras por impulso.",
    keywords: ["achadinhos", "utilidades", "casa", "cozinha", "acessórios"],
    excludedKeywords: [],
    marketplaces: ["shopee", "mercado-livre"],
    priceMin: null,
    priceMax: 50,
    minScore: 50,
    minCommission: 0,
    dailyLimit: 12,
    repeatAfterHours: 48,
  },
  {
    key: "casa",
    icon: "⌂",
    name: "Casa e Cozinha",
    description: "Organização, cozinha, limpeza, decoração e utilidades domésticas.",
    audience: "Pessoas buscando praticidade para casa e cozinha.",
    keywords: ["cozinha", "organização", "casa", "limpeza", "utilidades domésticas"],
    excludedKeywords: [],
    marketplaces: ["shopee", "mercado-livre"],
    priceMin: null,
    priceMax: 350,
    minScore: 56,
    minCommission: 1,
    dailyLimit: 10,
    repeatAfterHours: 72,
  },
  {
    key: "tech",
    icon: "⌁",
    name: "Tech e Eletrônicos",
    description: "Acessórios, áudio, celulares, smartwatches e eletrônicos populares.",
    audience: "Público interessado em tecnologia e acessórios eletrônicos.",
    keywords: ["fone bluetooth", "smartwatch", "celular", "carregador", "tecnologia"],
    excludedKeywords: ["usado", "recondicionado"],
    marketplaces: ["shopee", "mercado-livre"],
    priceMin: 20,
    priceMax: 1800,
    minScore: 62,
    minCommission: 3,
    dailyLimit: 8,
    repeatAfterHours: 96,
  },
  {
    key: "gamer",
    icon: "◆",
    name: "Gamer e Setup",
    description: "Periféricos, acessórios e itens para PC, console e setup.",
    audience: "Gamers e pessoas montando ou melhorando o setup.",
    keywords: ["gamer", "mouse gamer", "teclado gamer", "headset gamer", "controle"],
    excludedKeywords: ["usado"],
    marketplaces: ["shopee", "mercado-livre"],
    priceMin: 25,
    priceMax: 1000,
    minScore: 60,
    minCommission: 2,
    dailyLimit: 8,
    repeatAfterHours: 96,
  },
  {
    key: "ferramentas",
    icon: "✦",
    name: "Ferramentas e Oficina",
    description: "Ferramentas elétricas, manuais, kits e itens para oficina.",
    audience: "Profissionais, oficinas e pessoas que gostam de ferramentas.",
    keywords: ["parafusadeira", "furadeira", "ferramentas", "chave de impacto", "kit ferramentas"],
    excludedKeywords: [],
    marketplaces: ["shopee", "mercado-livre"],
    priceMin: 20,
    priceMax: 1800,
    minScore: 58,
    minCommission: 2,
    dailyLimit: 8,
    repeatAfterHours: 96,
  },
  {
    key: "beleza",
    icon: "✧",
    name: "Beleza e Autocuidado",
    description: "Perfumes, cuidados pessoais, cabelo, pele e acessórios de beleza.",
    audience: "Público interessado em beleza, presentes e autocuidado.",
    keywords: ["perfume", "cabelo", "skincare", "maquiagem", "beleza"],
    excludedKeywords: [],
    marketplaces: ["shopee", "mercado-livre"],
    priceMin: 10,
    priceMax: 600,
    minScore: 58,
    minCommission: 2,
    dailyLimit: 9,
    repeatAfterHours: 72,
  },
  {
    key: "premium",
    icon: "★",
    name: "Ofertas Premium",
    description: "Produtos com ticket maior, score forte e comissão relevante.",
    audience: "Público que valoriza marcas, qualidade e oportunidades de maior ticket.",
    keywords: ["smart tv", "notebook", "iphone", "eletrodomésticos", "ferramentas profissionais"],
    excludedKeywords: ["usado", "recondicionado"],
    marketplaces: ["shopee", "mercado-livre"],
    priceMin: 250,
    priceMax: 5000,
    minScore: 68,
    minCommission: 10,
    dailyLimit: 5,
    repeatAfterHours: 120,
  },
];

export function presetPayload(preset, userId) {
  return {
    user_id: userId,
    name: preset.name,
    slug: slugifyGroup(preset.name),
    description: preset.description,
    audience: preset.audience,
    keywords: preset.keywords,
    excluded_keywords: preset.excludedKeywords,
    allowed_marketplaces: preset.marketplaces,
    price_min: preset.priceMin,
    price_max: preset.priceMax,
    min_score: preset.minScore,
    min_commission: preset.minCommission,
    daily_limit: preset.dailyLimit,
    repeat_after_hours: preset.repeatAfterHours,
    message_template: preset.messageTemplate || DEFAULT_GROUP_TEMPLATE,
    active: true,
    updated_at: new Date().toISOString(),
  };
}
