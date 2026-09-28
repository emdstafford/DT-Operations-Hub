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
    <div className="no-print"><ContractSelector /></div>
    <details className="contract-print-disclosure"><summary>Print all contracts by month</summary><MonthlyContractPrintReport /></details>
  </main>;
}
