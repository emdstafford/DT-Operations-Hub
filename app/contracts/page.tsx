import Link from "next/link";
import ContractSelector from "@/components/ContractSelector";
import MonthlyContractPrintReport from "@/components/MonthlyContractPrintReport";
import ContractPayRateLink from "@/components/ContractPayRateLink";

export default function Page() {
  return <main className="page-shell">
    <header className="page-intro"><div>
      <p className="eyebrow">Contract intelligence</p>
      <h1>Contracts</h1>
      <p>Find a contract by number or supervisor, then tap it to see what happened.</p>
    </div><ContractPayRateLink /></header>

    <Link
      href="/contracts/monthly-reconciliation"
      className="no-print"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 18,
        padding: "16px 18px",
        marginBottom: 18,
        borderRadius: 12,
        background: "linear-gradient(135deg, #0f2747 0%, #173a67 100%)",
        color: "#fff",
        textDecoration: "none",
        boxShadow: "0 6px 18px rgba(15,39,71,.12)",
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, opacity: .72, letterSpacing: ".08em" }}>CONTRACT FINANCIALS</div>
        <div style={{ fontSize: 19, fontWeight: 850, marginTop: 3 }}>Monthly Reconciliation</div>
        <div style={{ fontSize: 13, opacity: .82, marginTop: 3 }}>CLEAR actuals, monthly rates, approvals, and final supervisor reports</div>
      </div>
      <div style={{ fontSize: 25, fontWeight: 300 }}>→</div>
    </Link>

    <div className="no-print"><ContractSelector /></div>
    <details className="contract-print-disclosure"><summary>Print all contracts by month</summary><MonthlyContractPrintReport /></details>
  </main>;
}
