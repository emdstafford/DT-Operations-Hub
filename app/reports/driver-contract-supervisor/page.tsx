import Link from "next/link";
import DriverContractSupervisorReport from "@/components/DriverContractSupervisorReport";

export default function DriverContractSupervisorReportPage() {
  return <main className="page-shell">
    <header className="hub-header no-print">
      <div><p className="eyebrow">DT Intelligence Hub · Simple report</p><h1>Driver / Contract / Supervisor</h1><p>Current driver assignments from the latest saved timecard summary.</p></div>
      <div className="hub-actions"><Link className="hub-secondary-link" href="/">← Dashboard</Link></div>
    </header>
    <DriverContractSupervisorReport />
  </main>;
}
