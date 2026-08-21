"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./AppShell.module.css";

const NAV_SECTIONS = [
  {
    label: "Principal",
    items: [
      { key: "offers", href: "/", icon: "⌁", label: "Radar de ofertas", description: "Buscar produtos" },
      { key: "today", href: "/groups/today", icon: "▶", label: "Operação do Dia", description: "Publicar em sequência", featured: true },
      { key: "connections", href: "/?view=connections", icon: "↗", label: "Conexões", description: "Shopee e Mercado Livre" },
    ],
  },
  {
    label: "Grupos",
    items: [
      { key: "groups", href: "/groups", icon: "◉", label: "Central de grupos", description: "Fila e perfis" },
      { key: "group-radar", href: "/groups/radar", icon: "⌕", label: "Radar do grupo", description: "Buscar por público" },
      { key: "setup", href: "/groups/setup", icon: "+", label: "Configuração rápida", description: "Presets prontos" },
    ],
  },
  {
    label: "Produção",
    items: [
      { key: "creative", href: "/groups/creative", icon: "▣", label: "Criativos", description: "Cards para oferta" },
      { key: "history", href: "/history", icon: "◫", label: "Histórico", description: "Buscas e publicações" },
    ],
  },
  {
    label: "Análise",
    items: [
      { key: "insights", href: "/groups/insights", icon: "↗", label: "Insights", description: "Desempenho e comissão" },
      { key: "health", href: "/groups/health", icon: "!", label: "Central de problemas", description: "O que precisa de atenção" },
    ],
  },
];

const PAGE_META = {
  "/": { eyebrow: "Radar multi-marketplace", title: "Encontrar ofertas" },
  "/groups": { eyebrow: "Gestão de grupos", title: "Central de grupos" },
  "/groups/today": { eyebrow: "Fluxo diário", title: "Operação do Dia" },
  "/groups/radar": { eyebrow: "Descoberta segmentada", title: "Radar do Grupo" },
  "/groups/setup": { eyebrow: "Comece rápido", title: "Configuração rápida" },
  "/groups/creative": { eyebrow: "Produção", title: "Criativos" },
  "/groups/insights": { eyebrow: "Análise", title: "Insights" },
  "/groups/health": { eyebrow: "Monitoramento", title: "Central de problemas" },
  "/history": { eyebrow: "Inteligência operacional", title: "Histórico" },
};

export default function AppShell({ children, session: providedSession = null, activeSection = "" }) {
  const pathname = usePathname();
  const [session, setSession] = useState(providedSession);
  const [sessionChecked, setSessionChecked] = useState(Boolean(providedSession));
  const [menuOpen, setMenuOpen] = useState(false);
  const [rootView, setRootView] = useState("");

  useEffect(() => {
    if (providedSession) {
      setSession(providedSession);
      setSessionChecked(true);
      return;
    }

    let mounted = true;
    try {
      const supabase = getSupabaseBrowserClient();
      supabase.auth.getSession().then(({ data }) => {
        if (!mounted) return;
        setSession(data.session || null);
        setSessionChecked(true);
      });
      const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        if (!mounted) return;
        setSession(nextSession || null);
        setSessionChecked(true);
      });
      return () => {
        mounted = false;
        listener.subscription.unsubscribe();
      };
    } catch {
      setSessionChecked(true);
    }
  }, [providedSession]);

  useEffect(() => {
    setMenuOpen(false);
    if (pathname !== "/") {
      setRootView("");
      return;
    }
    const view = new URLSearchParams(window.location.search).get("view") || "";
    setRootView(view);

    if (view === "connections") {
      const timer = window.setInterval(() => {
        const connectionButton = document.querySelector(".sidebar-new .side-nav .side-item:nth-child(2)");
        if (!connectionButton) return;
        connectionButton.click();
        window.clearInterval(timer);
      }, 50);
      const timeout = window.setTimeout(() => window.clearInterval(timer), 2500);
      return () => {
        window.clearInterval(timer);
        window.clearTimeout(timeout);
      };
    }
  }, [pathname, session]);

  const resolvedActiveSection = activeSection || (pathname === "/" && rootView === "connections" ? "connections" : "");

  const pageMeta = useMemo(() => {
    if (pathname === "/" && resolvedActiveSection === "connections") {
      return { eyebrow: "Integrações", title: "Conexões" };
    }
    return PAGE_META[pathname] || { eyebrow: "Afiliado Ofertas", title: "Central de afiliados" };
  }, [pathname, resolvedActiveSection]);

  function isActive(item) {
    if (resolvedActiveSection) return item.key === resolvedActiveSection;
    if (item.key === "offers") return pathname === "/";
    if (item.key === "groups") return pathname === "/groups";
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  async function signOut() {
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
    } finally {
      window.location.replace("/");
    }
  }

  if (!sessionChecked && !providedSession) {
    return <div className={styles.loading}>Carregando painel...</div>;
  }

  if (!session && !providedSession) {
    return children;
  }

  const email = session?.user?.email || "Conta";
  const initial = email.slice(0, 1).toUpperCase();

  return (
    <div className={styles.shell}>
      <button
        className={menuOpen ? styles.backdropOpen : styles.backdrop}
        aria-label="Fechar menu"
        onClick={() => setMenuOpen(false)}
      />

      <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.sidebarTop}>
          <a className={styles.brand} href="/" aria-label="Afiliado Ofertas">
            <span className={styles.brandMark}>A</span>
            <span className={styles.brandCopy}>
              <strong>Afiliado Ofertas</strong>
              <small>Central de afiliados</small>
            </span>
          </a>

          <nav className={styles.navigation} aria-label="Navegação principal">
            {NAV_SECTIONS.map((section) => (
              <div className={styles.navSection} key={section.label}>
                <span className={styles.sectionLabel}>{section.label}</span>
                <div className={styles.navItems}>
                  {section.items.map((item) => (
                    <a
                      key={item.key}
                      href={item.href}
                      className={`${styles.navItem} ${isActive(item) ? styles.navItemActive : ""} ${item.featured ? styles.navItemFeatured : ""}`}
                      onClick={() => setMenuOpen(false)}
                    >
                      <span className={styles.navIcon}>{item.icon}</span>
                      <span className={styles.navCopy}>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                      {isActive(item) && <span className={styles.activeMark} />}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>

        <div className={styles.sidebarBottom}>
          <div className={styles.systemState}>
            <span className={styles.onlineDot} />
            <span><strong>Sistema online</strong><small>Ambiente de produção</small></span>
          </div>
          <div className={styles.userCard}>
            <span className={styles.avatar}>{initial}</span>
            <span className={styles.userCopy}><strong>{email}</strong><small>Conta conectada</small></span>
            <button type="button" className={styles.logout} onClick={signOut} title="Sair">↪</button>
          </div>
        </div>
      </aside>

      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button className={styles.menuButton} type="button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu">☰</button>
            <div className={styles.pageIdentity}>
              <span>{pageMeta.eyebrow}</span>
              <strong>{pageMeta.title}</strong>
            </div>
          </div>
          <div className={styles.topbarRight}>
            <a className={styles.quickAction} href="/groups/today">▶ <span>Operação do Dia</span></a>
            <span className={styles.livePill}><i /> Online</span>
          </div>
        </header>

        <div className={`${styles.content} app-shell-content`}>
          <div className={styles.contentInner}>{children}</div>
        </div>
      </div>
    </div>
  );
}
