"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { formatMoney, offerSnapshot, renderGroupMessage } from "@/lib/group-offers";
import {
  bucketLabel,
  isRepeatBlocked,
  offerFitsGroup,
  productKey,
  selectDailyMix,
} from "@/lib/daily-operations";
import styles from "./today.module.css";

const VALIDATION_HOURS = 6;

function localDay(value = new Date()) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function hoursSince(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  return Math.max(0, Date.now() - new Date(value).getTime()) / 3600000;
}

function marketplaceName(slug) {
  return slug === "mercado-livre" ? "Mercado Livre" : slug === "shopee" ? "Shopee" : "Amazon";
}

function validationLabel(status) {
  if (status === "valid") return "Validada";
  if (status === "changed") return "Preço atualizado";
  if (status === "failed") return "Precisa tentar novamente";
  if (status === "unavailable") return "Indisponível";
  return "Ainda não validada";
}

function compactTitle(value) {
  const title = String(value || "").trim();
  return title.length > 88 ? `${title.slice(0, 85)}...` : title;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  }
}

export default function DailyOperationsClient() {
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [groups, setGroups] = useState([]);
  const [queue, setQueue] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [candidateOffers, setCandidateOffers] = useState([]);
  const [candidateGroupId, setCandidateGroupId] = useState("");
  const [selectedQueueId, setSelectedQueueId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [toast, setToast] = useState("");
  const [lastScan, setLastScan] = useState(null);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    setSupabase(client);
    client.auth.getSession().then(({ data }) => {
      if (!data.session) {
        window.location.replace("/");
        return;
      }
      setSession(data.session);
    });
  }, []);

  useEffect(() => {
    if (!supabase || !session) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, session]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) || groups[0] || null,
    [groups, selectedGroupId]
  );

  useEffect(() => {
    if (!selectedGroupId && groups[0]) setSelectedGroupId(groups[0].id);
  }, [groups, selectedGroupId]);

  const groupQueue = useMemo(
    () => queue.filter((item) => selectedGroup && item.group_id === selectedGroup.id),
    [queue, selectedGroup]
  );

  const publishedToday = useMemo(() => {
    const today = localDay();
    return groupQueue.filter((item) => item.status === "published" && item.published_at && localDay(item.published_at) === today).length;
  }, [groupQueue]);

  const activeQueue = useMemo(
    () => groupQueue.filter((item) => ["queued", "prepared"].includes(item.status)),
    [groupQueue]
  );

  const remainingSlots = Math.max(
    0,
    Number(selectedGroup?.daily_limit || 0) - publishedToday - activeQueue.length
  );

  const recommendations = useMemo(() => {
    const now = Date.now();
    return activeQueue
      .filter((item) => !item.scheduled_for || new Date(item.scheduled_for).getTime() <= now)
      .map((item) => {
        const validationBoost = item.validation_status === "valid" ? 12 : item.validation_status === "changed" ? 9 : 0;
        const commissionBoost = Math.min(Number(item.estimated_commission || 0) / 3, 12);
        const dailyScore = Number(item.metadata?.daily_score || item.priority || 0);
        const stalePenalty = hoursSince(item.created_at) > 72 ? 8 : 0;
        const blockedPenalty = selectedGroup && isRepeatBlocked(item, selectedGroup, queue) ? 50 : 0;
        return {
          ...item,
          operationScore: Math.round(dailyScore + validationBoost + commissionBoost - stalePenalty - blockedPenalty),
        };
      })
      .sort((a, b) => b.operationScore - a.operationScore);
  }, [activeQueue, queue, selectedGroup]);

  useEffect(() => {
    if (!recommendations.length) {
      setSelectedQueueId("");
      return;
    }
    if (!recommendations.some((item) => item.id === selectedQueueId)) {
      setSelectedQueueId(recommendations[0].id);
    }
  }, [recommendations, selectedQueueId]);

  const currentOffer = recommendations.find((item) => item.id === selectedQueueId) || recommendations[0] || null;
  const currentIndex = currentOffer ? recommendations.findIndex((item) => item.id === currentOffer.id) : -1;
  const projectedCommission = activeQueue.reduce((sum, item) => sum + Number(item.estimated_commission || 0), 0);

  function apiHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    };
  }

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 4500);
  }

  async function loadAll() {
    setLoading(true);
    const [groupsResult, queueResult] = await Promise.all([
      supabase.from("offer_groups").select("*").eq("active", true).order("created_at", { ascending: true }),
      supabase.from("offer_group_queue").select("*").order("created_at", { ascending: false }).limit(800),
    ]);
    const error = groupsResult.error || queueResult.error;
    if (error) notify(error.message);
    setGroups(groupsResult.data || []);
    setQueue(queueResult.data || []);
    setLoading(false);
  }

  function groupStats(group, sourceQueue = queue) {
    const rows = sourceQueue.filter((item) => item.group_id === group.id);
    const published = rows.filter((item) => item.status === "published" && item.published_at && localDay(item.published_at) === localDay()).length;
    const active = rows.filter((item) => ["queued", "prepared"].includes(item.status)).length;
    return {
      published,
      active,
      slots: Math.max(0, Number(group.daily_limit || 0) - published - active),
    };
  }

  function searchTerms(group) {
    const terms = (group.keywords || []).map((item) => String(item || "").trim()).filter(Boolean);
    if (!terms.length) terms.push(group.name);
    return [...new Set(terms)].slice(0, 4);
  }

  function platformFilter(group) {
    const allowed = group.allowed_marketplaces || [];
    if (allowed.includes("shopee") && allowed.includes("mercado-livre")) return "all";
    if (allowed.includes("mercado-livre")) return "mercado-livre";
    return "shopee";
  }

  async function searchForGroup(group) {
    const terms = searchTerms(group);
    const platform = platformFilter(group);
    const requests = terms.map(async (term) => {
      const params = new URLSearchParams({ query: term.slice(0, 120), platform });
      const response = await fetch(`/api/search/general?${params.toString()}`, {
        headers: apiHeaders(),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Falha ao buscar “${term}”.`);
      return (data.offers || []).map((offer) => ({ ...offer, dailySearchTerm: term }));
    });

    const settled = await Promise.allSettled(requests);
    const offers = settled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
    const failures = settled.filter((entry) => entry.status === "rejected").length;
    const unique = new Map();
    for (const offer of offers) {
      const key = productKey(offer);
      const previous = unique.get(key);
      if (!previous || Number(offer.score || 0) > Number(previous.score || 0)) unique.set(key, offer);
    }
    return {
      offers: Array.from(unique.values()),
      terms,
      failures,
    };
  }

  async function scanSelectedGroup() {
    if (!selectedGroup) return;
    setBusy("scan");
    setProgress(`Buscando ${searchTerms(selectedGroup).length} temas de ${selectedGroup.name}...`);
    try {
      const result = await searchForGroup(selectedGroup);
      const eligible = result.offers.filter((offer) => offerFitsGroup(offer, selectedGroup).ok);
      setCandidateOffers(eligible);
      setCandidateGroupId(selectedGroup.id);
      setLastScan({
        groupId: selectedGroup.id,
        total: result.offers.length,
        eligible: eligible.length,
        failures: result.failures,
        at: new Date(),
      });
      notify(`${eligible.length} oportunidades compatíveis encontradas para ${selectedGroup.name}.`);
    } catch (error) {
      notify(error.message || "Falha ao atualizar oportunidades.");
    } finally {
      setBusy("");
      setProgress("");
    }
  }

  async function upsertPriceHistory(offers) {
    if (!offers.length) return;
    const today = localDay();
    const now = new Date().toISOString();
    const rows = offers.map((offer) => ({
      user_id: session.user.id,
      marketplace_slug: offer.marketplaceSlug || offer.marketplace_slug,
      external_id: String(offer.externalId || offer.external_id),
      title: offer.title,
      price: Number(offer.price || 0),
      original_price: Number(offer.originalPrice ?? offer.original_price ?? 0) || null,
      score: Number(offer.score || 0),
      captured_on: today,
      captured_at: now,
    }));
    await supabase.from("offer_price_history").upsert(rows, {
      onConflict: "user_id,marketplace_slug,external_id,captured_on",
    });
  }

  async function insertDailySelection(group, sourceOffers, sourceQueue = queue) {
    const stats = groupStats(group, sourceQueue);
    if (stats.slots <= 0) return { inserted: [], reason: "full" };

    const selection = selectDailyMix({
      offers: sourceOffers,
      group,
      queue: sourceQueue,
      slots: stats.slots,
    });
    if (!selection.length) return { inserted: [], reason: "empty" };

    const now = new Date().toISOString();
    const rows = selection.map(({ offer, snapshot }) => ({
      ...snapshot,
      user_id: session.user.id,
      group_id: group.id,
      status: "queued",
      metadata: {
        ...(snapshot.metadata || {}),
        search_term: offer.dailySearchTerm || null,
        generated_at: now,
      },
    }));

    const { data, error } = await supabase.from("offer_group_queue").insert(rows).select("*");
    if (error) throw error;
    await upsertPriceHistory(selection.map((entry) => entry.offer));
    return { inserted: data || [], reason: null };
  }

  async function buildSelectedQueue() {
    if (!selectedGroup) return;
    setBusy("build");
    try {
      const offers = candidateGroupId === selectedGroup.id && candidateOffers.length
        ? candidateOffers
        : (await searchForGroup(selectedGroup)).offers;
      const result = await insertDailySelection(selectedGroup, offers);
      if (result.reason === "full") {
        notify("A fila de hoje já está completa para este grupo.");
      } else if (result.reason === "empty") {
        notify("Não encontrei novas ofertas que passem pelas regras e pelo anti-repetição.");
      } else {
        setQueue((current) => [...result.inserted, ...current]);
        notify(`${result.inserted.length} ofertas adicionadas à fila de hoje.`);
      }
      setCandidateOffers([]);
      setCandidateGroupId("");
      await loadAll();
    } catch (error) {
      notify(error.code === "23505" ? "Algumas dessas ofertas já entraram na fila. Atualize e tente novamente." : error.message);
      await loadAll();
    } finally {
      setBusy("");
      setProgress("");
    }
  }

  async function refreshAllGroups() {
    if (!groups.length) return;
    setBusy("all");
    let insertedTotal = 0;
    let completed = 0;
    let failed = 0;
    let workingQueue = [...queue];

    for (const group of groups) {
      const stats = groupStats(group, workingQueue);
      if (stats.slots <= 0) {
        completed += 1;
        setProgress(`${completed}/${groups.length} · ${group.name} já está com a fila completa`);
        continue;
      }
      setProgress(`${completed + 1}/${groups.length} · Buscando oportunidades para ${group.name}...`);
      try {
        const result = await searchForGroup(group);
        const inserted = await insertDailySelection(group, result.offers, workingQueue);
        if (inserted.inserted.length) {
          insertedTotal += inserted.inserted.length;
          workingQueue = [...inserted.inserted, ...workingQueue];
        }
      } catch {
        failed += 1;
      }
      completed += 1;
    }

    setQueue(workingQueue);
    setBusy("");
    setProgress("");
    await loadAll();
    notify(`${insertedTotal} ofertas adicionadas nas filas${failed ? ` · ${failed} grupo(s) com falha de consulta` : ""}.`);
  }

  async function prepareOneClick(item, openWhatsapp = false) {
    if (!selectedGroup) return;
    let popup = null;
    if (openWhatsapp) popup = window.open("about:blank", "_blank");
    setBusy(`prepare:${item.id}`);

    try {
      const params = new URLSearchParams({
        query: String(item.title || "").slice(0, 100),
        platform: item.marketplace_slug,
      });
      const response = await fetch(`/api/search/general?${params.toString()}`, {
        headers: apiHeaders(),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao revalidar esta oferta.");

      const exact = (data.offers || []).find((offer) => String(offer.externalId) === String(item.external_id));
      if (!exact) throw new Error("O produto não apareceu na consulta atual. Mantive a oferta na fila para uma nova tentativa.");

      const snapshot = offerSnapshot(exact, selectedGroup.message_template);
      const changed = Math.abs(Number(item.price || 0) - Number(snapshot.price || 0)) >= 0.01;
      const now = new Date().toISOString();
      const message = snapshot.message_text || renderGroupMessage(selectedGroup.message_template, snapshot);
      const update = {
        ...snapshot,
        status: "prepared",
        scheduled_for: item.scheduled_for,
        validation_status: changed ? "changed" : "valid",
        validation_note: changed
          ? `Preço atualizado de ${formatMoney(item.price)} para ${formatMoney(snapshot.price)}.`
          : `Preço confirmado em ${formatMoney(snapshot.price)}.`,
        last_validated_at: now,
        message_text: message,
        metadata: { ...(item.metadata || {}), ...(snapshot.metadata || {}), prepared_one_click_at: now },
        updated_at: now,
      };
      const { data: updated, error } = await supabase.from("offer_group_queue").update(update).eq("id", item.id).select("*").single();
      if (error) throw error;
      await upsertPriceHistory([exact]);

      const copied = await copyText(message);
      setQueue((current) => current.map((row) => row.id === item.id ? updated : row));
      setSelectedQueueId(item.id);
      if (popup) popup.location.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
      notify(`${changed ? "Preço atualizado e oferta preparada" : "Oferta validada e preparada"}.${copied ? " Mensagem copiada." : ""}`);
    } catch (error) {
      if (popup) popup.close();
      await supabase.from("offer_group_queue").update({
        validation_status: "failed",
        validation_note: String(error.message || "Falha ao validar").slice(0, 300),
        last_validated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      notify(error.message || "Falha ao preparar a oferta.");
      await loadAll();
    } finally {
      setBusy("");
    }
  }

  async function markPublishedAndNext(item) {
    if (!selectedGroup) return;
    if (!["valid", "changed"].includes(item.validation_status) || hoursSince(item.last_validated_at) > VALIDATION_HOURS) {
      return notify("Use Preparar 1 clique antes de registrar a publicação. A validação vale por 6 horas.");
    }
    if (isRepeatBlocked(item, selectedGroup, queue)) {
      return notify("Anti-repetição ativo para este produto.");
    }
    if (publishedToday >= Number(selectedGroup.daily_limit || 10)) {
      return notify(`O limite diário de ${selectedGroup.daily_limit} ofertas já foi atingido.`);
    }

    setBusy(`publish:${item.id}`);
    const now = new Date().toISOString();
    const { error } = await supabase.from("offer_group_queue").update({
      status: "published",
      published_at: now,
      updated_at: now,
    }).eq("id", item.id);
    setBusy("");
    if (error) return notify(error.message);
    setQueue((current) => current.map((row) => row.id === item.id ? { ...row, status: "published", published_at: now } : row));
    setSelectedQueueId("");
    notify("Publicado registrado. A próxima oferta já foi selecionada.");
  }

  async function skipAndNext(item) {
    setBusy(`skip:${item.id}`);
    const { error } = await supabase.from("offer_group_queue").update({
      status: "skipped",
      updated_at: new Date().toISOString(),
    }).eq("id", item.id);
    setBusy("");
    if (error) return notify(error.message);
    setQueue((current) => current.map((row) => row.id === item.id ? { ...row, status: "skipped" } : row));
    setSelectedQueueId("");
    notify("Oferta ignorada. Próxima oportunidade carregada.");
  }

  function goNext() {
    if (!recommendations.length) return;
    const next = recommendations[currentIndex + 1] || recommendations[0];
    setSelectedQueueId(next.id);
  }

  if (loading || !session) {
    return <main className={styles.loading}><div>Preparando sua operação do dia...</div></main>;
  }

  if (!groups.length) {
    return (
      <main className={styles.emptyPage}>
        <section className={styles.emptyCard}>
          <span>Operação do Dia</span>
          <h1>Crie seu primeiro grupo</h1>
          <p>O modo diário usa as palavras-chave e regras dos grupos para montar uma fila automaticamente.</p>
          <a href="/groups">Criar grupo</a>
        </section>
      </main>
    );
  }

  const scanForCurrentGroup = lastScan?.groupId === selectedGroup?.id ? lastScan : null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>Modo Operação do Dia</span>
          <h1>Abra, publique, avance.</h1>
          <p>O sistema busca o que falta, monta uma fila diversificada e deixa a próxima oferta pronta para você.</p>
        </div>
        <nav className={styles.topNav}>
          <a href="/">Radar geral</a>
          <a href="/groups">Central de grupos</a>
          <a href="/groups/insights">Insights</a>
        </nav>
      </header>

      <section className={styles.commandBar}>
        <label>
          <span>Grupo em operação</span>
          <select value={selectedGroup?.id || ""} onChange={(event) => {
            setSelectedGroupId(event.target.value);
            setCandidateOffers([]);
            setCandidateGroupId("");
            setLastScan(null);
          }}>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
        <div className={styles.commandButtons}>
          <button onClick={scanSelectedGroup} disabled={Boolean(busy)}>{busy === "scan" ? "Buscando..." : "Atualizar oportunidades"}</button>
          <button className={styles.primaryButton} onClick={buildSelectedQueue} disabled={Boolean(busy) || remainingSlots <= 0}>{busy === "build" ? "Montando..." : `Montar fila de hoje${remainingSlots ? ` (${remainingSlots})` : ""}`}</button>
          <button className={styles.darkButton} onClick={refreshAllGroups} disabled={Boolean(busy)}>{busy === "all" ? "Atualizando grupos..." : "Atualizar todos os grupos"}</button>
        </div>
      </section>

      {progress && <div className={styles.progress}>{progress}</div>}

      <section className={styles.metrics}>
        <article><span>Publicadas hoje</span><strong>{publishedToday}/{selectedGroup?.daily_limit || 0}</strong><small>{publishedToday >= Number(selectedGroup?.daily_limit || 0) ? "Meta diária concluída" : "Controle do limite do grupo"}</small></article>
        <article><span>Fila ativa</span><strong>{activeQueue.length}</strong><small>{remainingSlots ? `Faltam ${remainingSlots} para completar o plano` : "Fila suficiente para hoje"}</small></article>
        <article><span>Comissão potencial</span><strong>{formatMoney(projectedCommission)}</strong><small>Soma estimada da fila ativa</small></article>
        <article><span>Última varredura</span><strong>{scanForCurrentGroup ? scanForCurrentGroup.eligible : "—"}</strong><small>{scanForCurrentGroup ? `${scanForCurrentGroup.total} analisadas · ${scanForCurrentGroup.failures} falha(s)` : "Clique em Atualizar oportunidades"}</small></article>
      </section>

      {candidateGroupId === selectedGroup?.id && candidateOffers.length > 0 && (
        <section className={styles.candidateStrip}>
          <div><span>Oportunidades atualizadas</span><strong>{candidateOffers.length} produtos passaram pelas regras</strong><small>Use “Montar fila de hoje” para selecionar automaticamente apenas o que falta.</small></div>
          <div className={styles.candidatePills}>
            {candidateOffers.slice(0, 5).map((offer) => <span key={productKey(offer)}>{marketplaceName(offer.marketplaceSlug)} · {formatMoney(offer.price)} · {Math.round(Number(offer.score || 0))}/100</span>)}
          </div>
        </section>
      )}

      <section className={styles.operationGrid}>
        <article className={styles.nextCard}>
          <div className={styles.sectionTitle}>
            <div><span>Próxima publicação</span><h2>{currentOffer ? "Oferta pronta para operar" : "Fila vazia"}</h2></div>
            {currentOffer && <span className={styles.position}>{currentIndex + 1}/{recommendations.length}</span>}
          </div>

          {currentOffer ? (
            <>
              <div className={styles.heroOffer}>
                <div className={styles.imageBox}>{currentOffer.thumbnail_url ? <img src={currentOffer.thumbnail_url} alt="" /> : <strong>{marketplaceName(currentOffer.marketplace_slug)}</strong>}</div>
                <div className={styles.heroContent}>
                  <div className={styles.badges}>
                    <span>{marketplaceName(currentOffer.marketplace_slug)}</span>
                    <span>{bucketLabel(currentOffer.metadata?.daily_bucket)}</span>
                    <span className={["valid", "changed"].includes(currentOffer.validation_status) ? styles.goodBadge : styles.warnBadge}>{validationLabel(currentOffer.validation_status)}</span>
                  </div>
                  <h3>{compactTitle(currentOffer.title)}</h3>
                  <div className={styles.priceLine}><strong>{formatMoney(currentOffer.price)}</strong>{Number(currentOffer.original_price || 0) > Number(currentOffer.price || 0) && <del>{formatMoney(currentOffer.original_price)}</del>}</div>
                  <div className={styles.offerNumbers}>
                    <span><b>{Math.round(Number(currentOffer.score || 0))}</b> score</span>
                    <span><b>{formatMoney(currentOffer.estimated_commission)}</b> comissão</span>
                    <span><b>{Number(currentOffer.sold_quantity || 0).toLocaleString("pt-BR")}</b> vendidos</span>
                    <span><b>{currentOffer.free_shipping ? "Sim" : "—"}</b> frete grátis</span>
                  </div>
                  {currentOffer.validation_note && <p className={styles.validationNote}>{currentOffer.validation_note}</p>}
                </div>
              </div>

              <div className={styles.bigActions}>
                <button className={styles.primaryButton} onClick={() => prepareOneClick(currentOffer, false)} disabled={Boolean(busy)}>{busy === `prepare:${currentOffer.id}` ? "Validando e preparando..." : "Preparar 1 clique"}</button>
                <button className={styles.whatsappButton} onClick={() => prepareOneClick(currentOffer, true)} disabled={Boolean(busy)}>Preparar + abrir WhatsApp</button>
                <button onClick={() => markPublishedAndNext(currentOffer)} disabled={Boolean(busy) || !["valid", "changed"].includes(currentOffer.validation_status)}>Publicado + próxima</button>
              </div>
              <div className={styles.secondaryActions}>
                <button onClick={goNext} disabled={recommendations.length < 2}>Próxima oferta</button>
                <button onClick={() => skipAndNext(currentOffer)} disabled={Boolean(busy)}>Ignorar + próxima</button>
                <a href={`/groups/creative?queue=${encodeURIComponent(currentOffer.id)}`}>Gerar criativo</a>
              </div>
            </>
          ) : (
            <div className={styles.noOffer}>
              <strong>Nada pendente para publicar.</strong>
              <p>Atualize as oportunidades e deixe o sistema completar a fila do grupo.</p>
              <button className={styles.primaryButton} onClick={buildSelectedQueue} disabled={Boolean(busy) || remainingSlots <= 0}>Montar fila agora</button>
            </div>
          )}
        </article>

        <aside className={styles.queuePanel}>
          <div className={styles.sectionTitle}><div><span>Sequência de hoje</span><h2>Próximas ofertas</h2></div><strong>{recommendations.length}</strong></div>
          <div className={styles.queueList}>
            {recommendations.slice(0, 12).map((item, index) => (
              <button key={item.id} className={item.id === currentOffer?.id ? styles.activeQueueRow : styles.queueRow} onClick={() => setSelectedQueueId(item.id)}>
                <span className={styles.queueIndex}>{index + 1}</span>
                <span className={styles.queueCopy}><strong>{compactTitle(item.title)}</strong><small>{bucketLabel(item.metadata?.daily_bucket)} · {formatMoney(item.price)} · comissão {formatMoney(item.estimated_commission)}</small></span>
                <span className={styles.queueScore}>{item.operationScore}</span>
              </button>
            ))}
            {!recommendations.length && <p className={styles.emptyQueue}>A fila será preenchida automaticamente de acordo com o limite diário do grupo.</p>}
          </div>
        </aside>
      </section>

      <section className={styles.rulesCard}>
        <div><span>Regras aplicadas automaticamente</span><h2>{selectedGroup?.name}</h2></div>
        <div className={styles.rulePills}>
          <span>Score mínimo {selectedGroup?.min_score}</span>
          <span>Comissão mínima {formatMoney(selectedGroup?.min_commission)}</span>
          <span>Anti-repetição {selectedGroup?.repeat_after_hours}h</span>
          <span>Limite {selectedGroup?.daily_limit}/dia</span>
          {selectedGroup?.price_max != null && <span>Até {formatMoney(selectedGroup.price_max)}</span>}
          {(selectedGroup?.allowed_marketplaces || []).map((slug) => <span key={slug}>{marketplaceName(slug)}</span>)}
        </div>
      </section>

      {toast && <div className={styles.toast}>{toast}</div>}
    </main>
  );
}
