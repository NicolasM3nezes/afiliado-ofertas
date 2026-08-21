import DashboardClient from "./DashboardClient";

export default function Page() {
  return (
    <>
      <DashboardClient />
      <a className="history-shortcut" href="/history" aria-label="Abrir histórico">◫ Histórico</a>
    </>
  );
}
