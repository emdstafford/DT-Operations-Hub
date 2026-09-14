import ContractSelector from "@/components/ContractSelector";
import MonthlyContractPrintReport from "@/components/MonthlyContractPrintReport";

export default function Page() {
  return <main className="page-shell">
    <header className="page-intro"><div>
      <p className="eyebrow">Contract intelligence</p>
      <h1>Contracts</h1>
      <p>Choose a contract to drill into its performance over any date range.</p>
    </div><a className="primary-link" href="#monthly-report">Print All Contracts</a></header>
    <div className="no-print"><ContractSelector /></div>
    <MonthlyContractPrintReport />
  </main>;
}
