import TechInvoiceTracker from "@/components/TechInvoiceTracker";

export default function TechInvoicesPage() {
  return (
    <main className="page-shell">
      <div className="page-intro">
        <div>
          <p className="eyebrow">DT Intelligence Hub · Restricted access</p>
          <h1>Tech invoices</h1>
          <p>Track due dates, payments, and technology spending in one place.</p>
        </div>
      </div>
      <TechInvoiceTracker />
    </main>
  );
}
