import DashboardClient from "./DashboardClient";

export default function Page() {
  return (
    <>
      <DashboardClient />
      <div className="dashboard-shortcuts">
        <a className="groups-shortcut" href="/groups" aria-label="Abrir central de grupos">◉ Grupos e fila</a>
        <a className="history-shortcut" href="/history" aria-label="Abrir histórico">◫ Histórico</a>
      </div>
    </>
  );
}
