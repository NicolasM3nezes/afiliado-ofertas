"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { formatMoney, offerSnapshot } from "@/lib/group-offers";
import styles from "./radar.module.css";

function marketplaceName(slug) {
  return slug === "mercado-livre" ? "Mercado Livre" : slug === "shopee" ? "Shopee" : "Amazon";
}

function localDay() {
  return new Date().toISOString().slice(0, 10);
}

function hoursSince(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(value).getTime()) / 3600000;
}

export default function GroupRadarClient() {
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [mode, setMode] = useState("best");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState("");
  const [toast, setToast] = useState("");
  const [favoriteList, setFavoriteList] = useState("Favoritos");

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    setSupabase(client);
    client.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        window.location.replace("/");
        return;
      }
      setSession(data.session);
      const { data: groupRows } = await client.from("offer_groups").select("*").eq("active", true).order("created_at", { ascending: true });
      setGroups(groupRows || []);
      if (groupRows?.[0]) setSelectedGroupId(groupRows[0].id);
    });
  }, []);

  const selectedGroup = useMemo(() => groups.find((item) => item.id === selectedGroupId) || null, [groups, selectedGroupId]);

  function apiHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    };
  }

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 4000);
  }

  function groupConstraint(offer) {
    const group = selectedGroup;
    if (!group) return "Crie ou selecione um grupo.";
    if (!group.allowed_marketplaces?.includes(offer.marketplaceSlug)) return `${marketplaceName(offer.marketplaceSlug)} não está permitida neste grupo.`;
    if (group.price_min != null && Number(offer.price) < Number(group.price_min)) return `Abaixo do preço mínimo de ${formatMoney(group.price_min)}.`;
    if (group.price_max != null && Number(offer.price) > Number(group.price_max)) return `Acima do preço máximo de ${formatMoney(group.price_max)}.`;
    if (Number(offer.score || 0) < Number(group.min_score || 0)) return `Score abaixo do mínimo ${group.min_score}.`;
    if (Number(offer.estimatedCommission || 0) < Number(group.min_commission || 0)) return `Comissão abaixo do mínimo ${formatMoney(group.min_commission)}.`;
    const title = String(offer.title || "").toLowerCase();
    if ((group.excluded_keywords || []).some((keyword) => title.includes(String(keyword).toLowerCase()))) return "Contém uma palavra excluída pelo grupo.";
    return "";
  }

  const groupQualified = useMemo(() => results.filter((offer) => !groupConstraint(offer)), [results, selectedGroup]);

  const visibleResults = useMemo(() => {
    let rows = [...groupQualified];
    if (mode === "commission") rows.sort((a, b) => Number(b.estimatedCommission || 0) - Number(a.estimatedCommission || 0));
    else if (mode === "cheap") rows = rows.filter((item) => Number(item.price || 0) <= 100).sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    else if (mode === "sales") rows.sort((a, b) => Number(b.soldQuantity || 0) - Number(a.soldQuantity || 0));
    else if (mode === "shipping") rows = rows.filter((item) => item.freeShipping).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    else rows.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    return rows.slice(0, 80);
  }, [groupQualified, mode]);

  const bestByPlatform = useMemo(() => {
    const best = {};
    for (const offer of visibleResults) {
      if (!best[offer.marketplaceSlug]) best[offer.marketplaceSlug] = offer;
    }
    return best;
  }, [visibleResults]);

  async function search() {
    if (!selectedGroup) return notify("Crie um grupo antes de usar o Radar do Grupo.");
    if (query.trim().length < 2) return notify("Digite pelo menos 2 caracteres.");
    setLoading(true);
    setWarning("");
    setResults([]);
    try {
      const params = new URLSearchParams({ query: query.trim(), platform });
      const response = await fetch(`/api/search/general?${params}`, { headers: apiHeaders(), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha na busca.");
      setResults(data.offers || []);
      setWarning(data.warning || "");
      if (!(data.offers || []).length) setWarning(data.warning || "Nenhum produto encontrado.");
    } catch (error) {
      setWarning(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function recordPrice(offer) {
    await supabase.from("offer_price_history").upsert({
      user_id: session.user.id,
      marketplace_slug: offer.marketplaceSlug,
      external_id: String(offer.externalId),
      title: offer.title,
      price: Number(offer.price || 0),
      original_price: Number(offer.originalPrice || 0) || null,
      score: Number(offer.score || 0),
      captured_on: localDay(),
      captured_at: new Date().toISOString(),
    }, { onConflict: "user_id,marketplace_slug,external_id,captured_on" });
  }

  async function addFavorite(offer) {
    const { error } = await supabase.from("favorite_offers").upsert({
      user_id: session.user.id,
      list_name: favoriteList.trim() || "Favoritos",
      marketplace_slug: offer.marketplaceSlug,
      external_id: String(offer.externalId),
      title: offer.title,
      permalink: offer.permalink || null,
      affiliate_url: offer.affiliateUrl || offer.permalink || null,
      thumbnail_url: offer.thumbnailUrl || null,
      seller_name: offer.sellerName || null,
      price: Number(offer.price || 0),
      original_price: Number(offer.originalPrice || 0) || null,
      discount_percent: Number(offer.discountPercent || 0),
      score: Number(offer.score || 0),
      estimated_commission: Number(offer.estimatedCommission || 0),
      commission_rate: Number(offer.commissionRate || 0),
      rating: Number(offer.rating || 0) || null,
      sold_quantity: Number(offer.soldQuantity || 0),
      free_shipping: Boolean(offer.freeShipping),
      metadata: { quality_label: offer.qualityLabel || null },
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,list_name,marketplace_slug,external_id" });
    if (error) return notify(error.message);
    await recordPrice(offer);
    notify(`Salvo em ${favoriteList.trim() || "Favoritos"}.`);
  }

  async function addQueue(offer) {
    const reason = groupConstraint(offer);
    if (reason) return notify(reason);

    const snapshot = offerSnapshot(offer, selectedGroup.message_template || "");
    const { data: previous } = await supabase
      .from("offer_group_queue")
      .select("published_at")
      .eq("group_id", selectedGroup.id)
      .eq("marketplace_slug", snapshot.marketplace_slug)
      .eq("external_id", snapshot.external_id)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (previous?.published_at) {
      const elapsed = hoursSince(previous.published_at);
      const wait = Number(selectedGroup.repeat_after_hours || 72);
      if (elapsed < wait) return notify(`Anti-repetição: esse produto poderá voltar em ${Math.ceil(wait - elapsed)}h.`);
    }

    const { error } = await supabase.from("offer_group_queue").insert({
      ...snapshot,
      user_id: session.user.id,
      group_id: selectedGroup.id,
      status: "queued",
    });
    if (error) return notify(error.code === "23505" ? "Esse produto já está na fila desse grupo." : error.message);
    await recordPrice(offer);
    notify(`Enviado para a fila de ${selectedGroup.name}.`);
  }

  if (!session) return <main className={styles.loading}>Carregando Radar do Grupo...</main>;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a href="/groups">← Central de Grupos</a>
        <strong>Radar do Grupo</strong>
        <a href="/">Painel principal</a>
      </header>

      <section className={styles.workspace}>
        <div className={styles.hero}>
          <div><span>BUSCA COM ESTRATÉGIA</span><h1>Encontre ofertas para um grupo específico</h1><p>O radar aplica preço, score, comissão, palavras excluídas e marketplaces permitidos antes de recomendar.</p></div>
          {selectedGroup && <div className={styles.groupBadge}><small>Grupo selecionado</small><strong>{selectedGroup.name}</strong><span>Score ≥ {selectedGroup.min_score} · {selectedGroup.daily_limit}/dia</span></div>}
        </div>

        {!groups.length ? <div className={styles.empty}>Você ainda não criou um grupo. <a href="/groups">Criar primeiro grupo</a></div> : (
          <>
            <section className={styles.searchCard}>
              <div className={styles.searchGrid}>
                <label>Grupo<select value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
                <label className={styles.query}>Palavra-chave<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex.: air fryer, ferramentas, fone bluetooth" onKeyDown={(event) => event.key === "Enter" && search()} /></label>
                <label>Plataforma<select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="all">Todas</option><option value="shopee">Shopee</option><option value="mercado-livre">Mercado Livre</option></select></label>
                <button onClick={search} disabled={loading}>{loading ? "Buscando..." : "Buscar ofertas"}</button>
              </div>
              <div className={styles.rules}>{selectedGroup && <><span>Preço: {selectedGroup.price_min != null ? formatMoney(selectedGroup.price_min) : "livre"} – {selectedGroup.price_max != null ? formatMoney(selectedGroup.price_max) : "livre"}</span><span>Comissão mínima: {formatMoney(selectedGroup.min_commission)}</span><span>Anti-repetição: {selectedGroup.repeat_after_hours}h</span><span>{(selectedGroup.allowed_marketplaces || []).map(marketplaceName).join(" + ")}</span></>}</div>
            </section>

            {warning && <div className={styles.warning}>{warning}</div>}

            {!!results.length && <section className={styles.summary}>
              <div><span>Encontrados</span><strong>{results.length}</strong></div><div><span>Aprovados pelo grupo</span><strong>{groupQualified.length}</strong></div><div><span>Bloqueados pelas regras</span><strong>{results.length - groupQualified.length}</strong></div>
              {bestByPlatform.shopee && <div><span>Melhor Shopee</span><strong>{bestByPlatform.shopee.score}/100</strong></div>}
              {bestByPlatform["mercado-livre"] && <div><span>Melhor Meli</span><strong>{bestByPlatform["mercado-livre"].score}/100</strong></div>}
            </section>}

            <section className={styles.toolbar}>
              <div><button className={mode === "best" ? styles.active : ""} onClick={() => setMode("best")}>Melhores</button><button className={mode === "commission" ? styles.active : ""} onClick={() => setMode("commission")}>Maior comissão</button><button className={mode === "cheap" ? styles.active : ""} onClick={() => setMode("cheap")}>Achadinhos ≤ R$100</button><button className={mode === "sales" ? styles.active : ""} onClick={() => setMode("sales")}>Mais vendidos</button><button className={mode === "shipping" ? styles.active : ""} onClick={() => setMode("shipping")}>Frete grátis</button></div>
              <label>Lista de favoritos<input value={favoriteList} onChange={(event) => setFavoriteList(event.target.value)} /></label>
            </section>

            <section className={styles.grid}>
              {visibleResults.map((offer, index) => (
                <article key={`${offer.marketplaceSlug}:${offer.externalId}`} className={styles.card}>
                  <div className={styles.image}>{offer.thumbnailUrl ? <img src={offer.thumbnailUrl} alt="" /> : <b>{marketplaceName(offer.marketplaceSlug).slice(0, 2)}</b>}<span>{marketplaceName(offer.marketplaceSlug)}</span><em>{offer.score}/100</em>{index === 0 && <i>TOP DO GRUPO</i>}</div>
                  <div className={styles.body}>
                    <div className={styles.pills}>{offer.discountPercent > 0 && <span>-{Math.round(offer.discountPercent)}%</span>}{offer.freeShipping && <span>Frete grátis</span>}{Number(offer.estimatedCommission || 0) > 0 && <span>+ {formatMoney(offer.estimatedCommission)}</span>}</div>
                    <h3>{offer.title}</h3><small>{offer.sellerName || marketplaceName(offer.marketplaceSlug)}{offer.rating ? ` · ★ ${Number(offer.rating).toFixed(1)}` : ""}</small>
                    <div className={styles.price}>{formatMoney(offer.price)}{Number(offer.originalPrice) > Number(offer.price) && <del>{formatMoney(offer.originalPrice)}</del>}</div>
                    <div className={styles.stats}><span>{offer.soldQuantity ? `+${Number(offer.soldQuantity).toLocaleString("pt-BR")} vendidos` : "Vendas não informadas"}</span><span>{offer.affiliateUrl ? "Link afiliado ✓" : "Link do produto"}</span></div>
                    <div className={styles.actions}><button onClick={() => addFavorite(offer)}>☆ Favoritar</button><button className={styles.queueButton} onClick={() => addQueue(offer)}>+ Fila do grupo</button></div>
                  </div>
                </article>
              ))}
              {!loading && !!results.length && !visibleResults.length && <div className={styles.empty}>Os produtos encontrados não passaram nas regras desse grupo. Edite o perfil ou tente outra palavra-chave.</div>}
            </section>
          </>
        )}
      </section>
      {toast && <div className={styles.toast}>{toast}</div>}
    </main>
  );
}