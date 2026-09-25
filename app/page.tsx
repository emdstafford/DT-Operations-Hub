import DashboardHub from "@/components/DashboardHub";
import DashboardReportActions from "@/components/DashboardReportActions";

export default function HomePage() {
  return <main className="page-shell">
    <header className="hub-header">
      <div><p className="eyebrow">DT Intelligence Hub</p><h1>Operations dashboard</h1><p>See Gary&apos;s report totals and fuel items worth checking for the dates you choose.</p></div>
      <DashboardReportActions />
    </header>
    <DashboardHub />
  </main>;
}
