import Link from "next/link";
import ContractOperationalNotes from "@/components/ContractOperationalNotes";
import PerformanceExplorer from "@/components/PerformanceExplorer";
export default async function Page({params}:{params:Promise<{contract:string}>}){const {contract}=await params;const value=decodeURIComponent(contract);return <main className="page-shell"><header className="page-intro"><div><p className="eyebrow">Contract drilldown</p><h1>Contract {value}</h1><p>Daily, Saturday–Friday weekly, monthly, and yearly performance trends.</p></div><Link className="primary-link no-print" href="/contracts#monthly-report">Print All Contracts</Link></header><ContractOperationalNotes contract={value}/><PerformanceExplorer fixedContract={value}/></main>}
