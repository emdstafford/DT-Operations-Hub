"use client";

import { useState } from "react";
import UspsRateImport from "@/components/UspsRateImport";
import ExpiringContracts from "@/components/ExpiringContracts";

export default function ContractTools() {
  const [open,setOpen]=useState<"import"|"expiring"|null>(null);
  return <div className="no-print" style={{marginBottom:20}}>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:open?16:0}}>
      <button type="button" className="hub-primary-link" onClick={()=>setOpen(open==="import"?null:"import")}>Import USPS Rates</button>
      <button type="button" className="hub-primary-link" onClick={()=>setOpen(open==="expiring"?null:"expiring")}>Expiring Contracts</button>
    </div>
    {open==="import" ? <UspsRateImport /> : null}
    {open==="expiring" ? <ExpiringContracts /> : null}
  </div>;
}
