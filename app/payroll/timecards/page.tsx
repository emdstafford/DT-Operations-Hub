import Link from "next/link";
import PayrollAccessGate from "@/components/PayrollAccessGate";
import TimecardPacket from "@/components/TimecardPacket";

export default function TimecardsPage() {
  return <main className="page-shell payroll-page timecard-page">
    <header className="hub-header no-print">
      <div><p className="eyebrow">Restricted payroll tools</p><h1>Timecard Report</h1><p>Compare two pay periods and print a separate packet for each contract.</p></div>
      <Link className="hub-secondary-link" href="/payroll">← All Payroll Tools</Link>
    </header>
    <PayrollAccessGate><TimecardPacket /></PayrollAccessGate>
  </main>;
}
