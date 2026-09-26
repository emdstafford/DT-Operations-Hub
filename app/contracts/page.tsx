import ContractSelector from "@/components/ContractSelector";
import MonthlyContractPrintReport from "@/components/MonthlyContractPrintReport";
import ContractTools from "@/components/ContractTools";

export default function Page() {
  return <main className="page-shell">
    <header className="page-intro"><div>
      <p className="eyebrow">Contract intelligence</p>
      <h1>Contracts</h1>
      <p>Find a contract by number or supervisor, then tap it to see what happened.</p>\n      <p className="eyebrow">Financials preview · safe USPS import</p>
    </div></header>
    <ContractTools />
    <div className="no-print"><ContractSelector /></div>
    <details className="contract-print-disclosure"><summary>Print all contracts by month</summary><MonthlyContractPrintReport /></details>
  </main>;
}
