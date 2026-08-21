"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { GROUP_PRESETS, presetPayload } from "@/lib/group-presets";
import { formatMoney, slugifyGroup } from "@/lib/group-offers";
import styles from "./setup.module.css";

export default function GroupSetupClient() {
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(["achadinhos", "casa", "tech", "ferramentas"]);
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
    loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, session]);

  async function loadGroups() {
    const { data, error } = await supabase.from("offer_groups").select("id,name,slug,active").order("created_at");
    if (error) return notify(error.message);
    setGroups(data || []);
  }

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 4200);
  }

  const existingSlugs = useMemo(() => new Set(groups.map((group) => group.slug)), [groups]);
  const selectedPresets = GROUP_PRESETS.filter((preset) => selected.includes(preset.key) && !existingSlugs.has(slugifyGroup(preset.name)));

  function toggle(key) {
    setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  async function createPreset(preset) {
    const slug = slugifyGroup(preset.name);
    if (existingSlugs.has(slug)) return notify(`${preset.name} já existe.`);
    setBusy(preset.key);
    const { error } = await supabase.from("offer_groups").insert(presetPayload(preset, session.user.id));
    setBusy("");
    if (error) return notify(error.message);
    notify(`${preset.name} criado.`);
    await loadGroups();
  }

  async function createSelected() {
    if (!selectedPresets.length) return notify("Os presets selecionados já existem ou nenhum foi selecionado.");
    setBusy("pack");
    const rows = selectedPresets.map((preset) => presetPayload(preset, session.user.id));
    const { error } = await supabase.from("offer_groups").insert(rows);
    setBusy("");
    if (error) return notify(error.message);
    await loadGroups();
    notify(`${rows.length} grupos criados. Sua operação inicial está pronta.`);
  }

  if (!session) return <main className={styles.loading}>Carregando configuração rápida...</main>;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span>Configuração Rápida</span>
          <h1>Comece com grupos prontos.</h1>
          <p>Escolha os perfis que combinam com sua operação. Preço, score, comissão, frequência e palavras-chave já entram configurados.</p>
        </div>
        <nav><a href="/groups">Central de grupos</a><a href="/groups/today">Operação do Dia</a></nav>
      </header>

      <section className={styles.summary}>
        <div><span>Grupos atuais</span><strong>{groups.length}</strong><small>{groups.filter((group) => group.active).length} ativos</small></div>
        <div><span>Selecionados</span><strong>{selected.length}</strong><small>{selectedPresets.length} novos para criar</small></div>
        <div><span>Pacote recomendado</span><strong>4</strong><small>Achadinhos · Casa · Tech · Ferramentas</small></div>
        <button onClick={createSelected} disabled={Boolean(busy) || !selectedPresets.length}>{busy === "pack" ? "Criando grupos..." : `Criar selecionados (${selectedPresets.length})`}</button>
      </section>

      <section className={styles.grid}>
        {GROUP_PRESETS.map((preset) => {
          const exists = existingSlugs.has(slugifyGroup(preset.name));
          const checked = selected.includes(preset.key);
          return (
            <article key={preset.key} className={`${styles.card} ${checked ? styles.selected : ""} ${exists ? styles.exists : ""}`}>
              <div className={styles.cardHead}>
                <span className={styles.icon}>{preset.icon}</span>
                <label className={styles.check}><input type="checkbox" checked={checked} disabled={exists} onChange={() => toggle(preset.key)} /><span>{exists ? "Já criado" : checked ? "Selecionado" : "Selecionar"}</span></label>
              </div>
              <h2>{preset.name}</h2>
              <p>{preset.description}</p>
              <div className={styles.rules}>
                <span>Score ≥ {preset.minScore}</span>
                <span>Comissão ≥ {formatMoney(preset.minCommission)}</span>
                <span>{preset.dailyLimit}/dia</span>
                <span>Repetição {preset.repeatAfterHours}h</span>
                {preset.priceMax != null && <span>Até {formatMoney(preset.priceMax)}</span>}
                {preset.priceMin != null && <span>Desde {formatMoney(preset.priceMin)}</span>}
              </div>
              <div className={styles.keywords}>{preset.keywords.slice(0, 5).map((keyword) => <span key={keyword}>{keyword}</span>)}</div>
              <button onClick={() => createPreset(preset)} disabled={Boolean(busy) || exists}>{busy === preset.key ? "Criando..." : exists ? "Grupo já existe" : "Criar este grupo"}</button>
            </article>
          );
        })}
      </section>

      <section className={styles.nextStep}>
        <div><span>Depois de criar</span><h2>Não precisa configurar mais nada para começar.</h2><p>Abra a Operação do Dia, clique em Atualizar todos os grupos e deixe o sistema montar as filas automaticamente.</p></div>
        <a href="/groups/today">Abrir Operação do Dia →</a>
      </section>

      {toast && <div className={styles.toast}>{toast}</div>}
    </main>
  );
}
