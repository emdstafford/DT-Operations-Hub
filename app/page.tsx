import DashboardHub from "@/components/DashboardHub";
import DashboardReportActions from "@/components/DashboardReportActions";

export default function HomePage() {
  return <main className="page-shell">
    <header className="hub-header">
      <div><p className="eyebrow">DT Operations Command Center</p><h1>What needs your attention?</h1><p>Filter the complete operating picture by date, supervisor, or contract. Select more than one to compare combined performance without double-counting loads.</p></div>
      <DashboardReportActions />
    </header>
    <DashboardHub />
  </main>;
}
