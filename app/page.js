"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { buildOfferMessage } from "@/lib/offer-message";

function money(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function Home() {
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [bootError, setBootError] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [niches, setNiches] = useState([]);
  const [newNiche, setNewNiche] = useState("");
  const [selectedNicheId, setSelectedNicheId] = useState("");
  const [query, setQuery] = useState("ferramentas");
  const [minDiscount, setMinDiscount] = useState(15);
  const [minScore, setMinScore] = useState(60);
  const [offers, setOffers] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchWarning, setSearchWarning] = useState("");
  const [searchSource, setSearchSource] = useState("");

  const [selectedOffer, setSelectedOffer] = useState(null);
  const [affiliateUrl, setAffiliateUrl] = useState("");
  const [preparedMessage, setPreparedMessage] = useState("");
  const [prepareLoading, setPrepareLoading] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    try {
      const client = getSupabaseBrowserClient();
      setSupabase(client);
      client.auth.getSession().then(({ data }) => setSession(data.session || null));
      const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession || null);
      });
      return () => listener.subscription.unsubscribe();
    } catch (error) {
      setBootError(error.message);
    }
  }, []);

  useEffect(() => {
    if (!supabase || !session) return;
    loadNiches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, session]);

  const selectedNiche = useMemo(
    () => niches.find((item) => item.id === selectedNicheId) || null,
    [niches, selectedNicheId]
  );

  async function loadNiches() {
    const { data, error } = await supabase
      .from("niches")
      .select("id,name,slug,min_discount,min_score")
      .order("created_at", { ascending: true });

    if (!error) {
      setNiches(data || []);
      if (!selectedNicheId && data?.[0]) setSelectedNicheId(data[0].id);
    }
  }

  async function handleAuth(event) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthMessage("");

    const action = authMode === "login"
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password });

    const { data, error } = await action;
    setAuthLoading(false);

    if (error) {
      setAuthMessage(error.message);
      return;
    }

    if (authMode === "signup" && !data.session) {
      setAuthMessage("Cadastro criado. Confirme o e-mail para entrar.");
    }
  }

  async function createNiche() {
    const name = newNiche.trim();
    if (!name) return;

    const { data, error } = await supabase
      .from("niches")
      .insert({
        user_id: session.user.id,
        name,
        slug: slugify(name),
        keywords: [name],
        min_discount: Number(minDiscount),
        min_score: Number(minScore),
      })
      .select("id,name,slug,min_discount,min_score")
      .single();

    if (error) {
      showToast(error.message);
      return;
    }

    setNiches((current) => [...current, data]);
    setSelectedNicheId(data.id);
    setNewNiche("");
    setQuery(name);
    showToast("Nicho criado.");
  }

  async function searchOffers() {
    setSearchLoading(true);
    setSearchWarning("");
    setOffers([]);

    const params = new URLSearchParams({
      query,
      minDiscount: String(minDiscount),
      minScore: String(minScore),
      limit: "24",
    });

    try {
      const response = await fetch(`/api/search/mercado-livre?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao buscar ofertas.");
      setOffers(data.offers || []);
      setSearchWarning(data.warning || "");
      setSearchSource(data.source || "");
    } catch (error) {
      setSearchWarning(error.message);
    } finally {
      setSearchLoading(false);
    }
  }

  function openPrepare(offer) {
    setSelectedOffer(offer);
    setAffiliateUrl(offer.permalink || "");
    setPreparedMessage(buildOfferMessage({ offer, affiliateUrl: offer.permalink || "" }));
  }

  function updateAffiliateUrl(value) {
    setAffiliateUrl(value);
    if (selectedOffer) {
      setPreparedMessage(buildOfferMessage({ offer: selectedOffer, affiliateUrl: value }));
    }
  }

  async function persistPreparedOffer() {
    if (!selectedOffer || !affiliateUrl.trim()) {
      showToast("Informe o link que será usado na mensagem.");
      return;
    }

    setPrepareLoading(true);

    try {
      const { data: marketplace, error: marketplaceError } = await supabase
        .from("marketplaces")
        .select("id")
        .eq("slug", "mercado-livre")
        .single();
      if (marketplaceError) throw marketplaceError;

      const { data: product, error: productError } = await supabase
        .from("products")
        .upsert({
          user_id: session.user.id,
          marketplace_id: marketplace.id,
          external_id: selectedOffer.externalId,
          title: selectedOffer.title,
          permalink: selectedOffer.permalink,
          thumbnail_url: selectedOffer.thumbnailUrl,
          category_external_id: selectedOffer.categoryExternalId,
          seller_name: selectedOffer.sellerName,
          sold_quantity: selectedOffer.soldQuantity,
          raw: selectedOffer.raw || {},
          last_seen_at: new Date().toISOString(),
        }, { onConflict: "user_id,marketplace_id,external_id" })
        .select("id")
        .single();
      if (productError) throw productError;

      const { data: offerRow, error: offerError } = await supabase
        .from("offers")
        .insert({
          user_id: session.user.id,
          product_id: product.id,
          niche_id: selectedNicheId || null,
          current_price: selectedOffer.price,
          original_price: selectedOffer.originalPrice,
          discount_percent: selectedOffer.discountPercent,
          coupon_text: selectedOffer.couponText,
          shipping_free: selectedOffer.freeShipping,
          score: selectedOffer.score,
          status: "prepared",
          affiliate_url: affiliateUrl.trim(),
          raw: selectedOffer.raw || {},
        })
        .select("id")
        .single();
      if (offerError) throw offerError;

      const { error: messageError } = await supabase
        .from("generated_messages")
        .insert({
          user_id: session.user.id,
          offer_id: offerRow.id,
          template_key: "default_v1",
          message_text: preparedMessage,
        });
      if (messageError) throw messageError;

      showToast("Oferta e mensagem salvas.");
    } catch (error) {
      showToast(error.message || "Falha ao salvar.");
    } finally {
      setPrepareLoading(false);
    }
  }

  async function copyMessage() {
    await navigator.clipboard.writeText(preparedMessage);
    showToast("Mensagem copiada.");
  }

  function openWhatsApp() {
    const url = `https://wa.me/?text=${encodeURIComponent(preparedMessage)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  if (bootError) {
    return (
      <main className="centered">
        <div className="panel auth-panel">
          <div className="brand-mark">AO</div>
          <h1>Configuração necessária</h1>
          <p className="muted">{bootError}</p>
          <p className="muted">Copie <code>.env.example</code> para <code>.env.local</code> e preencha as variáveis.</p>
        </div>
      </main>
    );
  }

  if (!supabase || !session) {
    return (
      <main className="centered">
        <section className="panel auth-panel">
          <div className="brand-mark">AO</div>
          <span className="eyebrow">Afiliado Ofertas</span>
          <h1>Entre no painel</h1>
          <p className="muted">Busque oportunidades, prepare sua mensagem e envie manualmente no WhatsApp.</p>

          <form onSubmit={handleAuth} className="stack">
            <label>
              E-mail
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Senha
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
            </label>
            <button className="button primary" disabled={authLoading}>
              {authLoading ? "Aguarde..." : authMode === "login" ? "Entrar" : "Criar conta"}
            </button>
          </form>

          {authMessage && <div className="notice">{authMessage}</div>}

          <button className="text-button" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>
            {authMode === "login" ? "Primeiro acesso? Criar conta" : "Já tenho conta"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand-row">
            <div className="brand-mark small">AO</div>
            <div>
              <strong>Afiliado Ofertas</strong>
              <span>MVP local</span>
            </div>
          </div>

          <nav>
            <a className="nav-item active">🔥 Encontrar ofertas</a>
            <a className="nav-item disabled">💬 Mensagens salvas</a>
            <a className="nav-item disabled">📊 Histórico</a>
          </nav>
        </div>

        <div className="sidebar-footer">
          <span>{session.user.email}</span>
          <button className="text-button light" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <span className="eyebrow">Robô 1 + Robô 2</span>
            <h1>Caçador de ofertas</h1>
            <p className="muted">Escolha o nicho, encontre oportunidades e deixe a mensagem pronta para usar.</p>
          </div>
          <div className="status-chip"><span /> Localhost</div>
        </header>

        <section className="panel filters-panel">
          <div className="section-title-row">
            <div>
              <h2>Configurar busca</h2>
              <p className="muted">Mercado Livre é a primeira fonte do MVP.</p>
            </div>
            <span className="market-badge">Mercado Livre</span>
          </div>

          <div className="form-grid">
            <label>
              Nicho salvo
              <select value={selectedNicheId} onChange={(e) => {
                setSelectedNicheId(e.target.value);
                const item = niches.find((niche) => niche.id === e.target.value);
                if (item) {
                  setQuery(item.name);
                  setMinDiscount(item.min_discount);
                  setMinScore(item.min_score);
                }
              }}>
                <option value="">Sem nicho salvo</option>
                {niches.map((niche) => <option key={niche.id} value={niche.id}>{niche.name}</option>)}
              </select>
            </label>

            <label>
              Termo da busca
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ex.: ferramentas, beleza, games" />
            </label>

            <label>
              Desconto mínimo
              <div className="input-suffix"><input type="number" min="0" max="100" value={minDiscount} onChange={(e) => setMinDiscount(e.target.value)} /><span>%</span></div>
            </label>

            <label>
              Nota mínima
              <div className="input-suffix"><input type="number" min="0" max="100" value={minScore} onChange={(e) => setMinScore(e.target.value)} /><span>/100</span></div>
            </label>
          </div>

          <div className="inline-create">
            <input value={newNiche} onChange={(e) => setNewNiche(e.target.value)} placeholder="Salvar novo nicho, ex.: Ferramentas" />
            <button className="button secondary" onClick={createNiche}>Salvar nicho</button>
            <button className="button primary grow" onClick={searchOffers} disabled={searchLoading || query.trim().length < 2}>
              {searchLoading ? "Buscando..." : "🔎 Buscar ofertas"}
            </button>
          </div>
        </section>

        {searchWarning && (
          <div className={`notice ${searchSource === "demo" ? "warning" : ""}`}>
            <strong>{searchSource === "demo" ? "Modo de teste ativo." : "Aviso."}</strong> {searchWarning}
          </div>
        )}

        <div className="results-heading">
          <div>
            <h2>Ofertas encontradas</h2>
            <p className="muted">{offers.length ? `${offers.length} ofertas ordenadas por oportunidade.` : "Faça uma busca para começar."}</p>
          </div>
          {selectedNiche && <span className="tag">Nicho: {selectedNiche.name}</span>}
        </div>

        <section className="offers-grid">
          {offers.map((offer) => (
            <article className="offer-card" key={offer.externalId}>
              <div className="offer-media">
                {offer.thumbnailUrl ? <img src={offer.thumbnailUrl} alt="" /> : <div className="image-placeholder">OFERTA</div>}
                <span className="score-badge">{offer.score}/100</span>
              </div>
              <div className="offer-body">
                <div className="offer-meta">
                  <span>{Math.round(offer.discountPercent)}% OFF</span>
                  {offer.freeShipping && <span>Frete grátis</span>}
                </div>
                <h3>{offer.title}</h3>
                <div className="price-row">
                  <strong>{money(offer.price)}</strong>
                  {offer.originalPrice > offer.price && <del>{money(offer.originalPrice)}</del>}
                </div>
                <p className="muted small-text">{offer.soldQuantity ? `+${offer.soldQuantity.toLocaleString("pt-BR")} vendidos` : "Venda ainda sem histórico"}</p>
                <button className="button primary full" onClick={() => openPrepare(offer)}>Usar oferta</button>
              </div>
            </article>
          ))}
        </section>
      </section>

      {selectedOffer && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setSelectedOffer(null)}>
          <section className="modal">
            <div className="modal-header">
              <div>
                <span className="eyebrow">Robô 2</span>
                <h2>Mensagem pronta</h2>
              </div>
              <button className="icon-button" onClick={() => setSelectedOffer(null)}>×</button>
            </div>

            <div className="selected-offer-line">
              <div>
                <strong>{selectedOffer.title}</strong>
                <span>{money(selectedOffer.price)} · nota {selectedOffer.score}/100</span>
              </div>
            </div>

            <label>
              Link para usar na mensagem
              <input value={affiliateUrl} onChange={(e) => updateAffiliateUrl(e.target.value)} placeholder="Cole aqui o link de afiliado" />
              <small>Enquanto o gerador oficial de afiliados não estiver integrado, no teste local você pode usar o link comum do produto.</small>
            </label>

            <label>
              Mensagem
              <textarea rows="12" value={preparedMessage} onChange={(e) => setPreparedMessage(e.target.value)} />
            </label>

            <div className="modal-actions">
              <button className="button secondary" onClick={persistPreparedOffer} disabled={prepareLoading}>{prepareLoading ? "Salvando..." : "Salvar"}</button>
              <button className="button secondary" onClick={copyMessage}>Copiar mensagem</button>
              <button className="button whatsapp" onClick={openWhatsApp}>Abrir WhatsApp</button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
