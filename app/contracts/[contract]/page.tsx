import Link from "next/link";
import ContractOperationalNotes from "@/components/ContractOperationalNotes";
import ContractPlanningSummary from "@/components/ContractPlanningSummary";
import ContractScheduleHistory from "@/components/ContractScheduleHistory";
import ContractTripSchedule from "@/components/ContractTripSchedule";
import PerformanceExplorer from "@/components/PerformanceExplorer";

export default async function Page({params,searchParams}:{params:Promise<{contract:string}>;searchParams:Promise<{start?:string;end?:string}>}){
  const [{contract},query]=await Promise.all([params,searchParams]);
  const value=decodeURIComponent(contract);
  const start=/^\d{4}-\d{2}-\d{2}$/.test(query.start??"")?query.start:undefined;
  const end=/^\d{4}-\d{2}-\d{2}$/.test(query.end??"")?query.end:undefined;
  return <main className="page-shell contract-detail-page">
    <header className="page-intro"><div><p className="eyebrow">Contract details</p><h1>Contract {value}</h1><p>See the current USPS schedule, schedule history, performance and contract details in one place.</p></div><Link className="hub-secondary-link no-print" href="/contracts">← All contracts</Link></header>
    <ContractScheduleHistory contract={value}/>
    <PerformanceExplorer fixedContract={value} initialStart={start} initialEnd={end}/>
    <ContractOperationalNotes contract={value}/>
    <ContractPlanningSummary contract={value}/>
    <ContractTripSchedule contract={value}/>
  </main>;
}
