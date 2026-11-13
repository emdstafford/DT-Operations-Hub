import Link from "next/link";
import PayrollAccessGate from "@/components/PayrollAccessGate";
import TimecardPacket from "@/components/TimecardPacket";

export default async function TimecardsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const query = await searchParams;
  const reprintMode = !!query.reprint || !!query.payroll;
  return <main className="page-shell payroll-page timecard-page">
    <header className="hub-header no-print">
      <div><p className="eyebrow">Restricted payroll tools</p><h1>{reprintMode ? "Reprint Payroll Sheets" : "Timecard Report"}</h1><p>{reprintMode ? "Open saved payroll sheets by contract or supervisor." : "Upload this pay period’s timecards, enter the payroll number, and review the report."}</p></div>
      <div className="hub-actions">{reprintMode && <Link className="hub-secondary-link" href="/payroll/timecards">Upload new payroll →</Link>}<Link className="hub-secondary-link" href="/payroll/timecard-trends">Compare payrolls →</Link><Link className="hub-secondary-link" href="/payroll">← All Payroll Tools</Link></div>
    </header>
    <PayrollAccessGate><TimecardPacket key={reprintMode ? "reprint" : "upload"} reprintMode={reprintMode} /></PayrollAccessGate>
  </main>;
}
