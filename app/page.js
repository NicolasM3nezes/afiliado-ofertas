import DashboardClient from "./DashboardClient";

export default function Page() {
  return (
    <>
      <DashboardClient />
      <div className="dashboard-shortcuts">
        <a className="today-shortcut" href="/groups/today" aria-label="Abrir operação do dia">▶ Operação do Dia</a>
        <a className="groups-shortcut" href="/groups" aria-label="Abrir central de grupos">◉ Grupos e fila</a>
        <a className="history-shortcut" href="/history" aria-label="Abrir histórico">◫ Histórico</a>
      </div>
    </>
  );
}
