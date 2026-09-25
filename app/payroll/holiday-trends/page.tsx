import Link from "next/link";
import HolidayHoursTrends from "@/components/HolidayHoursTrends";
import PayrollAccessGate from "@/components/PayrollAccessGate";

export default function HolidayTrendsPage() {
  return <main className="page-shell payroll-page">
    <header className="hub-header">
      <div>
        <p className="eyebrow">Restricted payroll tools</p>
        <h1>Holiday Hours History</h1>
        <p>Search and compare saved holiday-hours calculations.</p>
      </div>
      <div className="payroll-page-actions"><Link className="secondary-button" href="/payroll/holiday-hours">Holiday Hours Import</Link><Link className="secondary-button" href="/payroll">All Payroll Tools</Link></div>
    </header>
    <PayrollAccessGate><HolidayHoursTrends /></PayrollAccessGate>
  </main>;
}
