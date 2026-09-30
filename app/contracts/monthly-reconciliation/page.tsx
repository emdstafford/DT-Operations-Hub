import Link from "next/link";
import MonthlyClearReconciliation from "@/components/MonthlyClearReconciliation";

export default function MonthlyReconciliationPage() {
  return (
    <main className="page-shell">
      <header className="page-intro">
        <div><p className="eyebrow">Contract financials</p><h1>Monthly Reconciliation</h1><p>Reconcile scheduled contract trips against CLEAR actuals and prepare the monthly supervisor report.</p></div>
        <Link className="button-secondary" href="/contracts">Back to Contracts</Link>
      </header>
      <section className="card" style={{marginBottom:16}}><h2>Reporting period</h2><div className="form-grid"><label>Supervisor<select defaultValue="Tonya Capps-Owen"><option>Tonya Capps-Owen</option></select></label><label>Month<input type="month" defaultValue="2026-08" /></label></div><p className="muted">Tonya&apos;s assignment controls which CLEAR trips are included. All other CLEAR activity is ignored.</p></section>
      <MonthlyClearReconciliation />
      <section className="card"><h2>Next: approval & final report</h2><p>The next layer adds contract frequency/calendar expected days, SVC-effective mileage, automatic EIA retrieval, Gary approval, saved monthly snapshots, comparison history, and the combined printable Tonya report.</p></section>
    </main>
  );
}
