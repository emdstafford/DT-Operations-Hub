import Link from "next/link";
import DashboardHub from "@/components/DashboardHub";
import DashboardReportActions from "@/components/DashboardReportActions";

export default function HomePage() {
  return <main className="page-shell dashboard-page operations-polish ops-dashboard-unified">
    <header className="hub-header">
      <div><p className="eyebrow">DT Intelligence Hub</p><h1>Operations Dashboard</h1><p>Monitor USPS performance, investigate missed stops, and review contracts.</p></div>
      <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}><Link href="/trends" style={{padding:"10px 14px",border:"1px solid currentColor",borderRadius:8,fontWeight:700}}>Contract Trends</Link><DashboardReportActions /></div>
    </header>
    <DashboardHub />
  </main>;
}
