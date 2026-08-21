import GroupOperationsClient from "./GroupOperationsClient";

export const metadata = {
  title: "Grupos de Ofertas · Afiliado Ofertas",
};

const navStyle = {
  position: "fixed",
  left: 18,
  bottom: 18,
  zIndex: 50,
  display: "flex",
  gap: 7,
  flexWrap: "wrap",
  maxWidth: 760,
};

const linkStyle = {
  background: "#fff",
  color: "#17191d",
  border: "1px solid #dfe2e7",
  borderRadius: 999,
  padding: "9px 12px",
  textDecoration: "none",
  font: "800 11px Arial, sans-serif",
  boxShadow: "0 8px 24px rgba(0,0,0,.10)",
};

export default function GroupsPage() {
  return (
    <>
      <GroupOperationsClient />
      <nav style={navStyle} aria-label="Ferramentas dos grupos">
        <a style={{ ...linkStyle, background: "#202329", color: "#fff", borderColor: "#202329" }} href="/groups/today">▶ Operação do Dia</a>
        <a style={{ ...linkStyle, background: "#ff6b00", color: "#fff", borderColor: "#ff6b00" }} href="/groups/radar">⌁ Radar do Grupo</a>
        <a style={linkStyle} href="/groups/creative">▣ Criativos</a>
        <a style={linkStyle} href="/groups/insights">↗ Insights</a>
      </nav>
    </>
  );
}
