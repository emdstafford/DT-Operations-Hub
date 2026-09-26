import Link from "next/link";
import ExpiringContracts from "@/components/ExpiringContracts";

export default function ExpiringContractsPage() {
  return <main className="page-shell">
    <header className="hub-header">
      <div>
        <p className="eyebrow">Contract intelligence</p>
        <h1>Expiring Contracts</h1>
        <p>Review upcoming contract expirations and preserve extension and renewal history.</p>
      </div>
      <div className="hub-actions"><Link className="hub-secondary-link" href="/contracts">Back to Contracts</Link></div>
    </header>
    <ExpiringContracts />
  </main>;
}
