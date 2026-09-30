import Link from "next/link";

export default function MonthlyReconciliationPage() {
  return (
    <main className="page-shell">
      <header className="page-intro">
        <div>
          <p className="eyebrow">Contract financials</p>
          <h1>Monthly Reconciliation</h1>
          <p>Reconcile scheduled contract trips against CLEAR actuals and prepare the monthly supervisor report.</p>
        </div>
        <Link className="button-secondary" href="/contracts">Back to Contracts</Link>
      </header>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>1. Reporting period</h2>
        <div className="form-grid">
          <label>Supervisor<select defaultValue="Tonya Capps-Owen"><option>Tonya Capps-Owen</option></select></label>
          <label>Month<input type="month" defaultValue="2026-08" /></label>
        </div>
        <p className="muted">The supervisor assignment controls which contracts and trips are included. Other activity in CLEAR is ignored.</p>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>2. Monthly rate / EIA</h2>
        <p>Enter the approved monthly rate information before finalizing the report. Values should be stored by effective month so prior reports never change.</p>
        <div className="form-grid">
          <label>Prior effective rate<input inputMode="decimal" placeholder="7/1/2026 rate" /></label>
          <label>Current effective rate<input inputMode="decimal" placeholder="8/1/2026 rate" /></label>
          <label>EIA value / adjustment<input inputMode="decimal" placeholder="Optional" /></label>
          <label>Effective date<input type="date" defaultValue="2026-08-01" /></label>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>3. Upload CLEAR</h2>
        <p>Upload the original CLEAR workbook. The importer will skip the first 12 rows, use row 13 as the header, and pull only the operational fields needed for Tonya&apos;s assigned trips.</p>
        <input type="file" accept=".xlsx,.xls" />
        <p className="muted"><strong>CLEAR financial fields must never appear on the supervisor report.</strong></p>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>4. Reconciliation</h2>
        <p>The completed engine will compare frequency/calendar expected days, effective contract/SVC trip miles, CLEAR days run, and payable miles capped at contract miles. It will flag missing trips, extra days, mileage over contract, duplicates, and mid-month SVC changes.</p>
        <div className="table-wrap"><table><thead><tr><th>Contract</th><th>Trip</th><th>CLEAR Trip</th><th>Frequency</th><th>Contract Miles</th><th>Expected Days</th><th>Actual Days</th><th>Paid Miles</th><th>Status</th></tr></thead><tbody><tr><td colSpan={9} className="muted">Upload and calculation wiring is the next step.</td></tr></tbody></table></div>
      </section>

      <section className="card">
        <h2>5. Supervisor report</h2>
        <p>One report will combine the CLEAR reconciliation detail with the monthly totals page: prior rate, current rate, reconciled mileage, amount owed by contract, grand total, and the 5th-of-next-month due date.</p>
        <p className="muted">No CLEAR dollar amounts will be printed or exported.</p>
      </section>
    </main>
  );
}
