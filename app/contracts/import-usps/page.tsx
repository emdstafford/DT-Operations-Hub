import Link from "next/link";
import UspsRateImport from "@/components/UspsRateImport";

export default function ContractUploadPage() {
  return <main className="page-shell">
    <header className="hub-header">
      <div>
        <p className="eyebrow">Contract intelligence</p>
        <h1>Upload Contract Data</h1>
        <p>Drop in a contract file and the Hub will identify what it is, then route it to the right contract workflow.</p>
      </div>
      <div className="hub-actions"><Link className="hub-secondary-link" href="/contracts">Back to Contracts</Link></div>
    </header>
    <UspsRateImport />
  </main>;
}
