import HolidayHoursImport from "@/components/HolidayHoursImport";
import PayrollAccessGate from "@/components/PayrollAccessGate";
import Link from "next/link";

export default function HolidayHoursPage() {
  return <main className="page-shell payroll-page">
    <header className="hub-header">
      <div>
        <p className="eyebrow">Restricted payroll tools</p>
        <h1>Holiday Hours Import</h1>
        <p>Combine employee hours, calculate holiday hours, and create the payroll-ready import file.</p>
      </div>
      <div className="payroll-page-actions"><Link className="secondary-button" href="/payroll/holiday-trends">Payroll Trends</Link><Link className="secondary-button" href="/payroll/timecards">Timecard Packet</Link><span className="restricted-badge">Payroll access only</span></div>
    </header>
    <PayrollAccessGate><HolidayHoursImport /></PayrollAccessGate>
  </main>;
}
