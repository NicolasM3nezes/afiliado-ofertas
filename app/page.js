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

  const [shopeeLoading, setShopeeLoading] = useState(false);
  const [shopeeConnection, setShopeeConnection] = useState(null);
  const [shopeeAppId, setShopeeAppId] = useState("");
  const [shopeeSecret, setShopeeSecret] = useState("");
  const [showShopeeForm, setShowShopeeForm] = useState(false);

  const [mercadoLoading, setMercadoLoading] = useState(false);
  const [mercadoConnection, setMercadoConnection] = useState(null);
  const [mercadoClientId, setMercadoClientId] = useState("");
  const [mercadoClientSecret, setMercadoClientSecret] = useState("");
  const [mercadoRedirectUri, setMercadoRedirectUri] = useState("");
  const [showMercadoForm, setShowMercadoForm] = useState(false);

  const [niches, setNiches] = useState([]);
  const [newNiche, setNewNiche] = useState("");
  const [selectedNicheId, setSelectedNicheId] = useState("");
  const [query, setQuery] = useState("ferramentas");
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
    loadMercadoConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, session]);

  const selectedNiche = useMemo(
    () => niches.find((item) => item.id === selectedNicheId) || null,
    [niches, selectedNicheId]
  );

  const isShopeeConnected = shopeeConnection?.status === "connected";
  const isMercadoConfigured = Boolean(mercadoConnection);
  const isMercadoConnected = mercadoConnection?.status === "connected";
  const configuredCount = Number(isShopeeConnected) + Number(isMercadoConfigured);

  function apiHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    };
  }

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function loadNiches() {
    const { data, error } = await supabase
      .from("niches")
      .select("id,name,slug")
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
      if (!data.connected) setShowShopeeForm(true);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function loadMercadoConnection() {
    try {
      const response = await fetch("/api/connections/mercado-livre", {
        headers: apiHeaders(),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao carregar Mercado Livre.");

      setMercadoConnection(data.connection || null);
      if (data.connection?.account_identifier) setMercadoClientId(data.connection.account_identifier);
      if (data.connection?.redirect_uri) setMercadoRedirectUri(data.connection.redirect_uri);
      setShowMercadoForm(!data.configured);
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

    setShopeeLoading(true);
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
      showToast("Shopee conectada e salva no banco.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setShopeeLoading(false);
    }
  }

  async function disconnectShopee() {
    setShopeeLoading(true);
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
      showToast("Shopee removida do banco.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setShopeeLoading(false);
    }
  }

  async function saveMercadoConnection(event) {
    event?.preventDefault();
    if (!mercadoClientId.trim() || !mercadoClientSecret.trim() || !mercadoRedirectUri.trim()) {
      showToast("Informe Client ID, Client Secret e Redirect URI do Mercado Livre.");
      return;
    }

    setMercadoLoading(true);
    try {
      const response = await fetch("/api/connections/mercado-livre", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          clientId: mercadoClientId.trim(),
          clientSecret: mercadoClientSecret.trim(),
          redirectUri: mercadoRedirectUri.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar Mercado Livre.");

      setMercadoConnection(data.connection);
      setMercadoClientSecret("");
      setShowMercadoForm(false);
      showToast("Configuração do Mercado Livre salva no banco.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setMercadoLoading(false);
    }
  }

  async function disconnectMercado() {
    setMercadoLoading(true);
    try {
      const response = await fetch("/api/connections/mercado-livre", {
        method: "DELETE",
        headers: apiHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao remover Mercado Livre.");

      setMercadoConnection(null);
      setMercadoClientSecret("");
      setShowMercadoForm(true);
      showToast("Configuração do Mercado Livre removida do banco.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setMercadoLoading(false);
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
        min_discount: 0,
        min_score: 0,
      })
      .select("id,name,slug")
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

    const params = new URLSearchParams({ query });

    try {
      const response = await fetch(`/api/search/shopee?${params.toString()}`, {
        headers: apiHeaders(),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao buscar ofertas.");
      setOffers(data.offers || []);
      setSearchWarning(data.warning || "");
      if (!data.offers?.length && !data.warning) {
        setSearchWarning("Nenhum produto forte o suficiente foi encontrado para essa palavra-chave.");
      }
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
              <span className={configuredCount > 0 ? "nav-dot online" : "nav-dot"} />
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
              ? "Configure seus marketplaces. Credenciais e status ficam salvos no Supabase."
              : "Busque os melhores produtos da Shopee e deixe a divulgação pronta."}</p>
          </div>
          <div className="environment-pill"><span /> localhost</div>
        </header>

        {activeView === "connections" ? (
          <div className="connections-view">
            <section className="connection-hero">
              <div>
                <span className="kicker light">Central de integrações</span>
                <h2>Shopee + Mercado Livre</h2>
                <p>Configure as credenciais uma vez. O painel salva tudo no banco e reutiliza as conexões nas automações.</p>
              </div>
              <div className={configuredCount > 0 ? "big-status connected" : "big-status"}>
                <span />
                {configuredCount}/2 configuradas
              </div>
            </section>

            <section className="connections-summary">
              <div className="connection-summary-card">
                <span>Shopee Afiliados</span>
                <strong className={isShopeeConnected ? "success-text" : "danger-text"}>{isShopeeConnected ? "Conectada" : "Pendente"}</strong>
                <small>{isShopeeConnected ? "API validada" : "Informe App ID e Secret"}</small>
              </div>
              <div className="connection-summary-card">
                <span>Mercado Livre</span>
                <strong className={isMercadoConfigured ? "success-text" : "danger-text"}>{isMercadoConnected ? "Conectado" : isMercadoConfigured ? "Configurado" : "Pendente"}</strong>
                <small>{isMercadoConfigured ? "Aplicação OAuth salva" : "Informe credenciais do app"}</small>
              </div>
              <div className="connection-summary-card">
                <span>Segurança</span>
                <strong>Criptografado</strong>
                <small>Secrets nunca retornam ao navegador</small>
              </div>
            </section>

            <div className="connection-cards-grid">
              <section className="connection-card market-card">
                <div className="connection-card-head">
                  <div className="market-logo shopee-logo">S</div>
                  <div>
                    <h3>Shopee Afiliados</h3>
                    <p>Affiliate Open API · Brasil</p>
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
                        <strong>Credenciais validadas e salvas</strong>
                        <p>A API está pronta para buscar produtos, comissões e links de afiliado.</p>
                      </div>
                    </div>

                    <div className="connection-actions">
                      <button className="btn btn-secondary" onClick={() => setShowShopeeForm(true)}>Atualizar</button>
                      <button className="btn btn-danger-ghost" onClick={disconnectShopee} disabled={shopeeLoading}>Remover</button>
                    </div>
                  </div>
                ) : (
                  <form className="connection-form" onSubmit={saveShopeeConnection}>
                    <div className="form-intro">
                      <h4>{isShopeeConnected ? "Trocar credenciais" : "Conectar Shopee"}</h4>
                      <p>Use o App ID e o Secret da Affiliate Open API.</p>
                    </div>

                    <div className="two-fields">
                      <label>
                        App ID
                        <input value={shopeeAppId} onChange={(e) => setShopeeAppId(e.target.value)} placeholder="App ID da Shopee" autoComplete="off" />
                      </label>
                      <label>
                        Secret
                        <input type="password" value={shopeeSecret} onChange={(e) => setShopeeSecret(e.target.value)} placeholder="Secret da API" autoComplete="new-password" />
                      </label>
                    </div>

                    <div className="security-note">
                      <span>▣</span>
                      <p>O Secret é testado na Shopee e criptografado antes de ser salvo no Supabase.</p>
                    </div>

                    <div className="connection-actions">
                      {isShopeeConnected && (
                        <button type="button" className="btn btn-secondary" onClick={() => { setShowShopeeForm(false); setShopeeSecret(""); }}>
                          Cancelar
                        </button>
                      )}
                      <button className="btn btn-shopee" disabled={shopeeLoading}>
                        {shopeeLoading ? "Validando..." : "Testar e salvar Shopee"}
                      </button>
                    </div>
                  </form>
                )}
              </section>

              <section className="connection-card market-card">
                <div className="connection-card-head">
                  <div className="market-logo ml-logo">ML</div>
                  <div>
                    <h3>Mercado Livre</h3>
                    <p>OAuth 2.0 · Authorization Code + PKCE</p>
                  </div>
                  <span className={isMercadoConnected ? "status-badge connected" : isMercadoConfigured ? "status-badge configured" : "status-badge"}>
                    {isMercadoConnected ? "Ativa" : isMercadoConfigured ? "Configurado" : "Pendente"}
                  </span>
                </div>

                {isMercadoConfigured && !showMercadoForm ? (
                  <div className="connected-panel">
                    <div className="connection-facts two">
                      <div>
                        <span>Client ID</span>
                        <strong>{mercadoConnection.account_identifier}</strong>
                      </div>
                      <div>
                        <span>Client Secret</span>
                        <strong>••••••••••••••••</strong>
                      </div>
                      <div className="wide-fact">
                        <span>Redirect URI</span>
                        <strong>{mercadoConnection.redirect_uri}</strong>
                      </div>
                    </div>

                    <div className="mercado-strip">
                      <span>✓</span>
                      <div>
                        <strong>Aplicação OAuth salva no banco</strong>
                        <p>{isMercadoConnected
                          ? "A conta Mercado Livre já está autorizada."
                          : "Credenciais prontas. A próxima etapa será autorizar a conta Mercado Livre e salvar access/refresh token."}</p>
                      </div>
                    </div>

                    <div className="connection-actions">
                      <button className="btn btn-secondary" onClick={() => setShowMercadoForm(true)}>Atualizar</button>
                      <button className="btn btn-danger-ghost" onClick={disconnectMercado} disabled={mercadoLoading}>Remover</button>
                    </div>
                  </div>
                ) : (
                  <form className="connection-form" onSubmit={saveMercadoConnection}>
                    <div className="form-intro">
                      <h4>{isMercadoConfigured ? "Trocar credenciais" : "Configurar Mercado Livre"}</h4>
                      <p>Copie os dados da aplicação criada no portal de desenvolvedores do Mercado Livre.</p>
                    </div>

                    <div className="three-fields">
                      <label>
                        Client ID / APP ID
                        <input value={mercadoClientId} onChange={(e) => setMercadoClientId(e.target.value)} placeholder="Client ID do Mercado Livre" autoComplete="off" />
                      </label>
                      <label>
                        Client Secret
                        <input type="password" value={mercadoClientSecret} onChange={(e) => setMercadoClientSecret(e.target.value)} placeholder="Client Secret" autoComplete="new-password" />
                      </label>
                      <label className="wide-field">
                        Redirect URI
                        <input value={mercadoRedirectUri} onChange={(e) => setMercadoRedirectUri(e.target.value)} placeholder="https://seu-dominio.com/api/mercado-livre/callback" autoComplete="off" />
                        <small>Use exatamente a mesma URL HTTPS cadastrada no app do Mercado Livre.</small>
                      </label>
                    </div>

                    <div className="security-note">
                      <span>▣</span>
                      <p>O Client Secret é criptografado antes de ser salvo. PKCE e os dados de OAuth ficam registrados no metadata da conexão.</p>
                    </div>

                    <div className="connection-actions">
                      {isMercadoConfigured && (
                        <button type="button" className="btn btn-secondary" onClick={() => { setShowMercadoForm(false); setMercadoClientSecret(""); }}>
                          Cancelar
                        </button>
                      )}
                      <button className="btn btn-mercado" disabled={mercadoLoading}>
                        {mercadoLoading ? "Salvando..." : "Salvar Mercado Livre"}
                      </button>
                    </div>
                  </form>
                )}
              </section>
            </div>

            <div className="connection-note">
              <strong>Como fica no banco:</strong> cada usuário tem uma linha por marketplace e tipo de conexão. Os identificadores ficam disponíveis para a aplicação, enquanto Secrets são armazenados criptografados. O Mercado Livre fica com status <strong>pending</strong> até concluirmos a autorização OAuth da conta.
            </div>
          </div>
        ) : (
          <div className="offers-view">
            <section className="metric-row">
              <div className="metric-card">
                <span>Fonte de ofertas</span>
                <strong>Shopee</strong>
                <small>Affiliate Open API</small>
              </div>
              <div className="metric-card">
                <span>Integrações configuradas</span>
                <strong>{configuredCount}/2</strong>
                <small>Shopee + Mercado Livre</small>
              </div>
              <div className="metric-card">
                <span>Ofertas na tela</span>
                <strong>{offers.length}</strong>
                <small>Melhores produtos encontrados</small>
              </div>
            </section>

            {!isShopeeConnected && (
              <section className="connect-banner">
                <div className="market-logo shopee-logo">S</div>
                <div>
                  <strong>Conecte a Shopee para buscar ofertas</strong>
                  <p>O Mercado Livre pode ser configurado agora, mas a busca atual continua usando a Shopee.</p>
                </div>
                <button className="btn btn-shopee" onClick={() => setActiveView("connections")}>Ir para Conexões</button>
              </section>
            )}

            <section className="search-card">
              <div className="search-card-head">
                <div>
                  <span className="kicker">Radar de produtos</span>
                  <h2>Qual produto vamos procurar?</h2>
                  <p>Digite a palavra-chave. O sistema filtra e ordena automaticamente os produtos mais fortes.</p>
                </div>
                <span className="api-badge"><span /> Shopee API</span>
              </div>

              <div className="search-grid compact-search-grid">
                <label className="wide-field">
                  Palavra-chave
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ex.: fone bluetooth, air fryer, ferramentas" />
                </label>
                <label>
                  Nicho salvo
                  <select value={selectedNicheId} onChange={(e) => {
                    setSelectedNicheId(e.target.value);
                    const item = niches.find((niche) => niche.id === e.target.value);
                    if (item) setQuery(item.name);
                  }}>
                    <option value="">Sem nicho</option>
                    {niches.map((niche) => <option key={niche.id} value={niche.id}>{niche.name}</option>)}
                  </select>
                </label>
              </div>

              <div className="search-footer">
                <div className="save-niche-line">
                  <input value={newNiche} onChange={(e) => setNewNiche(e.target.value)} placeholder="Nome para salvar este nicho" />
                  <button className="btn btn-secondary" onClick={createNiche} type="button">Salvar nicho</button>
                </div>
                <button className="btn btn-shopee search-button" onClick={searchOffers} disabled={searchLoading || query.trim().length < 2 || !isShopeeConnected}>
                  {searchLoading ? "Buscando melhores produtos..." : "Buscar melhores produtos"}
                </button>
              </div>
            </section>

            {searchWarning && <div className="inline-alert warning">{searchWarning}</div>}

            <section className="results-section">
              <div className="results-head">
                <div>
                  <span className="kicker">Resultados</span>
                  <h2>Melhores oportunidades</h2>
                  <p>{offers.length ? `${offers.length} produtos qualificados e ordenados por oportunidade.` : "Faça uma busca para preencher o radar."}</p>
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
                        {offer.qualityLabel && <span className="commission-pill">{offer.qualityLabel}</span>}
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
                <p>O link abaixo veio da API de afiliados da Shopee.</p>
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
              <small>Você ainda pode editar o link antes da divulgação final.</small>
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
