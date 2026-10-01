import ScheduleBuilder from "@/components/ScheduleBuilder";

export default function ContractSchedulesPage() {
  return <main className="page-shell">
    <header className="page-intro">
      <div>
        <p className="eyebrow">Contract source of truth</p>
        <h1>USPS Contract Schedules</h1>
        <p>Upload the current USPS schedule and service-change documents here. Review contract, trips, effective dates and changes before using the data downstream.</p>
      </div>
    </header>
    <section style={{ marginBottom: 18, padding: "14px 16px", border: "1px solid #cbd7e4", borderRadius: 12, background: "#f6f9fc", color: "#314b66" }}>
      <strong>Historical contract record</strong>
      <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.5 }}>Use this workspace for base schedules and SVC/service changes. Effective dates matter: prior versions must remain available so reconciliation can use the trip terms that were active on the actual service date.</div>
    </section>
    <ScheduleBuilder />
  </main>;
}
