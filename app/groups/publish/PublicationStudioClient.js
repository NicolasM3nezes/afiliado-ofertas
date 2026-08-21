"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { formatMoney, renderGroupMessage } from "@/lib/group-offers";
import styles from "./publish.module.css";

function marketplaceName(slug) {
  return slug === "mercado-livre" ? "Mercado Livre" : slug === "shopee" ? "Shopee" : "Marketplace";
}

function shortTitle(value) {
  const title = String(value || "Oferta").trim();
  return title.length > 88 ? `${title.slice(0, 85)}...` : title;
}

function hoursSince(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  return Math.max(0, Date.now() - new Date(value).getTime()) / 3600000;
}

function isValidMeliShortUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "meli.la" && url.pathname.length > 1;
  } catch {
    return false;
  }
}

async function fallbackCopyText(text) {
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

async function convertToPng(blob) {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((png) => png ? resolve(png) : reject(new Error("Não consegui converter a imagem para copiar.")), "image/png", 0.95);
  });
}

export default function PublicationStudioClient() {
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [groups, setGroups] = useState([]);
  const [queue, setQueue] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [message, setMessage] = useState("");
  const [shortUrl, setShortUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
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
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, session]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) || groups[0] || null,
    [groups, selectedGroupId]
  );

  const groupQueue = useMemo(
    () => queue.filter((item) => selectedGroup && item.group_id === selectedGroup.id),
    [queue, selectedGroup]
  );

  const selectedOffer = useMemo(
    () => groupQueue.find((item) => item.id === selectedOfferId) || groupQueue[0] || null,
    [groupQueue, selectedOfferId]
  );

  useEffect(() => {
    if (!selectedGroupId && groups[0]) setSelectedGroupId(groups[0].id);
  }, [groups, selectedGroupId]);

  useEffect(() => {
    if (!groupQueue.length) {
      setSelectedOfferId("");
      return;
    }
    if (!groupQueue.some((item) => item.id === selectedOfferId)) setSelectedOfferId(groupQueue[0].id);
  }, [groupQueue, selectedOfferId]);

  useEffect(() => {
    if (!selectedOffer || !selectedGroup) {
      setMessage("");
      setShortUrl("");
      return;
    }
    const savedShort = selectedOffer.metadata?.short_url || selectedOffer.metadata?.meli_short_url || "";
    setShortUrl(savedShort);
    setMessage(selectedOffer.message_text || renderGroupMessage(selectedGroup.message_template, {
      ...selectedOffer,
      metadata: { ...(selectedOffer.metadata || {}), short_url: savedShort || null },
    }));
  }, [selectedOffer, selectedGroup]);

  function notify(text) {
    setToast(text);
    window.setTimeout(() => setToast(""), 4800);
  }

  function authHeaders() {
    return { Authorization: `Bearer ${session?.access_token || ""}` };
  }

  async function loadData() {
    setLoading(true);
    const [groupsResult, queueResult] = await Promise.all([
      supabase.from("offer_groups").select("*").eq("active", true).order("created_at", { ascending: true }),
      supabase.from("offer_group_queue").select("*").in("status", ["queued", "prepared"]).order("priority", { ascending: false }).limit(500),
    ]);
    const error = groupsResult.error || queueResult.error;
    if (error) notify(error.message);

    const nextGroups = [...(groupsResult.data || [])].sort((a, b) => {
      const aMen = String(a.slug || "").includes("homens") || String(a.name || "").toLowerCase().includes("homens");
      const bMen = String(b.slug || "").includes("homens") || String(b.name || "").toLowerCase().includes("homens");
      return Number(bMen) - Number(aMen);
    });
    setGroups(nextGroups);
    setQueue(queueResult.data || []);
    setLoading(false);
  }

  function messageWithShort(value) {
    if (!selectedOffer || !selectedGroup) return "";
    return renderGroupMessage(selectedGroup.message_template, {
      ...selectedOffer,
      message_text: null,
      metadata: { ...(selectedOffer.metadata || {}), short_url: value || null },
    });
  }

  function handleShortUrl(value) {
    setShortUrl(value);
    setMessage(messageWithShort(value.trim()));
  }

  async function savePreparedState() {
    if (!selectedOffer) return;
    const normalizedShort = shortUrl.trim();
    if (selectedOffer.marketplace_slug === "mercado-livre" && normalizedShort && !isValidMeliShortUrl(normalizedShort)) {
      throw new Error("O link curto do Mercado Livre precisa começar com https://meli.la/.");
    }
    const metadata = {
      ...(selectedOffer.metadata || {}),
      short_url: normalizedShort || null,
      publication_prepared_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("offer_group_queue").update({
      status: "prepared",
      message_text: message,
      metadata,
      updated_at: new Date().toISOString(),
    }).eq("id", selectedOffer.id).select("*").single();
    if (error) throw error;
    setQueue((current) => current.map((item) => item.id === data.id ? data : item));
  }

  async function loadProductPng() {
    if (!selectedOffer?.thumbnail_url) throw new Error("Esta oferta não tem imagem disponível.");
    const endpoint = `/api/media/product-image?url=${encodeURIComponent(selectedOffer.thumbnail_url)}`;
    const response = await fetch(endpoint, { headers: authHeaders(), cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Não consegui carregar a imagem do produto.");
    }
    return convertToPng(await response.blob());
  }

  async function copyPublication() {
    if (!selectedOffer) return;
    setBusy("bundle");
    try {
      if (!window.ClipboardItem || !navigator.clipboard?.write || !selectedOffer.thumbnail_url) {
        const copied = await fallbackCopyText(message);
        if (!copied) throw new Error("Seu navegador bloqueou a área de transferência.");
        await savePreparedState();
        notify("Texto copiado. Este navegador não permite copiar foto + legenda juntos; use o botão Copiar foto para anexar a imagem.");
        return;
      }

      const pngPromise = loadProductPng();
      const clipboardItem = new ClipboardItem({
        "image/png": pngPromise,
        "text/plain": new Blob([message], { type: "text/plain" }),
      });
      await navigator.clipboard.write([clipboardItem]);
      await savePreparedState();
      notify("Publicação copiada: imagem + descrição + link. Cole no WhatsApp com Ctrl+V.");
    } catch (error) {
      const copied = await fallbackCopyText(message);
      if (copied) {
        await savePreparedState().catch(() => {});
        notify(`O navegador não aceitou imagem + texto juntos. A legenda foi copiada. ${error.message || ""}`.trim());
      } else {
        notify(error.message || "Falha ao copiar a publicação.");
      }
    } finally {
      setBusy("");
    }
  }

  async function copyImageOnly() {
    if (!selectedOffer?.thumbnail_url) return notify("Esta oferta não tem imagem.");
    setBusy("image");
    try {
      if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error("Seu navegador não permite copiar imagens.");
      const clipboardItem = new ClipboardItem({ "image/png": loadProductPng() });
      await navigator.clipboard.write([clipboardItem]);
      notify("Foto do produto copiada. Cole no WhatsApp e use a legenda em seguida.");
    } catch (error) {
      notify(error.message || "Falha ao copiar a foto.");
    } finally {
      setBusy("");
    }
  }

  async function copyTextOnly() {
    const copied = await fallbackCopyText(message);
    notify(copied ? "Legenda completa copiada." : "Seu navegador bloqueou a cópia.");
  }

  async function copyProductUrl() {
    if (!selectedOffer?.permalink) return notify("A URL original do produto não está disponível.");
    const copied = await fallbackCopyText(selectedOffer.permalink);
    notify(copied ? "URL do produto copiada. Cole no Gerador de Links do Mercado Livre e escolha Link curto." : "Não consegui copiar a URL.");
  }

  async function saveShortLink() {
    if (!selectedOffer) return;
    const normalized = shortUrl.trim();
    if (selectedOffer.marketplace_slug === "mercado-livre" && normalized && !isValidMeliShortUrl(normalized)) {
      return notify("Cole um link válido no formato https://meli.la/...");
    }
    setBusy("short");
    try {
      const nextMessage = messageWithShort(normalized);
      setMessage(nextMessage);
      const metadata = { ...(selectedOffer.metadata || {}), short_url: normalized || null };
      const { data, error } = await supabase.from("offer_group_queue").update({
        metadata,
        message_text: nextMessage,
        updated_at: new Date().toISOString(),
      }).eq("id", selectedOffer.id).select("*").single();
      if (error) throw error;
      setQueue((current) => current.map((item) => item.id === data.id ? data : item));
      notify(normalized ? "Link curto salvo e aplicado à publicação." : "Link curto removido; o link afiliado completo voltou a ser usado.");
    } catch (error) {
      notify(error.message || "Falha ao salvar o link curto.");
    } finally {
      setBusy("");
    }
  }

  function openWhatsApp() {
    if (!message) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  if (loading || !session) return <main className={styles.loading}>Preparando estúdio de publicação...</main>;

  if (!groups.length) {
    return <main className={styles.empty}><h1>Crie um grupo primeiro.</h1><p>Use a Configuração rápida para criar “Ofertas para Homens”.</p><a href="/groups/setup">Abrir configuração rápida</a></main>;
  }

  const meli = selectedOffer?.marketplace_slug === "mercado-livre";
  const stale = selectedOffer ? hoursSince(selectedOffer.last_validated_at) > 6 : false;
  const displayLink = shortUrl.trim() || selectedOffer?.affiliate_url || selectedOffer?.permalink || "";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><span>Publicação rápida</span><h1>Foto + legenda + link prontos.</h1><p>Monte a publicação no estilo dos grupos de promoções e copie tudo com o mínimo de cliques.</p></div>
        <a href="/groups/today">← Operação do Dia</a>
      </header>

      <section className={styles.toolbar}>
        <label><span>Grupo</span><select value={selectedGroup?.id || ""} onChange={(event) => { setSelectedGroupId(event.target.value); setSelectedOfferId(""); }}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label><span>Oferta da fila</span><select value={selectedOffer?.id || ""} onChange={(event) => setSelectedOfferId(event.target.value)}><option value="">Selecione</option>{groupQueue.map((item) => <option key={item.id} value={item.id}>{shortTitle(item.title)} · {formatMoney(item.price)}</option>)}</select></label>
        <div className={styles.queueMetric}><span>Ofertas prontas</span><strong>{groupQueue.length}</strong><small>{selectedGroup?.name}</small></div>
      </section>

      {!selectedOffer ? (
        <section className={styles.emptyQueue}><h2>A fila deste grupo está vazia.</h2><p>Monte a fila na Operação do Dia e volte aqui para preparar a publicação.</p><a href="/groups/today">Montar fila</a></section>
      ) : (
        <section className={styles.workspace}>
          <div className={styles.previewColumn}>
            <div className={styles.previewTitle}><span>Prévia</span><strong>Como vai ficar no WhatsApp</strong></div>
            <article className={styles.whatsappCard}>
              <div className={styles.whatsappTop}><span className={styles.avatar}>P</span><div><strong>Promos Masculinas</strong><small>ofertas selecionadas</small></div><span>•••</span></div>
              {selectedOffer.thumbnail_url ? <img className={styles.productImage} src={selectedOffer.thumbnail_url} alt="" /> : <div className={styles.imageFallback}>{marketplaceName(selectedOffer.marketplace_slug)}</div>}
              <div className={styles.captionPreview}>{message.split("\n").map((line, index) => <p key={`${index}:${line}`}>{line || <br />}</p>)}</div>
              <div className={styles.previewLink}>{displayLink}</div>
              <div className={styles.time}>agora ✓✓</div>
            </article>
            {meli && <div className={styles.compliance}><strong>Mercado Livre</strong><span>Use links de afiliado apenas em canais e grupos públicos/abertos, conforme as regras atuais do programa.</span></div>}
          </div>

          <div className={styles.editorColumn}>
            <section className={styles.productSummary}>
              {selectedOffer.thumbnail_url && <img src={selectedOffer.thumbnail_url} alt="" />}
              <div><span>{marketplaceName(selectedOffer.marketplace_slug)}</span><h2>{selectedOffer.title}</h2><p><strong>{formatMoney(selectedOffer.price)}</strong>{Number(selectedOffer.original_price || 0) > Number(selectedOffer.price || 0) ? ` · de ${formatMoney(selectedOffer.original_price)}` : ""} · score {Math.round(Number(selectedOffer.score || 0))}/100</p></div>
            </section>

            {stale && <div className={styles.warning}>⚠️ Esta oferta não foi validada nas últimas 6 horas. Antes de publicar, vale usar “Preparar 1 clique” na Operação do Dia.</div>}

            {meli && (
              <section className={styles.shortLinkBox}>
                <div><span>Link curto do Mercado Livre</span><h3>{shortUrl ? "meli.la configurado" : "Opcional, mas fica mais bonito no grupo"}</h3><p>O `meli.la` precisa ser gerado pelo próprio Mercado Livre. Copie a URL do produto, use o Gerador de Links e escolha <b>Link curto</b>; depois cole o resultado aqui.</p></div>
                <div className={styles.shortActions}><input value={shortUrl} onChange={(event) => handleShortUrl(event.target.value)} placeholder="https://meli.la/ABC123" /><button onClick={saveShortLink} disabled={busy === "short"}>{busy === "short" ? "Salvando..." : "Salvar"}</button></div>
                <button className={styles.secondaryLink} onClick={copyProductUrl}>Copiar URL do produto para o Gerador Meli</button>
              </section>
            )}

            <label className={styles.messageEditor}><span>Legenda da publicação</span><textarea rows="15" value={message} onChange={(event) => setMessage(event.target.value)} /></label>

            <div className={styles.primaryActions}>
              <button className={styles.primary} onClick={copyPublication} disabled={Boolean(busy)}>{busy === "bundle" ? "Preparando imagem..." : "Copiar publicação completa"}</button>
              <button className={styles.whatsapp} onClick={openWhatsApp}>Abrir WhatsApp</button>
            </div>
            <div className={styles.secondaryActions}>
              <button onClick={copyImageOnly} disabled={Boolean(busy)}>Copiar foto</button>
              <button onClick={copyTextOnly}>Copiar só legenda</button>
              <a href={selectedOffer.affiliate_url || selectedOffer.permalink || "#"} target="_blank" rel="noreferrer">Abrir produto</a>
            </div>
            <p className={styles.tip}>No Chrome/Edge, “Copiar publicação completa” tenta colocar <b>imagem + texto</b> juntos na área de transferência. Se o WhatsApp colar apenas a foto, use “Copiar só legenda” para inserir a descrição na legenda da imagem.</p>
          </div>
        </section>
      )}

      {toast && <div className={styles.toast}>{toast}</div>}
    </main>
  );
}
