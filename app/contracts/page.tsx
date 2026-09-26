"use client";

import { useState } from "react";
import ContractSelector from "@/components/ContractSelector";
import MonthlyContractPrintReport from "@/components/MonthlyContractPrintReport";
import UspsRateImport from "@/components/UspsRateImport";
import ExpiringContracts from "@/components/ExpiringContracts";

export default function Page() {
  const [tool,setTool]=useState<"import"|"expiring"|null>(null);
  const buttonStyle={display:"inline-flex",alignItems:"center",justifyContent:"center",minHeight:42,padding:"9px 16px",borderRadius:8,border:"1px solid #0b2f5b",background:"#0b2f5b",color:"#fff",fontWeight:700,cursor:"pointer"} as const;
  return <main className="page-shell">
    <header className="page-intro"><div>
      <p className="eyebrow">Contract intelligence</p>
      <h1>Contracts</h1>
      <p>Find a contract by number or supervisor, then tap it to see what happened.</p>
    </div></header>

    <div className="no-print" style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:18}}>
      <button type="button" style={buttonStyle} onClick={()=>setTool(tool==="import"?null:"import")}>Import USPS Rates</button>
      <button type="button" style={buttonStyle} onClick={()=>setTool(tool==="expiring"?null:"expiring")}>Expiring Contracts</button>
    </div>

    {tool==="import"&&<UspsRateImport />}
    {tool==="expiring"&&<ExpiringContracts />}

    <div className="no-print"><ContractSelector /></div>
    <details className="contract-print-disclosure"><summary>Print all contracts by month</summary><MonthlyContractPrintReport /></details>
  </main>;
}
