import DashboardHub from "@/components/DashboardHub";
import DashboardReportActions from "@/components/DashboardReportActions";

export default function HomePage() {
  return <main className="page-shell">
    <header className="hub-header">
      <div><p className="eyebrow">DT Operations Command Center</p><h1>What needs your attention?</h1><p>Filter the complete operating picture by date, supervisor, or contract. Select more than one to compare combined performance without double-counting loads.</p></div>
      <DashboardReportActions />
    </header>
    <DashboardHub />
    <section className="future-operations panel">
      <div><p className="eyebrow">Growing operations workspace</p><h2>Reporting is the foundation—not the finish line.</h2><p>This command center is being structured for contract extraction, simplified schedules, truck requirements and movement, TRM rates, and bid planning.</p></div>
      <div className="future-tags"><span>Contract schedules</span><span>Truck planning</span><span>TRM rates</span><span>Bid analysis</span></div>
    </section>
  </main>;
}
