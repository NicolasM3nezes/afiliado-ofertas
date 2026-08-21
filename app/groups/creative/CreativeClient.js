"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { formatMoney } from "@/lib/group-offers";
import styles from "./creative.module.css";

const PRESETS = {
  flash: { label: "OFERTA RELÂMPAGO", accent: "#ff5a00", bg: "#111318", fg: "#ffffff", sub: "Aproveite antes que acabe" },
  achado: { label: "ACHADINHO DO DIA", accent: "#ffcf2f", bg: "#fff7dc", fg: "#16181d", sub: "Preço bom para compartilhar" },
  top: { label: "MAIS VENDIDO", accent: "#1f79ff", bg: "#eef5ff", fg: "#15171b", sub: "Produto forte no radar" },
  clean: { label: "OFERTA SELECIONADA", accent: "#111318", bg: "#ffffff", fg: "#111318", sub: "Escolhida pelo radar de oportunidades" },
};

function wrapText(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function marketplaceName(slug) {
  return slug === "mercado-livre" ? "Mercado Livre" : slug === "shopee" ? "Shopee" : "Amazon";
}

export default function CreativeClient() {
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [presetKey, setPresetKey] = useState("flash");
  const [cta, setCta] = useState("CLIQUE NO LINK E APROVEITE");
  const [headline, setHeadline] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    setSupabase(client);
    client.auth.getSession().then(async ({ data }) => {
      if (!data.session) return window.location.replace("/");
      setSession(data.session);
      const { data: rows } = await client.from("offer_group_queue").select("*").order("created_at", { ascending: false }).limit(300);
      setItems(rows || []);
      if (rows?.[0]) setSelectedId(rows[0].id);
    });
  }, []);

  const item = useMemo(() => items.find((row) => row.id === selectedId) || null, [items, selectedId]);
  const preset = PRESETS[presetKey];

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  }

  function downloadPng() {
    if (!item) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = preset.bg;
    ctx.fillRect(0, 0, 1080, 1080);

    ctx.fillStyle = preset.accent;
    ctx.fillRect(0, 0, 1080, 28);

    ctx.fillStyle = preset.fg;
    ctx.font = "900 42px Arial";
    ctx.fillText(headline.trim() || preset.label, 70, 115);
    ctx.font = "500 25px Arial";
    ctx.globalAlpha = 0.7;
    ctx.fillText(preset.sub, 70, 158);
    ctx.globalAlpha = 1;

    const cardY = 220;
    ctx.fillStyle = presetKey === "flash" ? "#1d2026" : "#ffffff";
    if (presetKey !== "flash") ctx.shadowColor = "rgba(0,0,0,.10)";
    ctx.shadowBlur = presetKey === "flash" ? 0 : 28;
    roundedRect(ctx, 70, cardY, 940, 560, 36);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = preset.accent;
    ctx.font = "900 24px Arial";
    ctx.fillText(marketplaceName(item.marketplace_slug).toUpperCase(), 120, 285);

    const cardText = presetKey === "flash" ? "#ffffff" : "#111318";
    ctx.fillStyle = cardText;
    ctx.font = "800 39px Arial";
    const titleLines = wrapText(ctx, item.title, 820).slice(0, 4);
    titleLines.forEach((line, index) => ctx.fillText(line, 120, 350 + index * 52));

    const priceY = 590;
    ctx.fillStyle = preset.accent;
    ctx.font = "900 72px Arial";
    ctx.fillText(formatMoney(item.price), 120, priceY);

    if (Number(item.original_price) > Number(item.price)) {
      ctx.fillStyle = presetKey === "flash" ? "#aeb3bd" : "#777c85";
      ctx.font = "500 28px Arial";
      ctx.fillText(`De ${formatMoney(item.original_price)}`, 125, priceY + 48);
    }

    if (Number(item.discount_percent || 0) > 0) {
      ctx.fillStyle = preset.accent;
      roundedRect(ctx, 760, 560, 180, 82, 22);
      ctx.fill();
      ctx.fillStyle = presetKey === "achado" ? "#111318" : "#ffffff";
      ctx.font = "900 34px Arial";
      ctx.textAlign = "center";
      ctx.fillText(`-${Math.round(item.discount_percent)}%`, 850, 612);
      ctx.textAlign = "left";
    }

    ctx.fillStyle = presetKey === "flash" ? "#d5d8df" : "#5f646d";
    ctx.font = "600 24px Arial";
    const details = [];
    if (item.free_shipping) details.push("FRETE GRÁTIS");
    if (Number(item.sold_quantity || 0) > 0) details.push(`+${Number(item.sold_quantity).toLocaleString("pt-BR")} VENDIDOS`);
    if (Number(item.score || 0) > 0) details.push(`SCORE ${Math.round(item.score)}/100`);
    ctx.fillText(details.join("   •   "), 120, 720);

    ctx.fillStyle = preset.accent;
    roundedRect(ctx, 70, 835, 940, 125, 28);
    ctx.fill();
    ctx.fillStyle = presetKey === "achado" ? "#111318" : "#ffffff";
    ctx.font = "900 32px Arial";
    ctx.textAlign = "center";
    ctx.fillText(cta || "APROVEITE A OFERTA", 540, 910);
    ctx.textAlign = "left";

    ctx.fillStyle = preset.fg;
    ctx.globalAlpha = 0.55;
    ctx.font = "500 19px Arial";
    ctx.fillText("Preço e disponibilidade podem mudar. Confira no link antes de comprar.", 70, 1020);
    ctx.globalAlpha = 1;

    const link = document.createElement("a");
    link.download = `oferta-${item.marketplace_slug}-${String(item.external_id).replace(/[^a-zA-Z0-9_-]/g, "-")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    notify("Criativo PNG gerado em 1080×1080.");
  }

  async function copyMessage() {
    if (!item?.message_text) return notify("Esta oferta não tem mensagem salva.");
    await navigator.clipboard.writeText(item.message_text);
    notify("Mensagem copiada.");
  }

  if (!session) return <main className={styles.loading}>Carregando criativos...</main>;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}><a href="/groups">← Central de Grupos</a><strong>Gerador de Criativos</strong><a href="/groups/radar">Radar do Grupo</a></header>
      <section className={styles.workspace}>
        <div className={styles.header}><div><span>CRIATIVO AUTOMÁTICO</span><h1>Transforme uma oferta em card de divulgação</h1><p>Gera PNG quadrado 1080×1080 direto no navegador. Nenhuma publicação é feita automaticamente.</p></div></div>

        {!items.length ? <div className={styles.empty}>Adicione uma oferta à fila de algum grupo para criar o primeiro criativo.</div> : (
          <div className={styles.layout}>
            <aside className={styles.controls}>
              <label>Oferta<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{items.map((row) => <option key={row.id} value={row.id}>{row.title.slice(0, 70)}</option>)}</select></label>
              <label>Estilo<select value={presetKey} onChange={(event) => setPresetKey(event.target.value)}>{Object.entries(PRESETS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
              <label>Chamada superior<input value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder={preset.label} /></label>
              <label>CTA<input value={cta} onChange={(event) => setCta(event.target.value)} /></label>
              <div className={styles.actions}><button onClick={downloadPng}>Baixar PNG 1080×1080</button><button onClick={copyMessage}>Copiar mensagem</button></div>
              <small>O card não inclui comissão para não expor seu ganho ao cliente. O foco é preço, desconto, frete e prova social.</small>
            </aside>

            {item && <section className={`${styles.preview} ${styles[presetKey]}`}>
              <div className={styles.accent} />
              <span className={styles.kicker}>{headline.trim() || preset.label}</span><small>{preset.sub}</small>
              <div className={styles.product}><b>{marketplaceName(item.marketplace_slug)}</b><h2>{item.title}</h2><div className={styles.price}>{formatMoney(item.price)}</div>{Number(item.original_price) > Number(item.price) && <del>De {formatMoney(item.original_price)}</del>}<p>{item.free_shipping ? "🚚 Frete grátis · " : ""}{item.sold_quantity ? `+${Number(item.sold_quantity).toLocaleString("pt-BR")} vendidos · ` : ""}score {Math.round(item.score)}/100</p>{Number(item.discount_percent) > 0 && <em>-{Math.round(item.discount_percent)}%</em>}</div>
              <strong className={styles.cta}>{cta}</strong><footer>Preço e disponibilidade podem mudar. Confira no link.</footer>
            </section>}
          </div>
        )}
      </section>
      {toast && <div className={styles.toast}>{toast}</div>}
    </main>
  );
}