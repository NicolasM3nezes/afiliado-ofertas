"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./health.module.css";

function hoursSince(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  return Math.max(0, Date.now() - new Date(value).getTime()) / 3600000;
}

function localDay(value = new Date()) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function severityRank(level) {
  return level === "critical" ? 0 : level === "warning" ? 1 : 2;
}

export default function GroupHealthClient() {
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [groups, setGroups] = useState([]);
  const [queue, setQueue] = useState([]);
  const [shopee, setShopee] = useState(null);
  const [mercado, setMercado] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    setSupabase(client);
    client.auth.getSession().then(({ data }) => {
      if (!data.session) return window.location.replace("/");
      setSession(data.session);
    });
  }, []);

  useEffect(() => {
    if (!supabase || !session) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, session]);

  function headers() {
    return { Authorization: `Bearer ${session?.access_token || ""}` };
  }

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 4200);
  }

  async function refresh() {
    setLoading(true);
    const [groupsResult, queueResult, shopeeResult, mercadoResult] = await Promise.all([
      supabase.from("offer_groups").select("*").order("created_at"),
      supabase.from("offer_group_queue").select("*").order("created_at", { ascending: false }).limit(1000),
      fetch("/api/connections/shopee", { headers: headers(), cache: "no-store" }).then(async (response) => ({ ok: response.ok, data: await response.json() })),
      fetch("/api/connections/mercado-livre", { headers: headers(), cache: "no-store" }).then(async (response) => ({ ok: response.ok, data: await response.json() })),
    ]);

    if (groupsResult.error || queueResult.error) notify(groupsResult.error?.message || queueResult.error?.message);
    setGroups(groupsResult.data || []);
    setQueue(queueResult.data || []);
    setShopee(shopeeResult.ok ? shopeeResult.data : { connected: false, connection: null, error: shopeeResult.data?.error });
    setMercado(mercadoResult.ok ? mercadoResult.data : { connected: false, configured: false, error: mercadoResult.data?.error });
    setLoading(false);
  }

  const issues = useMemo(() => {
    const list = [];
    const shopeeConnected = Boolean(shopee?.connected);
    const mercadoConnected = Boolean(mercado?.connected);

    if (!shopeeConnected && !mercadoConnected) {
      list.push({ level: "critical", title: "Nenhuma plataforma está pronta para buscar", detail: "Conecte a Shopee ou autorize o Mercado Livre para o radar e a Operação do Dia voltarem a funcionar.", href: "/", action: "Abrir Conexões" });
    } else {
      if (!shopeeConnected) {
        list.push({ level: "warning", title: "Shopee está fora do radar", detail: shopee?.connection?.last_error || shopee?.error || "A operação continua com as outras plataformas, mas você está perdendo resultados da Shopee.", href: "/", action: "Revisar Shopee" });
      }
      if (!mercadoConnected) {
        list.push({ level: "warning", title: "Mercado Livre está fora do radar", detail: mercado?.error || "A operação continua com as outras plataformas, mas o Mercado Livre precisa ser autorizado novamente.", href: "/", action: "Revisar Mercado Livre" });
      }
    }

    if (mercadoConnected && !mercado?.affiliateConfigured) {
      list.push({ level: "warning", title: "Mercado Livre sem rastreamento de afiliado", detail: "A busca funciona, mas os links podem sair sem o rastreamento da sua conta de afiliado.", href: "/", action: "Configurar afiliado" });
    }

    if (!groups.length) {
      list.push({ level: "critical", title: "Nenhum grupo criado", detail: "Crie grupos para o sistema conseguir montar filas e recomendações diárias.", href: "/groups/setup", action: "Configuração rápida" });
    }

    for (const group of groups.filter((item) => item.active)) {
      const rows = queue.filter((item) => item.group_id === group.id);
      const active = rows.filter((item) => ["queued", "prepared"].includes(item.status));
      const publishedToday = rows.filter((item) => item.status === "published" && item.published_at && localDay(item.published_at) === localDay()).length;
      const failed = active.filter((item) => ["failed", "unavailable"].includes(item.validation_status));
      const stale = active.filter((item) => item.last_validated_at && hoursSince(item.last_validated_at) > 6);
      const old = active.filter((item) => hoursSince(item.created_at) > 96);

      if (!(group.keywords || []).length) {
        list.push({ level: "warning", title: `${group.name} está sem palavras-chave`, detail: "A Operação do Dia vai depender apenas do nome do grupo e encontrará menos variedade.", href: "/groups", action: "Editar grupo" });
      }
      if (failed.length) {
        list.push({ level: "warning", title: `${group.name}: ${failed.length} oferta(s) com falha`, detail: "Essas ofertas não foram confirmadas na última validação e devem ser revisadas antes da publicação.", href: "/groups/today", action: "Abrir operação" });
      }
      if (stale.length) {
        list.push({ level: "warning", title: `${group.name}: ${stale.length} validação(ões) vencida(s)`, detail: "Validações com mais de 6 horas precisam ser refeitas antes de registrar uma publicação.", href: "/groups/today", action: "Revalidar" });
      }
      if (old.length) {
        list.push({ level: "info", title: `${group.name}: ${old.length} item(ns) parados há mais de 4 dias`, detail: "Vale publicar, ignorar ou substituir para não deixar a fila acumulando produtos antigos.", href: "/groups", action: "Revisar fila" });
      }
      const planned = active.length + publishedToday;
      if (planned < Number(group.daily_limit || 0)) {
        list.push({ level: "info", title: `${group.name} ainda tem ${Number(group.daily_limit || 0) - planned} vaga(s) hoje`, detail: "A fila pode ser completada automaticamente sem ultrapassar o limite diário.", href: "/groups/today", action: "Completar fila" });
      }
    }

    return list.sort((a, b) => severityRank(a.level) - severityRank(b.level));
  }, [groups, queue, shopee, mercado]);

  const counts = {
    critical: issues.filter((item) => item.level === "critical").length,
    warning: issues.filter((item) => item.level === "warning").length,
    info: issues.filter((item) => item.level === "info").length,
  };

  if (!session || loading) return <main className={styles.loading}>Verificando sua operação...</main>;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><span>Central de Problemas</span><h1>Veja o que precisa de atenção.</h1><p>Conexões, rastreamento, filas, validações e grupos são checados em um só lugar.</p></div>
        <nav><a href="/groups/today">Operação do Dia</a><a href="/groups">Grupos</a><button onClick={refresh}>Reverificar agora</button></nav>
      </header>

      <section className={styles.summary}>
        <article className={styles.critical}><span>Críticos</span><strong>{counts.critical}</strong><small>Podem bloquear a operação</small></article>
        <article className={styles.warning}><span>Atenção</span><strong>{counts.warning}</strong><small>Vale corrigir antes de publicar</small></article>
        <article><span>Oportunidades</span><strong>{counts.info}</strong><small>Ajustes para manter a operação cheia</small></article>
        <article><span>Status geral</span><strong>{counts.critical ? "Ação necessária" : counts.warning ? "Operando com alertas" : "Tudo certo"}</strong><small>{issues.length ? `${issues.length} ponto(s) encontrados` : "Nenhum problema detectado"}</small></article>
      </section>

      <section className={styles.connectionRow}>
        <div><span className={shopeeConnectedClass(shopee)} /><strong>Shopee</strong><small>{shopee?.connected ? "Conectada e pronta" : "Fora do radar"}</small></div>
        <div><span className={mercadoConnectedClass(mercado)} /><strong>Mercado Livre</strong><small>{mercado?.connected ? (mercado?.affiliateConfigured ? "OAuth + afiliado prontos" : "OAuth pronto · afiliado pendente") : "Fora do radar"}</small></div>
        <div><span className={groups.length ? styles.dotOk : styles.dotBad} /><strong>Grupos</strong><small>{groups.length} configurado(s)</small></div>
      </section>

      <section className={styles.issueList}>
        {issues.map((issue, index) => (
          <article key={`${issue.title}:${index}`} className={`${styles.issue} ${styles[issue.level]}`}>
            <div className={styles.issueIcon}>{issue.level === "critical" ? "!" : issue.level === "warning" ? "⚠" : "i"}</div>
            <div><span>{issue.level === "critical" ? "Crítico" : issue.level === "warning" ? "Atenção" : "Melhoria"}</span><h2>{issue.title}</h2><p>{issue.detail}</p></div>
            <a href={issue.href}>{issue.action}</a>
          </article>
        ))}
        {!issues.length && <div className={styles.allGood}><span>✓</span><h2>Nenhum problema detectado.</h2><p>Conexões e operação estão em ordem. Você pode ir direto para a fila do dia.</p><a href="/groups/today">Abrir Operação do Dia</a></div>}
      </section>

      {toast && <div className={styles.toast}>{toast}</div>}
    </main>
  );
}

function shopeeConnectedClass(shopee) {
  return shopee?.connected ? styles.dotOk : styles.dotBad;
}

function mercadoConnectedClass(mercado) {
  return mercado?.connected ? styles.dotOk : styles.dotBad;
}
