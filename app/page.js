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

function formatDate(value) {
  if (!value) return "Ainda não testada";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
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

  const [activeView, setActiveView] = useState("offers");
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [shopeeConnection, setShopeeConnection] = useState(null);
  const [shopeeAppId, setShopeeAppId] = useState("");
  const [shopeeSecret, setShopeeSecret] = useState("");
  const [showShopeeForm, setShowShopeeForm] = useState(false);

  const [niches, setNiches] = useState([]);
  const [newNiche, setNewNiche] = useState("");
  const [selectedNicheId, setSelectedNicheId] = useState("");
  const [query, setQuery] = useState("ferramentas");
  const [minDiscount, setMinDiscount] = useState(0);
  const [minScore, setMinScore] = useState(50);
  const [offers, setOffers] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchWarning, setSearchWarning] = useState("");

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
    loadShopeeConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, session]);

  const selectedNiche = useMemo(
    () => niches.find((item) => item.id === selectedNicheId) || null,
    [niches, selectedNicheId]
  );

  const isShopeeConnected = shopeeConnection?.status === "connected";

  function apiHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    };
  }

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

  async function loadShopeeConnection() {
    try {
      const response = await fetch("/api/connections/shopee", {
        headers: apiHeaders(),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao carregar conexão Shopee.");
      setShopeeConnection(data.connection || null);
      if (data.connection?.account_identifier) setShopeeAppId(data.connection.account_identifier);
      if (!data.connected) {
        setShowShopeeForm(true);
        setActiveView("connections");
      }
    } catch (error) {
      showToast(error.message);
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

  async function saveShopeeConnection(event) {
    event?.preventDefault();
    if (!shopeeAppId.trim() || !shopeeSecret.trim()) {
      showToast("Informe o App ID e o Secret da Shopee.");
      return;
    }

    setConnectionLoading(true);
    try {
      const response = await fetch("/api/connections/shopee", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ appId: shopeeAppId.trim(), secret: shopeeSecret.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível validar a API Shopee.");

      setShopeeConnection(data.connection);
      setShopeeSecret("");
      setShowShopeeForm(false);
      showToast("Shopee conectada e validada.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setConnectionLoading(false);
    }
  }

  async function disconnectShopee() {
    setConnectionLoading(true);
    try {
      const response = await fetch("/api/connections/shopee", {
        method: "DELETE",
        headers: apiHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao desconectar Shopee.");
      setShopeeConnection(null);
      setShopeeSecret("");
      setShowShopeeForm(true);
      showToast("Shopee desconectada.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setConnectionLoading(false);
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
    if (!isShopeeConnected) {
      setActiveView("connections");
      showToast("Conecte a Shopee antes de buscar ofertas.");
      return;
    }

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
      const response = await fetch(`/api/search/shopee?${params.toString()}`, {
        headers: apiHeaders(),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao buscar ofertas.");
      setOffers(data.offers || []);
      if (!data.offers?.length) setSearchWarning("A busca foi concluída, mas nenhuma oferta passou pelos filtros atuais.");
    } catch (error) {
      setSearchWarning(error.message);
    } finally {
      setSearchLoading(false);
    }
  }

  function openPrepare(offer) {
    const link = offer.affiliateUrl || offer.permalink || "";
    setSelectedOffer(offer);
    setAffiliateUrl(link);
    setPreparedMessage(buildOfferMessage({ offer, affiliateUrl: link }));
  }

  function updateAffiliateUrl(value) {
    setAffiliateUrl(value);
    if (selectedOffer) {
      setPreparedMessage(buildOfferMessage({ offer: selectedOffer, affiliateUrl: value }));
    }
  }

  async function persistPreparedOffer() {
    if (!selectedOffer || !affiliateUrl.trim()) {
      showToast("A oferta precisa ter um link de afiliado.");
      return;
    }

    setPrepareLoading(true);

    try {
      const marketplaceSlug = selectedOffer.marketplaceSlug || "shopee";
      const { data: marketplace, error: marketplaceError } = await supabase
        .from("marketplaces")
        .select("id")
        .eq("slug", marketplaceSlug)
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
          rating: selectedOffer.rating || null,
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
          template_key: "shopee_default_v1",
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
    window.setTimeout(() => setToast(""), 3200);
  }

  if (bootError) {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <div className="logo-mark">A</div>
          <h1>Configuração necessária</h1>
          <p>{bootError}</p>
          <p>Execute <code>INICIAR_LOCAL.bat</code> para preparar o ambiente.</p>
        </div>
      </main>
    );
  }

  if (!supabase || !session) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="auth-brand">
            <div className="logo-mark">A</div>
            <div>
              <strong>Afiliado Ofertas</strong>
              <span>Seu radar de oportunidades</span>
            </div>
          </div>
          <div className="auth-copy">
            <span className="kicker">Automação para afiliados</span>
            <h1>Encontre. Prepare. Publique.</h1>
            <p>Centralize suas APIs, encontre produtos com potencial e gere mensagens prontas para compartilhar.</p>
          </div>

          <form onSubmit={handleAuth} className="auth-form">
            <label>
              E-mail
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Senha
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
            </label>
            <button className="btn btn-primary" disabled={authLoading}>
              {authLoading ? "Aguarde..." : authMode === "login" ? "Entrar no painel" : "Criar minha conta"}
            </button>
          </form>

          {authMessage && <div className="inline-alert">{authMessage}</div>}

          <button className="link-button" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>
            {authMode === "login" ? "Primeiro acesso? Criar conta" : "Já tenho uma conta"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar-new">
        <div>
          <div className="sidebar-brand">
            <div className="logo-mark small">A</div>
            <div>
              <strong>Afiliado Ofertas</strong>
              <span>Central de afiliados</span>
            </div>
          </div>

          <nav className="side-nav">
            <button className={activeView === "offers" ? "side-item active" : "side-item"} onClick={() => setActiveView("offers")}>
              <span className="side-icon">⌁</span>
              <span>Encontrar ofertas</span>
            </button>
            <button className={activeView === "connections" ? "side-item active" : "side-item"} onClick={() => setActiveView("connections")}>
              <span className="side-icon">↗</span>
              <span>Conexões</span>
              <span className={isShopeeConnected ? "nav-dot online" : "nav-dot"} />
            </button>
            <button className="side-item muted-item" disabled>
              <span className="side-icon">✦</span>
              <span>Mensagens</span>
              <small>em breve</small>
            </button>
            <button className="side-item muted-item" disabled>
              <span className="side-icon">◫</span>
              <span>Histórico</span>
              <small>em breve</small>
            </button>
          </nav>
        </div>

        <div className="sidebar-user">
          <div className="user-avatar">{session.user.email?.slice(0, 1).toUpperCase()}</div>
          <div className="user-copy">
            <strong>{session.user.email}</strong>
            <span>Conta local</span>
          </div>
          <button className="logout-button" title="Sair" onClick={() => supabase.auth.signOut()}>↪</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <span className="kicker">{activeView === "connections" ? "Integrações" : "Robô de ofertas"}</span>
            <h1>{activeView === "connections" ? "Conexões" : "Encontrar ofertas"}</h1>
            <p>{activeView === "connections"
              ? "Conecte suas contas e APIs para liberar as automações do painel."
              : "Busque produtos reais da Shopee, compare oportunidade e deixe a divulgação pronta."}</p>
          </div>
          <div className="environment-pill"><span /> localhost</div>
        </header>

        {activeView === "connections" ? (
          <div className="connections-view">
            <section className="connection-hero">
              <div>
                <span className="kicker light">Primeira integração</span>
                <h2>Shopee Affiliate API</h2>
                <p>A busca de produtos, comissões e links afiliados passa a sair diretamente da sua conta Shopee.</p>
              </div>
              <div className={isShopeeConnected ? "big-status connected" : "big-status"}>
                <span />
                {isShopeeConnected ? "Conectada" : "Não conectada"}
              </div>
            </section>

            <div className="connection-layout">
              <section className="connection-card main-connection-card">
                <div className="connection-card-head">
                  <div className="market-logo shopee-logo">S</div>
                  <div>
                    <h3>Shopee Afiliados</h3>
                    <p>Open API · Brasil · GraphQL</p>
                  </div>
                  <span className={isShopeeConnected ? "status-badge connected" : "status-badge"}>
                    {isShopeeConnected ? "Ativa" : "Pendente"}
                  </span>
                </div>

                {isShopeeConnected && !showShopeeForm ? (
                  <div className="connected-panel">
                    <div className="connection-facts">
                      <div>
                        <span>App ID</span>
                        <strong>{shopeeConnection.account_identifier}</strong>
                      </div>
                      <div>
                        <span>Último teste</span>
                        <strong>{formatDate(shopeeConnection.last_tested_at)}</strong>
                      </div>
                      <div>
                        <span>Secret</span>
                        <strong>••••••••••••••••</strong>
                      </div>
                    </div>
                    <div className="success-strip">
                      <span>✓</span>
                      <div>
                        <strong>Credenciais validadas</strong>
                        <p>A API está pronta para buscar ofertas e gerar links com seu rastreamento de afiliado.</p>
                      </div>
                    </div>
                    <div className="connection-actions">
                      <button className="btn btn-secondary" onClick={() => setShowShopeeForm(true)}>Atualizar credenciais</button>
                      <button className="btn btn-danger-ghost" onClick={disconnectShopee} disabled={connectionLoading}>Desconectar</button>
                    </div>
                  </div>
                ) : (
                  <form className="connection-form" onSubmit={saveShopeeConnection}>
                    <div className="form-intro">
                      <h4>{isShopeeConnected ? "Trocar credenciais" : "Conectar minha API"}</h4>
                      <p>Use o App ID e o Secret disponibilizados na Open API do programa de afiliados da Shopee.</p>
                    </div>
                    <div className="two-fields">
                      <label>
                        App ID
                        <input value={shopeeAppId} onChange={(e) => setShopeeAppId(e.target.value)} placeholder="Ex.: 123456789" autoComplete="off" />
                      </label>
                      <label>
                        Secret
                        <input type="password" value={shopeeSecret} onChange={(e) => setShopeeSecret(e.target.value)} placeholder="Cole o Secret da API" autoComplete="new-password" />
                      </label>
                    </div>
                    <div className="security-note">
                      <span>▣</span>
                      <p>O Secret é criptografado antes de ser salvo. Ele não fica exposto na interface nem é enviado para o GitHub.</p>
                    </div>
                    <div className="connection-actions">
                      {isShopeeConnected && <button type="button" className="btn btn-secondary" onClick={() => { setShowShopeeForm(false); setShopeeSecret(""); }}>Cancelar</button>}
                      <button className="btn btn-shopee" disabled={connectionLoading}>
                        {connectionLoading ? "Validando API..." : "Testar e conectar Shopee"}
                      </button>
                    </div>
                  </form>
                )}
              </section>

              <aside className="connection-side">
                <section className="mini-card">
                  <span className="mini-label">O que será liberado</span>
                  <ul className="check-list">
                    <li><span>✓</span> Busca real de produtos</li>
                    <li><span>✓</span> Comissão por produto</li>
                    <li><span>✓</span> Link afiliado automático</li>
                    <li><span>✓</span> Ranking de oportunidade</li>
                    <li><span>✓</span> Mensagem pronta para WhatsApp</li>
                  </ul>
                </section>
                <section className="mini-card soft-card">
                  <span className="mini-label">Próximas conexões</span>
                  <div className="upcoming-market"><span>ML</span><div><strong>Mercado Livre</strong><small>Planejado</small></div></div>
                  <div className="upcoming-market"><span>AZ</span><div><strong>Amazon</strong><small>Planejado</small></div></div>
                </section>
              </aside>
            </div>
          </div>
        ) : (
          <div className="offers-view">
            <section className="metric-row">
              <div className="metric-card">
                <span>Marketplace ativo</span>
                <strong>Shopee</strong>
                <small>Affiliate Open API</small>
              </div>
              <div className="metric-card">
                <span>Status da conexão</span>
                <strong className={isShopeeConnected ? "success-text" : "danger-text"}>{isShopeeConnected ? "Conectada" : "Pendente"}</strong>
                <small>{isShopeeConnected ? "Pronta para buscar" : "Configure em Conexões"}</small>
              </div>
              <div className="metric-card">
                <span>Ofertas na tela</span>
                <strong>{offers.length}</strong>
                <small>Ordenadas por score</small>
              </div>
            </section>

            {!isShopeeConnected && (
              <section className="connect-banner">
                <div className="market-logo shopee-logo">S</div>
                <div>
                  <strong>Conecte a Shopee para começar</strong>
                  <p>O painel agora trabalha com a API real de afiliados e precisa das suas credenciais.</p>
                </div>
                <button className="btn btn-shopee" onClick={() => setActiveView("connections")}>Ir para Conexões</button>
              </section>
            )}

            <section className="search-card">
              <div className="search-card-head">
                <div>
                  <span className="kicker">Radar de produtos</span>
                  <h2>O que vamos procurar hoje?</h2>
                  <p>A Shopee retorna produto, preço, comissão e link afiliado em uma única busca.</p>
                </div>
                <span className="api-badge"><span /> Shopee API</span>
              </div>

              <div className="search-grid">
                <label className="wide-field">
                  Palavra-chave
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ex.: air fryer, ferramentas, beleza, gamer" />
                </label>
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
                    <option value="">Sem nicho</option>
                    {niches.map((niche) => <option key={niche.id} value={niche.id}>{niche.name}</option>)}
                  </select>
                </label>
                <label>
                  Desconto mínimo
                  <div className="suffix-input"><input type="number" min="0" max="100" value={minDiscount} onChange={(e) => setMinDiscount(e.target.value)} /><span>%</span></div>
                </label>
                <label>
                  Score mínimo
                  <div className="suffix-input"><input type="number" min="0" max="100" value={minScore} onChange={(e) => setMinScore(e.target.value)} /><span>/100</span></div>
                </label>
              </div>

              <div className="search-footer">
                <div className="save-niche-line">
                  <input value={newNiche} onChange={(e) => setNewNiche(e.target.value)} placeholder="Nome para salvar este nicho" />
                  <button className="btn btn-secondary" onClick={createNiche} type="button">Salvar nicho</button>
                </div>
                <button className="btn btn-shopee search-button" onClick={searchOffers} disabled={searchLoading || query.trim().length < 2 || !isShopeeConnected}>
                  {searchLoading ? "Buscando na Shopee..." : "Buscar ofertas"}
                </button>
              </div>
            </section>

            {searchWarning && <div className="inline-alert warning">{searchWarning}</div>}

            <section className="results-section">
              <div className="results-head">
                <div>
                  <span className="kicker">Resultados</span>
                  <h2>Melhores oportunidades</h2>
                  <p>{offers.length ? `${offers.length} produtos encontrados depois dos filtros.` : "Faça uma busca para preencher o radar."}</p>
                </div>
                {selectedNiche && <span className="niche-pill">{selectedNiche.name}</span>}
              </div>

              <div className="offer-grid-new">
                {offers.map((offer) => (
                  <article className="offer-card-new" key={offer.externalId}>
                    <div className="offer-image">
                      {offer.thumbnailUrl ? <img src={offer.thumbnailUrl} alt="" /> : <div className="image-fallback">S</div>}
                      <span className="score-pill">{offer.score}/100</span>
                    </div>
                    <div className="offer-content">
                      <div className="offer-badges">
                        {offer.discountPercent > 0 && <span className="discount-pill">-{Math.round(offer.discountPercent)}%</span>}
                        {offer.commissionRate > 0 && <span className="commission-pill">Comissão {offer.commissionRate}%</span>}
                      </div>
                      <h3>{offer.title}</h3>
                      <div className="seller-line"><span>{offer.sellerName || "Shopee"}</span><span>★ {Number(offer.rating || 0).toFixed(1)}</span></div>
                      <div className="price-block">
                        <strong>{money(offer.price)}</strong>
                        {offer.originalPrice > offer.price && <del>{money(offer.originalPrice)}</del>}
                      </div>
                      <div className="offer-stats">
                        <span>{offer.soldQuantity ? `+${offer.soldQuantity.toLocaleString("pt-BR")} vendidos` : "Sem histórico de vendas"}</span>
                        <span>Link afiliado ✓</span>
                      </div>
                      <button className="btn btn-dark full" onClick={() => openPrepare(offer)}>Usar esta oferta</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
      </section>

      {selectedOffer && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setSelectedOffer(null)}>
          <section className="prepare-modal">
            <div className="prepare-modal-head">
              <div>
                <span className="kicker">Robô 2</span>
                <h2>Oferta pronta para usar</h2>
                <p>O link abaixo já veio da API de afiliados da Shopee.</p>
              </div>
              <button className="close-button" onClick={() => setSelectedOffer(null)}>×</button>
            </div>

            <div className="selected-product">
              {selectedOffer.thumbnailUrl && <img src={selectedOffer.thumbnailUrl} alt="" />}
              <div>
                <strong>{selectedOffer.title}</strong>
                <span>{money(selectedOffer.price)} · score {selectedOffer.score}/100 · comissão {selectedOffer.commissionRate || 0}%</span>
              </div>
            </div>

            <label>
              Link de afiliado
              <input value={affiliateUrl} onChange={(e) => updateAffiliateUrl(e.target.value)} />
              <small>Você ainda pode editar o link antes de gerar a divulgação final.</small>
            </label>

            <label>
              Mensagem pronta
              <textarea rows="12" value={preparedMessage} onChange={(e) => setPreparedMessage(e.target.value)} />
            </label>

            <div className="modal-actions-new">
              <button className="btn btn-secondary" onClick={persistPreparedOffer} disabled={prepareLoading}>{prepareLoading ? "Salvando..." : "Salvar oferta"}</button>
              <button className="btn btn-dark" onClick={copyMessage}>Copiar mensagem</button>
              <button className="btn btn-whatsapp" onClick={openWhatsApp}>Abrir WhatsApp</button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast-new">{toast}</div>}
    </main>
  );
}
