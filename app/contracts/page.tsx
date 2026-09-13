import ContractSelector from "@/components/ContractSelector";

export default function Page() {
  return <main className="page-shell">
    <header className="page-intro"><div>
      <p className="eyebrow">Contract intelligence</p>
      <h1>Contracts</h1>
      <p>Choose a contract to drill into its performance over any date range.</p>
    </div></header>
    <ContractSelector />
  </main>;
}
