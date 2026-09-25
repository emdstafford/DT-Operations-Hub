import Link from "next/link";
import PayrollAccessGate from "@/components/PayrollAccessGate";
import TimecardHistory from "@/components/TimecardHistory";

export default function TimecardTrendsPage() {
  return <main className="page-shell payroll-page timecard-page">
    <header className="hub-header"><div><p className="eyebrow">Payroll tools</p><h1>Timecard comparisons</h1><p>Compare driver and contract hours across saved payrolls.</p></div><Link className="hub-secondary-link" href="/payroll">← All Payroll Tools</Link></header>
    <PayrollAccessGate><TimecardHistory /></PayrollAccessGate>
  </main>;
}
