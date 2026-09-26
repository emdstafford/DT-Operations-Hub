import Link from "next/link";
import UspsRateImport from "@/components/UspsRateImport";

export default function ImportUspsRatesPage() {
  return <main className="page-shell">
    <header className="hub-header">
      <div>
        <p className="eyebrow">Contract intelligence</p>
        <h1>Import USPS Rates</h1>
        <p>Upload the official USPS workbook to add effective-dated trip rates, mileage, and contract history.</p>
      </div>
      <div className="hub-actions"><Link className="hub-secondary-link" href="/contracts">Back to Contracts</Link></div>
    </header>
    <UspsRateImport />
  </main>;
}
