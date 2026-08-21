"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./history.module.css";

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function money(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

function marketplaceName(value) {
  return value?.name || (value?.slug === "mercado-livre" ? "Mercado Livre" : value?.slug === "shopee" ? "Shopee" : "Marketplace");
}

export default function HistoryClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searches, setSearches] = useState([]);
  const [offers, setOffers] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!data.session) {
          window.location.replace("/");
          return;
        }

        const response = await fetch("/api/history?limit=50", {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Falha ao carregar histórico.");

        if (!cancelled) {
          setSearches(payload.searches || []);
          setOffers(payload.offers || []);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError?.message || "Falha ao carregar histórico.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>Inteligência operacional</span>
          <h1>Histórico</h1>
          <p>Veja o que foi pesquisado, quais fontes responderam e as ofertas que você preparou.</p>
        </div>
        <a className={styles.back} href="/">← Voltar ao radar</a>
      </header>

      {loading && <div className={styles.notice}>Carregando histórico...</div>}
      {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

      {!loading && !error && (
        <>
          <section className={styles.metrics}>
            <div><span>Pesquisas registradas</span><strong>{searches.length}</strong></div>
            <div><span>Ofertas preparadas</span><strong>{offers.length}</strong></div>
            <div><span>Buscas com falha</span><strong>{searches.filter((item) => item.status === "failed").length}</strong></div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <div><span className={styles.kicker}>Radar</span><h2>Pesquisas recentes</h2></div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Quando</th><th>Plataforma</th><th>Busca</th><th>Resultados</th><th>Tempo</th><th>Status</th></tr></thead>
                <tbody>
                  {searches.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDate(item.started_at)}</td>
                      <td>{marketplaceName(item.marketplace)}</td>
                      <td><strong>{item.query}</strong>{item.error_message && <small>{item.error_message}</small>}</td>
                      <td>{item.total_found}</td>
                      <td>{item.filters?.duration_ms ? `${(Number(item.filters.duration_ms) / 1000).toFixed(1)}s` : "—"}</td>
                      <td><span className={`${styles.status} ${item.status === "completed" ? styles.ok : styles.failed}`}>{item.status === "completed" ? "Concluída" : "Falhou"}</span></td>
                    </tr>
                  ))}
                  {!searches.length && <tr><td colSpan="6" className={styles.empty}>As próximas buscas feitas no radar aparecerão aqui automaticamente.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <div><span className={styles.kicker}>Robô 2</span><h2>Ofertas preparadas</h2></div>
            </div>
            <div className={styles.cards}>
              {offers.map((offer) => {
                const message = Array.isArray(offer.generated_messages) ? offer.generated_messages[0] : null;
                return (
                  <article className={styles.offerCard} key={offer.id}>
                    {offer.product?.thumbnail_url && <img src={offer.product.thumbnail_url} alt="" />}
                    <div>
                      <span className={styles.market}>{marketplaceName(offer.product?.marketplace)}</span>
                      <h3>{offer.product?.title || "Oferta"}</h3>
                      <p><strong>{money(offer.current_price)}</strong>{Number(offer.discount_percent || 0) > 0 ? ` · ${Math.round(offer.discount_percent)}% OFF` : ""} · score {Math.round(Number(offer.score || 0))}</p>
                      <small>Preparada em {formatDate(offer.created_at)}</small>
                      <div className={styles.actions}>
                        {offer.affiliate_url && <a href={offer.affiliate_url} target="_blank" rel="noreferrer">Abrir link</a>}
                        {message?.message_text && <button type="button" onClick={() => navigator.clipboard.writeText(message.message_text)}>Copiar mensagem</button>}
                      </div>
                    </div>
                  </article>
                );
              })}
              {!offers.length && <div className={styles.emptyCard}>Quando você clicar em “Salvar oferta” no Robô 2, ela aparecerá aqui.</div>}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
