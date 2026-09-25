import Link from "next/link";
import PayrollAccessGate from "@/components/PayrollAccessGate";

export default function PayrollPage() {
  return <main className="page-shell payroll-page">
    <header className="hub-header"><div><p className="eyebrow">Restricted tools</p><h1>Payroll</h1><p>Choose the report you need to prepare.</p></div></header>
    <PayrollAccessGate><div className="payroll-tools-grid">
      <Link className="panel payroll-tool-card" href="/payroll/holiday-hours"><span>Holiday hours</span><h2>Holiday Hours Import</h2><p>Calculate holiday hours and create the ADP import file.</p><strong>Open tool →</strong></Link>
      <Link className="panel payroll-tool-card" href="/payroll/timecards"><span>Timecard review</span><h2>Timecard Report</h2><p>Print this pay period’s timecards and hours by contract. Gary can compare them with his prior notes.</p><strong>Open tool →</strong></Link>
      <Link className="panel payroll-tool-card" href="/payroll/holiday-trends"><span>Holiday history</span><h2>Payroll Trends</h2><p>Find and compare saved holiday import totals.</p><strong>Open tool →</strong></Link>
    </div></PayrollAccessGate>
  </main>;
}
