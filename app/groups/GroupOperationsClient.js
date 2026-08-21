"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  DEFAULT_GROUP_TEMPLATE,
  formatMoney,
  offerSnapshot,
  renderGroupMessage,
  slugifyGroup,
} from "@/lib/group-offers";
import styles from "./groups.module.css";

const EMPTY_FORM = {
  id: "",
  name: "",
  description: "",
  audience: "",
  keywords: "",
  excludedKeywords: "",
  allowedMarketplaces: ["shopee", "mercado-livre"],
  priceMin: "",
  priceMax: "",
  minScore: 55,
  minCommission: 0,
  dailyLimit: 10,
  repeatAfterHours: 72,
  messageTemplate: DEFAULT_GROUP_TEMPLATE,
};

function dateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function localDay(value = new Date()) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function statusLabel(status) {
  if (status === "published") return "Publicado";
  if (status === "prepared") return "Preparado";
  if (status === "skipped") return "Ignorado";
  if (status === "expired") return "Expirado";
  return "Na fila";
}

function validationLabel(status) {
  if (status === "valid") return "Oferta validada";
  if (status === "changed") return "Preço mudou";
  if (status === "unavailable") return "Indisponível";
  if (status === "failed") return "Não confirmada";
  return "Precisa validar";
}

function marketplaceName(slug) {
  return slug === "mercado-livre" ? "Mercado Livre" : slug === "shopee" ? "Shopee" : "Amazon";
}

function hoursSince(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(value).getTime()) / 3600000;
}

export default function GroupOperationsClient() {
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [groups, setGroups] = useState([]);
  const [queue, setQueue] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [priceHistory, setPriceHistory] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [queueFilter, setQueueFilter] = useState("active");
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [toast, setToast] = useState("");
  const [favoriteList, setFavoriteList] = useState("Favoritos");

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
    () => queue.filter((item) => !selectedGroup || item.group_id === selectedGroup.id),
    [queue, selectedGroup]
  );

  const todayPublished = useMemo(() => {
    const today = localDay();
    return groupQueue.filter((item) => item.status === "published" && item.published_at && localDay(item.published_at) === today).length;
  }, [groupQueue]);

  const activeQueue = useMemo(
    () => groupQueue.filter((item) => item.status === "queued" || item.status === "prepared"),
    [groupQueue]
  );

  const priceMap = useMemo(() => {
    const map = new Map();
    for (const row of priceHistory) {
      const key = `${row.marketplace_slug}:${row.external_id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
    }
    return map;
  }, [priceHistory]);

  function priceSignal(item) {
    const rows = priceMap.get(`${item.marketplace_slug}:${item.external_id}`) || [];
    if (rows.length < 2) return null;
    const current = Number(item.price || 0);
    const previous = Number(rows[1]?.price || rows[0]?.price || 0);
    const lowest = Math.min(...rows.map((row) => Number(row.price || 0)).filter((value) => value > 0));
    if (previous > current && current > 0) {
      return {
        type: "drop",
        text: `Caiu ${Math.round(((previous - current) / previous) * 100)}% desde o registro anterior`,
      };
    }
    if (Number.isFinite(lowest) && current <= lowest) {
      return { type: "low", text: "Menor preço registrado" };
    }
    return null;
  }

  function repeatBlock(item, group = selectedGroup) {
    if (!group) return null;
    const latest = queue
      .filter((row) =>
        row.id !== item.id
        && row.group_id === group.id
        && row.marketplace_slug === item.marketplace_slug
        && row.external_id === item.external_id
        && row.status === "published"
        && row.published_at
      )
      .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))[0];
    if (!latest) return null;
    const elapsed = hoursSince(latest.published_at);
    const wait = Number(group.repeat_after_hours || 72);
    if (elapsed >= wait) return null;
    return Math.ceil(wait - elapsed);
  }

  const recommendations = useMemo(() => {
    const now = Date.now();
    return activeQueue
      .filter((item) => !item.scheduled_for || new Date(item.scheduled_for).getTime() <= now)
      .map((item) => {
        const validationBoost = item.validation_status === "valid" ? 12 : item.validation_status === "changed" ? 8 : 0;
        const freshnessBoost = hoursSince(item.created_at) < 24 ? 6 : 0;
        const commissionBoost = Math.min(Number(item.estimated_commission || 0) / 3, 12);
        const dropBoost = priceSignal(item) ? 8 : 0;
        const blocked = Boolean(repeatBlock(item));
        return {
          ...item,
          recommendationScore: Math.round(Number(item.priority || 0) + validationBoost + freshnessBoost + commissionBoost + dropBoost - (blocked ? 40 : 0)),
        };
      })
      .sort((a, b) => b.recommendationScore - a.recommendationScore)
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQueue, queue, selectedGroup, priceMap]);

  const visibleQueue = useMemo(() => {
    if (queueFilter === "published") return groupQueue.filter((item) => item.status === "published");
    if (queueFilter === "skipped") return groupQueue.filter((item) => item.status === "skipped" || item.status === "expired");
    return activeQueue;
  }, [queueFilter, groupQueue, activeQueue]);

  function apiHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    };
  }

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 4200);
  }

  async function loadAll() {
    setLoading(true);
    const [groupsResult, queueResult, favoritesResult, priceResult] = await Promise.all([
      supabase.from("offer_groups").select("*").order("created_at", { ascending: true }),
      supabase.from("offer_group_queue").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("favorite_offers").select("*").order("created_at", { ascending: false }).limit(250),
      supabase.from("offer_price_history").select("*").order("captured_at", { ascending: false }).limit(1000),
    ]);

    const error = groupsResult.error || queueResult.error || favoritesResult.error || priceResult.error;
    if (error) notify(error.message);
    setGroups(groupsResult.data || []);
    setQueue(queueResult.data || []);
    setFavorites(favoritesResult.data || []);
    setPriceHistory(priceResult.data || []);
    setLoading(false);
  }

  function groupToForm(group) {
    setForm({
      id: group.id,
      name: group.name || "",
      description: group.description || "",
      audience: group.audience || "",
      keywords: (group.keywords || []).join(", "),
      excludedKeywords: (group.excluded_keywords || []).join(", "),
      allowedMarketplaces: group.allowed_marketplaces || ["shopee", "mercado-livre"],
      priceMin: group.price_min ?? "",
      priceMax: group.price_max ?? "",
      minScore: group.min_score ?? 55,
      minCommission: group.min_commission ?? 0,
      dailyLimit: group.daily_limit ?? 10,
      repeatAfterHours: group.repeat_after_hours ?? 72,
      messageTemplate: group.message_template || DEFAULT_GROUP_TEMPLATE,
    });
    document.getElementById("group-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyPreset(type) {
    if (type === "achadinhos") {
      setForm({ ...EMPTY_FORM, name: "Achadinhos até R$ 50", audience: "Público que gosta de ofertas baratas e compra por impulso", priceMax: 50, minScore: 50, dailyLimit: 12, repeatAfterHours: 48 });
    } else if (type === "tech") {
      setForm({ ...EMPTY_FORM, name: "Tech e Eletrônicos", audience: "Tecnologia, acessórios e eletrônicos", keywords: "fone, celular, smartwatch, gamer, tecnologia", minScore: 62, minCommission: 3, dailyLimit: 8, repeatAfterHours: 96 });
    } else {
      setForm({ ...EMPTY_FORM, name: "Casa e Utilidades", audience: "Casa, cozinha, organização e utilidades", keywords: "casa, cozinha, organização, ferramentas", minScore: 58, dailyLimit: 10, repeatAfterHours: 72 });
    }
    document.getElementById("group-editor")?.scrollIntoView({ behavior: "smooth" });
  }

  async function saveGroup(event) {
    event.preventDefault();
    if (!form.name.trim()) return notify("Dê um nome ao grupo.");
    if (!form.allowedMarketplaces.length) return notify("Selecione pelo menos uma plataforma.");

    setSaving(true);
    const payload = {
      user_id: session.user.id,
      name: form.name.trim(),
      slug: slugifyGroup(form.name),
      description: form.description.trim() || null,
      audience: form.audience.trim() || null,
      keywords: form.keywords.split(",").map((item) => item.trim()).filter(Boolean),
      excluded_keywords: form.excludedKeywords.split(",").map((item) => item.trim()).filter(Boolean),
      allowed_marketplaces: form.allowedMarketplaces,
      price_min: form.priceMin === "" ? null : Number(form.priceMin),
      price_max: form.priceMax === "" ? null : Number(form.priceMax),
      min_score: Number(form.minScore || 0),
      min_commission: Number(form.minCommission || 0),
      daily_limit: Number(form.dailyLimit || 10),
      repeat_after_hours: Number(form.repeatAfterHours || 72),
      message_template: form.messageTemplate.trim() || DEFAULT_GROUP_TEMPLATE,
      updated_at: new Date().toISOString(),
    };

    const query = form.id
      ? supabase.from("offer_groups").update(payload).eq("id", form.id).select("*").single()
      : supabase.from("offer_groups").insert(payload).select("*").single();
    const { data, error } = await query;
    setSaving(false);
    if (error) return notify(error.message);

    setForm(EMPTY_FORM);
    if (data?.id) setSelectedGroupId(data.id);
    notify(form.id ? "Perfil do grupo atualizado." : "Grupo criado e pronto para receber ofertas.");
    await loadAll();
  }

  async function deleteGroup(group) {
    if (!window.confirm(`Excluir o grupo “${group.name}” e toda a fila dele?`)) return;
    const { error } = await supabase.from("offer_groups").delete().eq("id", group.id);
    if (error) return notify(error.message);
    if (selectedGroupId === group.id) setSelectedGroupId("");
    notify("Grupo removido.");
    await loadAll();
  }

  function validateForGroup(snapshot, group) {
    if (!group.allowed_marketplaces?.includes(snapshot.marketplace_slug)) return `${marketplaceName(snapshot.marketplace_slug)} não está permitida neste grupo.`;
    if (group.price_min != null && Number(snapshot.price) < Number(group.price_min)) return `Preço abaixo do mínimo do grupo (${formatMoney(group.price_min)}).`;
    if (group.price_max != null && Number(snapshot.price) > Number(group.price_max)) return `Preço acima do máximo do grupo (${formatMoney(group.price_max)}).`;
    if (Number(snapshot.score || 0) < Number(group.min_score || 0)) return `Score ${snapshot.score} abaixo do mínimo ${group.min_score}.`;
    if (Number(snapshot.estimated_commission || 0) < Number(group.min_commission || 0)) return `Comissão abaixo do mínimo de ${formatMoney(group.min_commission)}.`;
    return "";
  }

  async function upsertPriceHistory(offer) {
    const payload = {
      user_id: session.user.id,
      marketplace_slug: offer.marketplaceSlug || offer.marketplace_slug,
      external_id: String(offer.externalId || offer.external_id),
      title: offer.title,
      price: Number(offer.price || 0),
      original_price: Number(offer.originalPrice ?? offer.original_price ?? 0) || null,
      score: Number(offer.score || 0),
      captured_on: new Date().toISOString().slice(0, 10),
      captured_at: new Date().toISOString(),
    };
    await supabase.from("offer_price_history").upsert(payload, {
      onConflict: "user_id,marketplace_slug,external_id,captured_on",
    });
  }

  async function enqueueOffer(source, group = selectedGroup) {
    if (!group) return notify("Crie ou selecione um grupo primeiro.");
    const snapshot = offerSnapshot(source, group.message_template || DEFAULT_GROUP_TEMPLATE);
    if (!snapshot.external_id) return notify("Produto sem identificador não pode entrar na fila.");

    const constraint = validateForGroup(snapshot, group);
    if (constraint) return notify(constraint);

    const duplicate = queue.find((row) =>
      row.group_id === group.id
      && row.marketplace_slug === snapshot.marketplace_slug
      && row.external_id === snapshot.external_id
      && (row.status === "queued" || row.status === "prepared")
    );
    if (duplicate) return notify("Esse produto já está na fila deste grupo.");

    const wait = repeatBlock({ ...snapshot, id: "new" }, group);
    if (wait) return notify(`Anti-repetição: esse produto só pode voltar ao grupo em ${wait}h.`);

    const { error } = await supabase.from("offer_group_queue").insert({
      ...snapshot,
      user_id: session.user.id,
      group_id: group.id,
      status: "queued",
    });
    if (error) return notify(error.code === "23505" ? "Esse produto já está na fila." : error.message);

    await upsertPriceHistory(source);
    notify(`Oferta enviada para a fila de ${group.name}.`);
    await loadAll();
  }

  async function revalidate(item) {
    setBusyId(item.id);
    try {
      const params = new URLSearchParams({
        query: item.title.slice(0, 120),
        platform: item.marketplace_slug,
      });
      const response = await fetch(`/api/search/general?${params}`, {
        headers: apiHeaders(),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao revalidar.");

      const exact = (data.offers || []).find((offer) => String(offer.externalId) === String(item.external_id));
      if (!exact) {
        await supabase.from("offer_group_queue").update({
          validation_status: "failed",
          validation_note: "A busca respondeu, mas este produto não apareceu entre os resultados atuais.",
          last_validated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", item.id);
        notify("Não consegui confirmar esse produto agora. Ele foi mantido na fila para nova tentativa.");
        await loadAll();
        return;
      }

      const oldPrice = Number(item.price || 0);
      const newPrice = Number(exact.price || 0);
      const changed = Math.abs(oldPrice - newPrice) >= 0.01;
      const note = changed
        ? `Preço mudou de ${formatMoney(oldPrice)} para ${formatMoney(newPrice)}.`
        : `Preço confirmado em ${formatMoney(newPrice)}.`;
      const group = groups.find((row) => row.id === item.group_id);
      const snapshot = offerSnapshot(exact, group?.message_template || DEFAULT_GROUP_TEMPLATE);

      const { error } = await supabase.from("offer_group_queue").update({
        ...snapshot,
        group_id: item.group_id,
        status: item.status,
        scheduled_for: item.scheduled_for,
        validation_status: changed ? "changed" : "valid",
        validation_note: note,
        last_validated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      if (error) throw error;

      await upsertPriceHistory(exact);
      notify(changed ? "Oferta atualizada com o novo preço." : "Oferta confirmada e pronta para publicação.");
      await loadAll();
    } catch (error) {
      await supabase.from("offer_group_queue").update({
        validation_status: "failed",
        validation_note: String(error.message || "Falha de validação").slice(0, 300),
        last_validated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      notify(error.message || "Falha ao revalidar.");
      await loadAll();
    } finally {
      setBusyId("");
    }
  }

  async function markPublished(item) {
    const group = groups.find((row) => row.id === item.group_id);
    if (!group) return;
    const validationAge = hoursSince(item.last_validated_at);
    if (!["valid", "changed"].includes(item.validation_status) || validationAge > 6) {
      return notify("Revalide a oferta antes de publicar. A validação vale por 6 horas.");
    }
    const repeatHours = repeatBlock(item, group);
    if (repeatHours) return notify(`Anti-repetição ativo: espere mais ${repeatHours}h para publicar esse produto novamente.`);

    const publishedToday = queue.filter((row) =>
      row.group_id === group.id
      && row.status === "published"
      && row.published_at
      && localDay(row.published_at) === localDay()
    ).length;
    if (publishedToday >= Number(group.daily_limit || 10)) {
      return notify(`Limite diário de ${group.daily_limit} ofertas atingido neste grupo.`);
    }

    const now = new Date().toISOString();
    const { error } = await supabase.from("offer_group_queue").update({
      status: "published",
      published_at: now,
      updated_at: now,
    }).eq("id", item.id);
    if (error) return notify(error.message);
    notify("Publicação registrada. O anti-repetição já está contando a partir de agora.");
    await loadAll();
  }

  async function changeStatus(item, status) {
    const { error } = await supabase.from("offer_group_queue").update({
      status,
      updated_at: new Date().toISOString(),
    }).eq("id", item.id);
    if (error) return notify(error.message);
    await loadAll();
  }

  async function saveSchedule(item, value) {
    const iso = value ? new Date(value).toISOString() : null;
    const { error } = await supabase.from("offer_group_queue").update({
      scheduled_for: iso,
      updated_at: new Date().toISOString(),
    }).eq("id", item.id);
    if (error) return notify(error.message);
    notify(iso ? "Horário reservado na fila." : "Agendamento removido.");
    await loadAll();
  }

  async function incrementMetric(item, field) {
    const current = Number(item[field] || 0);
    const { error } = await supabase.from("offer_group_queue").update({
      [field]: current + 1,
      updated_at: new Date().toISOString(),
    }).eq("id", item.id);
    if (error) return notify(error.message);
    await loadAll();
  }

  async function registerCommission(item) {
    const value = window.prompt("Comissão real recebida nesta publicação (R$):", String(item.actual_commission || "0"));
    if (value == null) return;
    const amount = Number(String(value).replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) return notify("Informe um valor válido.");
    const { error } = await supabase.from("offer_group_queue").update({
      actual_commission: amount,
      updated_at: new Date().toISOString(),
    }).eq("id", item.id);
    if (error) return notify(error.message);
    await loadAll();
  }

  async function removeFavorite(item) {
    const { error } = await supabase.from("favorite_offers").delete().eq("id", item.id);
    if (error) return notify(error.message);
    notify("Removido dos favoritos.");
    await loadAll();
  }

  async function moveFavoriteList(item) {
    const name = window.prompt("Nome da lista:", item.list_name || "Favoritos");
    if (!name?.trim()) return;
    const { error } = await supabase.from("favorite_offers").update({
      list_name: name.trim(),
      updated_at: new Date().toISOString(),
    }).eq("id", item.id);
    if (error) return notify(error.message);
    await loadAll();
  }

  async function copyMessage(item) {
    const group = groups.find((row) => row.id === item.group_id);
    const message = item.message_text || renderGroupMessage(group?.message_template, item);
    await navigator.clipboard.writeText(message);
    notify("Mensagem copiada.");
  }

  function openWhatsApp(item) {
    const group = groups.find((row) => row.id === item.group_id);
    const message = item.message_text || renderGroupMessage(group?.message_template, item);
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  const totalActualCommission = queue.reduce((sum, item) => sum + Number(item.actual_commission || 0), 0);
  const totalEstimatedCommission = groupQueue.filter((item) => item.status === "published").reduce((sum, item) => sum + Number(item.estimated_commission || 0), 0);
  const offerOfDay = recommendations[0] || null;
  const favoriteLists = [...new Set(favorites.map((item) => item.list_name))].sort();
  const filteredFavorites = favoriteList === "Todos" ? favorites : favorites.filter((item) => item.list_name === favoriteList);

  if (!session || loading) {
    return <main className={styles.loading}>Carregando Central de Grupos...</main>;
  }

  return (
    <main className={styles.page}>
      <aside className={styles.sidebar}>
        <a href="/" className={styles.brand}><b>A</b><span>Afiliado Ofertas<small>Central de grupos</small></span></a>
        <nav>
          <a href="/">⌁ <span>Encontrar ofertas</span></a>
          <a className={styles.active} href="/groups">◉ <span>Grupos e fila</span></a>
          <a href="/history">◫ <span>Histórico</span></a>
        </nav>
        <div className={styles.user}>{session.user.email}<button onClick={() => supabase.auth.signOut().then(() => window.location.replace("/"))}>Sair</button></div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div><span>OPERAÇÃO DE GRUPOS</span><h1>O que publicar agora?</h1><p>Organize grupos, evite repetição e publique apenas ofertas revalidadas.</p></div>
          <a className={styles.primaryButton} href="/">+ Encontrar ofertas</a>
        </header>

        <section className={styles.metrics}>
          <div><span>Grupos ativos</span><strong>{groups.filter((group) => group.active).length}</strong><small>{groups.length ? "Perfis configurados" : "Crie o primeiro perfil"}</small></div>
          <div><span>Na fila</span><strong>{activeQueue.length}</strong><small>{selectedGroup ? selectedGroup.name : "Todos os grupos"}</small></div>
          <div><span>Publicadas hoje</span><strong>{todayPublished}{selectedGroup ? `/${selectedGroup.daily_limit}` : ""}</strong><small>Limite diário do grupo</small></div>
          <div><span>Comissão real</span><strong>{formatMoney(totalActualCommission)}</strong><small>Registrada manualmente</small></div>
        </section>

        {!groups.length ? (
          <section className={styles.emptyHero}>
            <span>COMECE AQUI</span><h2>Crie um perfil para cada grupo de ofertas</h2><p>O perfil define faixa de preço, score mínimo, comissão, limite diário e quanto tempo esperar antes de repetir um produto.</p>
            <div className={styles.presetRow}>
              <button onClick={() => applyPreset("achadinhos")}>Achadinhos até R$ 50</button>
              <button onClick={() => applyPreset("casa")}>Casa e Utilidades</button>
              <button onClick={() => applyPreset("tech")}>Tech e Eletrônicos</button>
            </div>
          </section>
        ) : (
          <>
            <section className={styles.groupBar}>
              <div><label>Grupo em operação<select value={selectedGroup?.id || ""} onChange={(event) => setSelectedGroupId(event.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></div>
              <div className={styles.groupRules}>
                <span>Score ≥ <b>{selectedGroup?.min_score}</b></span>
                <span>Comissão ≥ <b>{formatMoney(selectedGroup?.min_commission)}</b></span>
                <span>Repetir após <b>{selectedGroup?.repeat_after_hours}h</b></span>
                <span>Máx. <b>{selectedGroup?.daily_limit}/dia</b></span>
              </div>
              <button className={styles.secondaryButton} onClick={() => groupToForm(selectedGroup)}>Editar grupo</button>
            </section>

            <section className={styles.recommendationGrid}>
              <article className={styles.offerOfDay}>
                <div className={styles.sectionLabel}>🔥 MELHOR OPORTUNIDADE AGORA</div>
                {offerOfDay ? (
                  <>
                    <div className={styles.heroProduct}>
                      {offerOfDay.thumbnail_url ? <img src={offerOfDay.thumbnail_url} alt="" /> : <div className={styles.imageFallback}>A</div>}
                      <div><span>{marketplaceName(offerOfDay.marketplace_slug)} · prioridade {offerOfDay.recommendationScore}</span><h2>{offerOfDay.title}</h2><div className={styles.heroPrice}>{formatMoney(offerOfDay.price)} {Number(offerOfDay.original_price) > Number(offerOfDay.price) && <del>{formatMoney(offerOfDay.original_price)}</del>}</div><p>Score {offerOfDay.score}/100 · comissão est. {formatMoney(offerOfDay.estimated_commission)}</p></div>
                    </div>
                    {priceSignal(offerOfDay) && <div className={styles.priceSignal}>↓ {priceSignal(offerOfDay).text}</div>}
                    <div className={styles.heroActions}>
                      <button onClick={() => revalidate(offerOfDay)} disabled={busyId === offerOfDay.id}>{busyId === offerOfDay.id ? "Validando..." : "Revalidar agora"}</button>
                      <button onClick={() => copyMessage(offerOfDay)}>Copiar mensagem</button>
                      <button className={styles.whatsapp} onClick={() => openWhatsApp(offerOfDay)}>Abrir WhatsApp</button>
                    </div>
                  </>
                ) : <div className={styles.emptyBox}>Envie produtos do radar para este grupo. A melhor oportunidade aparecerá aqui automaticamente.</div>}
              </article>

              <article className={styles.nextList}>
                <div className={styles.sectionLabel}>PRÓXIMAS RECOMENDADAS</div>
                {recommendations.slice(1).map((item, index) => (
                  <div className={styles.nextItem} key={item.id}>
                    <b>{index + 2}</b><div><strong>{item.title}</strong><span>{marketplaceName(item.marketplace_slug)} · {formatMoney(item.price)} · score {item.score}</span></div><em>{item.recommendationScore}</em>
                  </div>
                ))}
                {recommendations.length <= 1 && <div className={styles.emptyBox}>A fila ainda não tem outras ofertas elegíveis.</div>}
              </article>
            </section>
          </>
        )}

        {groups.length > 0 && (
          <section className={styles.queueSection}>
            <div className={styles.sectionHeader}>
              <div><span>FILA INTELIGENTE</span><h2>Planejamento e publicação</h2><p>Uma oferta precisa ser revalidada nas últimas 6 horas para ser marcada como publicada.</p></div>
              <div className={styles.tabs}><button className={queueFilter === "active" ? styles.tabActive : ""} onClick={() => setQueueFilter("active")}>Fila ({activeQueue.length})</button><button className={queueFilter === "published" ? styles.tabActive : ""} onClick={() => setQueueFilter("published")}>Publicadas</button><button className={queueFilter === "skipped" ? styles.tabActive : ""} onClick={() => setQueueFilter("skipped")}>Ignoradas</button></div>
            </div>

            <div className={styles.queueList}>
              {visibleQueue.map((item) => {
                const repeatHours = repeatBlock(item);
                const signal = priceSignal(item);
                return (
                  <article className={styles.queueCard} key={item.id}>
                    <div className={styles.queueImage}>{item.thumbnail_url ? <img src={item.thumbnail_url} alt="" /> : marketplaceName(item.marketplace_slug).slice(0, 2)}</div>
                    <div className={styles.queueMain}>
                      <div className={styles.queueTop}><span className={styles.marketBadge}>{marketplaceName(item.marketplace_slug)}</span><span className={`${styles.validation} ${styles[item.validation_status] || ""}`}>{validationLabel(item.validation_status)}</span><span>{statusLabel(item.status)}</span></div>
                      <h3>{item.title}</h3>
                      <div className={styles.queueNumbers}><strong>{formatMoney(item.price)}</strong><span>score {item.score}</span><span>comissão {formatMoney(item.estimated_commission)}</span><span>prioridade {item.priority}</span></div>
                      {signal && <small className={styles.signalSmall}>↓ {signal.text}</small>}
                      {repeatHours && <small className={styles.blockSmall}>Anti-repetição: aguarde {repeatHours}h</small>}
                      {item.validation_note && <small className={styles.note}>{item.validation_note}</small>}
                      {(item.status === "queued" || item.status === "prepared") && <label className={styles.schedule}>Agendar<input type="datetime-local" defaultValue={toDateTimeLocal(item.scheduled_for)} onBlur={(event) => saveSchedule(item, event.target.value)} /></label>}
                      {item.status === "published" && <div className={styles.performance}><span>Cliques <b>{item.clicks}</b> <button onClick={() => incrementMetric(item, "clicks")}>+1</button></span><span>Vendas <b>{item.conversions}</b> <button onClick={() => incrementMetric(item, "conversions")}>+1</button></span><span>Comissão real <b>{formatMoney(item.actual_commission)}</b> <button onClick={() => registerCommission(item)}>Editar</button></span></div>}
                    </div>
                    <div className={styles.queueActions}>
                      {(item.status === "queued" || item.status === "prepared") && <><button onClick={() => revalidate(item)} disabled={busyId === item.id}>{busyId === item.id ? "Validando..." : "Revalidar"}</button><button onClick={() => copyMessage(item)}>Copiar</button><button className={styles.whatsappOutline} onClick={() => openWhatsApp(item)}>WhatsApp</button><button className={styles.publishButton} onClick={() => markPublished(item)}>Marcar publicada</button><button className={styles.dangerLink} onClick={() => changeStatus(item, "skipped")}>Ignorar</button></>}
                      {(item.status === "skipped" || item.status === "expired") && <button onClick={() => changeStatus(item, "queued")}>Voltar para fila</button>}
                    </div>
                  </article>
                );
              })}
              {!visibleQueue.length && <div className={styles.emptyBox}>Nada nesta etapa da fila.</div>}
            </div>
          </section>
        )}

        <section className={styles.favoritesSection}>
          <div className={styles.sectionHeader}>
            <div><span>FAVORITOS E LISTAS</span><h2>Produtos para publicar depois</h2><p>Favorite produtos no radar e organize por listas.</p></div>
            <select value={favoriteList} onChange={(event) => setFavoriteList(event.target.value)}><option>Todos</option><option>Favoritos</option>{favoriteLists.filter((name) => name !== "Favoritos").map((name) => <option key={name}>{name}</option>)}</select>
          </div>
          <div className={styles.favoriteGrid}>
            {filteredFavorites.slice(0, 24).map((item) => (
              <article key={item.id}>
                {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" /> : <div className={styles.favoriteFallback}>{marketplaceName(item.marketplace_slug).slice(0, 2)}</div>}
                <span>{item.list_name} · {marketplaceName(item.marketplace_slug)}</span><h3>{item.title}</h3><strong>{formatMoney(item.price)}</strong><small>score {item.score} · comissão {formatMoney(item.estimated_commission)}</small>
                <div><button onClick={() => enqueueOffer(item)}>Enviar para fila</button><button onClick={() => moveFavoriteList(item)}>Mover lista</button><button onClick={() => removeFavorite(item)}>Remover</button></div>
              </article>
            ))}
            {!filteredFavorites.length && <div className={styles.emptyBox}>Nenhum favorito nesta lista.</div>}
          </div>
        </section>

        <section id="group-editor" className={styles.editorSection}>
          <div className={styles.sectionHeader}>
            <div><span>PERFIS DE GRUPO</span><h2>{form.id ? "Editar estratégia" : "Criar novo grupo"}</h2><p>Essas regras são usadas na fila, no anti-repetição e na recomendação.</p></div>
            <div className={styles.presetRow}><button type="button" onClick={() => applyPreset("achadinhos")}>Preset Achadinhos</button><button type="button" onClick={() => applyPreset("casa")}>Preset Casa</button><button type="button" onClick={() => applyPreset("tech")}>Preset Tech</button></div>
          </div>

          <form className={styles.groupForm} onSubmit={saveGroup}>
            <label>Nome do grupo<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Achadinhos do Nicolas" /></label>
            <label>Público / posicionamento<input value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })} placeholder="Quem está nesse grupo e o que costuma comprar?" /></label>
            <label className={styles.wide}>Descrição<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Objetivo do grupo" /></label>
            <label>Palavras favoritas<input value={form.keywords} onChange={(event) => setForm({ ...form, keywords: event.target.value })} placeholder="casa, ferramentas, cozinha" /></label>
            <label>Palavras excluídas<input value={form.excludedKeywords} onChange={(event) => setForm({ ...form, excludedKeywords: event.target.value })} placeholder="usado, recondicionado..." /></label>
            <label>Preço mínimo<input type="number" min="0" step="0.01" value={form.priceMin} onChange={(event) => setForm({ ...form, priceMin: event.target.value })} /></label>
            <label>Preço máximo<input type="number" min="0" step="0.01" value={form.priceMax} onChange={(event) => setForm({ ...form, priceMax: event.target.value })} /></label>
            <label>Score mínimo<input type="number" min="0" max="100" value={form.minScore} onChange={(event) => setForm({ ...form, minScore: event.target.value })} /></label>
            <label>Comissão mínima (R$)<input type="number" min="0" step="0.01" value={form.minCommission} onChange={(event) => setForm({ ...form, minCommission: event.target.value })} /></label>
            <label>Máximo por dia<input type="number" min="1" max="100" value={form.dailyLimit} onChange={(event) => setForm({ ...form, dailyLimit: event.target.value })} /></label>
            <label>Anti-repetição (horas)<input type="number" min="1" value={form.repeatAfterHours} onChange={(event) => setForm({ ...form, repeatAfterHours: event.target.value })} /></label>
            <fieldset className={styles.platforms}><legend>Plataformas permitidas</legend>{["shopee", "mercado-livre"].map((slug) => <label key={slug}><input type="checkbox" checked={form.allowedMarketplaces.includes(slug)} onChange={(event) => setForm({ ...form, allowedMarketplaces: event.target.checked ? [...form.allowedMarketplaces, slug] : form.allowedMarketplaces.filter((item) => item !== slug) })} />{marketplaceName(slug)}</label>)}</fieldset>
            <label className={styles.wide}>Template de mensagem<textarea rows="8" value={form.messageTemplate} onChange={(event) => setForm({ ...form, messageTemplate: event.target.value })} /><small>Variáveis: {'{title} {price} {original_price} {discount} {shipping} {link} {marketplace} {commission} {score}'}</small></label>
            <div className={`${styles.wide} ${styles.formActions}`}>{form.id && <button type="button" onClick={() => setForm(EMPTY_FORM)}>Cancelar edição</button>}<button className={styles.primaryButton} disabled={saving}>{saving ? "Salvando..." : form.id ? "Salvar alterações" : "Criar grupo"}</button></div>
          </form>

          {!!groups.length && <div className={styles.groupCards}>{groups.map((group) => <article key={group.id}><div><strong>{group.name}</strong><span>{group.allowed_marketplaces.map(marketplaceName).join(" + ")}</span></div><p>{group.audience || group.description || "Sem descrição"}</p><small>Score ≥ {group.min_score} · {group.daily_limit}/dia · repetir em {group.repeat_after_hours}h</small><div><button onClick={() => { setSelectedGroupId(group.id); groupToForm(group); }}>Editar</button><button className={styles.dangerLink} onClick={() => deleteGroup(group)}>Excluir</button></div></article>)}</div>}
        </section>

        <footer className={styles.footer}>Estimativa publicada neste grupo: {formatMoney(totalEstimatedCommission)} · comissão real registrada em todos os grupos: {formatMoney(totalActualCommission)}</footer>
      </section>
      {toast && <div className={styles.toast}>{toast}</div>}
    </main>
  );
}