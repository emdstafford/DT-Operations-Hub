import Link from "next/link";
import HolidayHoursTrends from "@/components/HolidayHoursTrends";
import PayrollAccessGate from "@/components/PayrollAccessGate";

export default function HolidayTrendsPage() {
  return <main className="page-shell payroll-page">
    <header className="hub-header">
      <div>
        <p className="eyebrow">Restricted payroll tools</p>
        <h1>Payroll Trends</h1>
        <p>Search, compare, maintain, and export saved holiday-import summaries.</p>
      </div>
      <div className="payroll-page-actions"><Link className="secondary-button" href="/payroll/holiday-hours">Holiday Hours Import</Link><Link className="secondary-button" href="/payroll/timecards">Timecard Packet</Link><span className="restricted-badge">Payroll access only</span></div>
    </header>
    <PayrollAccessGate><HolidayHoursTrends /></PayrollAccessGate>
  </main>;
}
