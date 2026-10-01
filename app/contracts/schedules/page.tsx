import ContractScheduleUpload from "@/components/ContractScheduleUpload";

export default function ContractSchedulesPage() {
  return <main className="page-shell">
    <header className="page-intro">
      <div>
        <p className="eyebrow">Contract source of truth</p>
        <h1>USPS Contract Schedules</h1>
        <p>Upload official USPS contract schedules and revised schedules here. The Hub reads the contract data and keeps Schedule Builder separate.</p>
      </div>
    </header>
    <section style={{ marginBottom: 18, padding: "14px 16px", border: "1px solid #cbd7e4", borderRadius: 12, background: "#f6f9fc", color: "#314b66" }}>
      <strong>Historical contract record</strong>
      <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.5 }}>As service changes arrive, upload the revised USPS schedule here. Effective-dated versions will let the Hub use the contract terms that applied on the actual service date while preserving prior history.</div>
    </section>
    <ContractScheduleUpload />
  </main>;
}
