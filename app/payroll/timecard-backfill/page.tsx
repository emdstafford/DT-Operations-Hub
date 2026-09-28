import Link from "next/link";
import PayrollAccessGate from "@/components/PayrollAccessGate";
import TimecardDailyBackfill from "@/components/TimecardDailyBackfill";

export default function TimecardBackfillPage() {
  return <main className="page-shell payroll-page">
    <header className="hub-header"><div><p className="eyebrow">Payroll history</p><h1>Daily Hours Backfill</h1><p>Add daily contract hours to payrolls that are already saved.</p></div><Link className="hub-secondary-link" href="/payroll">Back to Payroll</Link></header>
    <PayrollAccessGate><TimecardDailyBackfill /></PayrollAccessGate>
  </main>;
}
