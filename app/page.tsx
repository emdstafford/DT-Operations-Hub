import Link from "next/link";
import DashboardHub from "@/components/DashboardHub";
import DashboardReportActions from "@/components/DashboardReportActions";

export default function HomePage() {
  return <main className="page-shell dashboard-page">
    <header className="hub-header">
      <div><p className="eyebrow">DT Intelligence Hub</p><h1>Operations dashboard</h1></div>
      <DashboardReportActions />
    </header>

    <Link href="/reports" className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, marginBottom: 18, padding: "17px 20px", borderRadius: 14, background: "linear-gradient(135deg,#0f2747,#173a67)", color: "#fff", textDecoration: "none", boxShadow: "0 7px 20px rgba(15,39,71,.14)" }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, opacity: .72, letterSpacing: ".09em" }}>REPORTS</div>
        <div style={{ fontSize: 20, fontWeight: 850, marginTop: 3 }}>Reports Center</div>
        <div style={{ fontSize: 13, opacity: .84, marginTop: 3 }}>Find, compare, print, or export operational, contract, fuel, and payroll reports.</div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>→</div>
    </Link>

    <DashboardHub />
  </main>;
}
