import Link from "next/link";
import PayrollAccessGate from "@/components/PayrollAccessGate";
import TimecardPacket from "@/components/TimecardPacket";

export default function TimecardsPage() {
  return <main className="page-shell payroll-page timecard-page">
    <header className="hub-header no-print">
      <div><p className="eyebrow">Restricted payroll tools</p><h1>Timecard Report</h1><p>Print this pay period’s timecards by contract for review.</p></div>
      <div className="hub-actions"><Link className="hub-secondary-link" href="/payroll/timecard-trends">Compare payrolls →</Link><Link className="hub-secondary-link" href="/payroll">← All Payroll Tools</Link></div>
    </header>
    <PayrollAccessGate><TimecardPacket /></PayrollAccessGate>
  </main>;
}
