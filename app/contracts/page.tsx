import ContractSelector from "@/components/ContractSelector";
import MonthlyContractPrintReport from "@/components/MonthlyContractPrintReport";
import UspsRateImport from "@/components/UspsRateImport";
import ExpiringContracts from "@/components/ExpiringContracts";

export default function Page() {
  return <main className="page-shell">
    <header className="page-intro"><div>
      <p className="eyebrow">Contract intelligence</p>
      <h1>Contracts</h1>
      <p>Find a contract by number or supervisor, then tap it to see what happened.</p>
    </div></header>
    <div className="no-print"><ContractSelector /></div>
    <ExpiringContracts />
    <UspsRateImport />
    <details className="contract-print-disclosure"><summary>Print all contracts by month</summary><MonthlyContractPrintReport /></details>
  </main>;
}
