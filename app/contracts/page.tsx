import Link from "next/link";
import ContractSelector from "@/components/ContractSelector";
import MonthlyContractPrintReport from "@/components/MonthlyContractPrintReport";

export default function Page() {
  return <main className="page-shell">
    <header className="hub-header">
      <div>
        <p className="eyebrow">Contract intelligence</p>
        <h1>Contracts</h1>
        <p>Find a contract by number or supervisor, then tap it to see what happened.</p>
      </div>
      <div className="hub-actions no-print">
        <Link className="primary-link" href="/contracts/import-usps">Import USPS Rates</Link>
        <Link className="hub-secondary-link" href="/contracts/expiring">Expiring Contracts</Link>
      </div>
    </header>
    <div className="no-print"><ContractSelector /></div>
    <details className="contract-print-disclosure"><summary>Print all contracts by month</summary><MonthlyContractPrintReport /></details>
  </main>;
}
