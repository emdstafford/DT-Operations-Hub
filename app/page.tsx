import DashboardHub from "@/components/DashboardHub";
import DashboardReportActions from "@/components/DashboardReportActions";

export default function HomePage() {
  return <main className="page-shell dashboard-page operations-polish ops-dashboard-unified">
    <header className="hub-header">
      <div><p className="eyebrow">DT Intelligence Hub</p><h1>Operations Dashboard</h1><p>Monitor USPS performance, investigate missed stops, and review contracts.</p></div>
      <DashboardReportActions />
    </header>
    <DashboardHub />
  </main>;
}
