import HolidayHoursImport from "@/components/HolidayHoursImport";
import PayrollAccessGate from "@/components/PayrollAccessGate";

export default function HolidayHoursPage() {
  return <main className="page-shell payroll-page">
    <header className="hub-header">
      <div>
        <p className="eyebrow">Restricted payroll tools</p>
        <h1>Holiday Hours Import</h1>
        <p>Combine employee hours, calculate holiday hours, and create the payroll-ready import file.</p>
      </div>
      <span className="restricted-badge">Payroll access only</span>
    </header>
    <PayrollAccessGate><HolidayHoursImport /></PayrollAccessGate>
  </main>;
}
