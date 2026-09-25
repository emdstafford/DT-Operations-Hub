import DashboardHub from "@/components/DashboardHub";
import DashboardReportActions from "@/components/DashboardReportActions";

export default function HomePage() {
  return <main className="page-shell dashboard-page">
    <header className="hub-header">
      <div><p className="eyebrow">DT Intelligence Hub</p><h1>Operations dashboard</h1></div>
      <DashboardReportActions />
    </header>
    <DashboardHub />
  </main>;
}
