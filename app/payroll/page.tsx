import Link from "next/link";
import PayrollAccessGate from "@/components/PayrollAccessGate";

export default function PayrollPage() {
  return <main className="page-shell payroll-page">
    <header className="hub-header"><div><p className="eyebrow">Restricted tools</p><h1>Payroll</h1><p>Choose the report you need to prepare.</p></div></header>
    <PayrollAccessGate><div className="payroll-tools-grid">
      <Link className="panel payroll-tool-card" href="/payroll/timecards"><span>Timecard review</span><h2>Timecard Report</h2><p>Print this pay period’s timecards and hours by contract. Gary can compare them with his prior notes.</p><strong>Open tool →</strong></Link>
      <article className="panel payroll-tool-card"><span>Holiday hours</span><h2>Holiday Hours Import</h2><p>Calculate holiday hours and create the ADP import file. Review saved holiday totals in Holiday Hours History.</p><div className="payroll-tool-links"><Link href="/payroll/holiday-hours">Open import →</Link><Link href="/payroll/holiday-trends">Holiday Hours History →</Link></div></article>
    </div></PayrollAccessGate>
  </main>;
}
