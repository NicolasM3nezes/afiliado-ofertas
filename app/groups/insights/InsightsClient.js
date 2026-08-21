"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { formatMoney } from "@/lib/group-offers";
import styles from "./insights.module.css";

function marketplaceName(slug) {
  return slug === "mercado-livre" ? "Mercado Livre" : slug === "shopee" ? "Shopee" : "Amazon";
}

function priceBand(value) {
  const price = Number(value || 0);
  if (price <= 50) return "Até R$ 50";
  if (price <= 100) return "R$ 50–100";
  if (price <= 250) return "R$ 100–250";
  if (price <= 500) return "R$ 250–500";
  return "Acima de R$ 500";
}

function pct(a, b) {
  if (!b) return 0;
  return Math.round((a / b) * 1000) / 10;
}

export default function InsightsClient() {
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [groups, setGroups] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    setSupabase(client);
    client.auth.getSession().then(async ({ data }) => {
      if (!data.session) return window.location.replace("/");
      setSession(data.session);
      const [groupResult, queueResult] = await Promise.all([
        client.from("offer_groups").select("id,name,active"),
        client.from("offer_group_queue").select("*").eq("status", "published").order("published_at", { ascending: false }).limit(1500),
      ]);
      setGroups(groupResult.data || []);
      setRows(queueResult.data || []);
      setLoading(false);
    });
  }, []);

  const groupMap = useMemo(() => new Map(groups.map((group) => [group.id, group.name])), [groups]);
  const totals = useMemo(() => ({
    publications: rows.length,
    clicks: rows.reduce((sum, row) => sum + Number(row.clicks || 0), 0),
    conversions: rows.reduce((sum, row) => sum + Number(row.conversions || 0), 0),
    actualCommission: rows.reduce((sum, row) => sum + Number(row.actual_commission || 0), 0),
    estimatedCommission: rows.reduce((sum, row) => sum + Number(row.estimated_commission || 0), 0),
  }), [rows]);

  const groupStats = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.group_id)) map.set(row.group_id, { groupId: row.group_id, name: groupMap.get(row.group_id) || "Grupo removido", posts: 0, clicks: 0, conversions: 0, commission: 0 });
      const item = map.get(row.group_id);
      item.posts += 1;
      item.clicks += Number(row.clicks || 0);
      item.conversions += Number(row.conversions || 0);
      item.commission += Number(row.actual_commission || 0);
    }
    return [...map.values()].map((item) => ({ ...item, conversionRate: pct(item.conversions, item.clicks) })).sort((a, b) => b.commission - a.commission || b.conversions - a.conversions);
  }, [rows, groupMap]);

  const marketplaceStats = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const key = row.marketplace_slug;
      if (!map.has(key)) map.set(key, { slug: key, posts: 0, clicks: 0, conversions: 0, commission: 0, estimate: 0 });
      const item = map.get(key);
      item.posts += 1;
      item.clicks += Number(row.clicks || 0);
      item.conversions += Number(row.conversions || 0);
      item.commission += Number(row.actual_commission || 0);
      item.estimate += Number(row.estimated_commission || 0);
    }
    return [...map.values()].map((item) => ({ ...item, conversionRate: pct(item.conversions, item.clicks) })).sort((a, b) => b.commission - a.commission || b.conversions - a.conversions);
  }, [rows]);

  const bandStats = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const key = priceBand(row.price);
      if (!map.has(key)) map.set(key, { band: key, posts: 0, clicks: 0, conversions: 0, commission: 0 });
      const item = map.get(key);
      item.posts += 1;
      item.clicks += Number(row.clicks || 0);
      item.conversions += Number(row.conversions || 0);
      item.commission += Number(row.actual_commission || 0);
    }
    return [...map.values()].map((item) => ({ ...item, conversionRate: pct(item.conversions, item.clicks) })).sort((a, b) => b.conversions - a.conversions || b.commission - a.commission);
  }, [rows]);

  const topProducts = useMemo(() => [...rows].sort((a, b) => Number(b.actual_commission || 0) - Number(a.actual_commission || 0) || Number(b.conversions || 0) - Number(a.conversions || 0)).slice(0, 10), [rows]);
  const bestGroup = groupStats[0];
  const bestMarketplace = marketplaceStats[0];
  const bestBand = bandStats[0];

  if (!session || loading) return <main className={styles.loading}>Calculando insights...</main>;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}><a href="/groups">← Central de Grupos</a><strong>Insights de desempenho</strong><a href="/groups/radar">Radar do Grupo</a></header>
      <section className={styles.workspace}>
        <div className={styles.header}><span>APRENDIZADO DA OPERAÇÃO</span><h1>Descubra o que funciona nos seus grupos</h1><p>Os insights usam os cliques, vendas e comissões que você registra nas publicações. Quanto mais dados, mais útil fica.</p></div>

        <section className={styles.metrics}>
          <div><span>Publicações</span><strong>{totals.publications}</strong><small>Registradas na central</small></div>
          <div><span>Cliques</span><strong>{totals.clicks}</strong><small>Preenchimento manual</small></div>
          <div><span>Vendas</span><strong>{totals.conversions}</strong><small>Conversão {pct(totals.conversions, totals.clicks)}%</small></div>
          <div><span>Comissão real</span><strong>{formatMoney(totals.actualCommission)}</strong><small>Estimativa: {formatMoney(totals.estimatedCommission)}</small></div>
        </section>

        {!rows.length ? <div className={styles.empty}>Ainda não há publicações registradas. Marque ofertas como publicadas na Central de Grupos e comece a preencher os resultados.</div> : (
          <>
            <section className={styles.insightCards}>
              <article><span>🏆 MELHOR GRUPO</span><h2>{bestGroup?.name || "—"}</h2><p>{bestGroup?.posts || 0} publicações · {bestGroup?.conversions || 0} vendas · {formatMoney(bestGroup?.commission || 0)}</p></article>
              <article><span>🛒 MELHOR PLATAFORMA</span><h2>{bestMarketplace ? marketplaceName(bestMarketplace.slug) : "—"}</h2><p>{bestMarketplace?.conversionRate || 0}% conversão · {formatMoney(bestMarketplace?.commission || 0)}</p></article>
              <article><span>💰 FAIXA DE PREÇO FORTE</span><h2>{bestBand?.band || "—"}</h2><p>{bestBand?.conversions || 0} vendas · {bestBand?.conversionRate || 0}% conversão</p></article>
            </section>

            <section className={styles.grid2}>
              <article className={styles.panel}><div className={styles.panelHead}><span>GRUPOS</span><h2>Ranking por resultado</h2></div><div className={styles.table}>{groupStats.map((item, index) => <div className={styles.row} key={item.groupId}><b>{index + 1}</b><div><strong>{item.name}</strong><small>{item.posts} posts · {item.clicks} cliques · {item.conversions} vendas</small></div><span>{item.conversionRate}%</span><em>{formatMoney(item.commission)}</em></div>)}</div></article>
              <article className={styles.panel}><div className={styles.panelHead}><span>PLATAFORMAS</span><h2>Shopee x Mercado Livre</h2></div><div className={styles.table}>{marketplaceStats.map((item) => <div className={styles.row} key={item.slug}><b>{marketplaceName(item.slug).slice(0, 2)}</b><div><strong>{marketplaceName(item.slug)}</strong><small>{item.posts} posts · {item.clicks} cliques · {item.conversions} vendas</small></div><span>{item.conversionRate}%</span><em>{formatMoney(item.commission)}</em></div>)}</div></article>
            </section>

            <section className={styles.grid2}>
              <article className={styles.panel}><div className={styles.panelHead}><span>FAIXA DE PREÇO</span><h2>Onde o público converte</h2></div><div className={styles.table}>{bandStats.map((item) => <div className={styles.row} key={item.band}><b>R$</b><div><strong>{item.band}</strong><small>{item.posts} posts · {item.clicks} cliques · {item.conversions} vendas</small></div><span>{item.conversionRate}%</span><em>{formatMoney(item.commission)}</em></div>)}</div></article>
              <article className={styles.panel}><div className={styles.panelHead}><span>PRODUTOS CAMPEÕES</span><h2>Mais retorno registrado</h2></div><div className={styles.table}>{topProducts.map((item, index) => <div className={styles.row} key={item.id}><b>{index + 1}</b><div><strong>{item.title}</strong><small>{groupMap.get(item.group_id) || "Grupo"} · {marketplaceName(item.marketplace_slug)}</small></div><span>{item.conversions} venda(s)</span><em>{formatMoney(item.actual_commission)}</em></div>)}</div></article>
            </section>
          </>
        )}
      </section>
    </main>
  );
}