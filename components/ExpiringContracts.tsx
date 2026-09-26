"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import { supabase } from "@/lib/supabase";
type Row={contract_number:string;original_expiration_date:string;current_expiration_date:string;days_remaining:number;extension_count:number;last_extension_date:string|null;contract_status:string};
export default function ExpiringContracts(){
 const [days,setDays]=useState(90),[rows,setRows]=useState<Row[]>([]),[error,setError]=useState("");
 useEffect(()=>{let live=true;(async()=>{const {data,error}=await supabase.rpc("usps_contracts_expiring",{p_as_of:new Date().toISOString().slice(0,10),p_days_ahead:days});if(!live)return;if(error){setRows([]);setError("Expiration tracking will appear after the USPS contract SQL is installed.");}else{setError("");setRows((data??[]) as Row[]);}})();return()=>{live=false};},[days]);
 const filterStyle=(active:boolean)=>({minHeight:36,padding:"7px 13px",borderRadius:8,border:"1px solid #0b2f5b",background:active?"#0b2f5b":"#fff",color:active?"#fff":"#0b2f5b",fontWeight:700,cursor:"pointer"} as const);
 return <section className="hub-card no-print" style={{marginBottom:24}}><div className="section-heading"><div><p className="eyebrow">Contract dates</p><h2>Expiring contracts</h2><p>Upcoming USPS expirations with the original date preserved when an extension is recorded.</p></div></div>
 <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
  {[60,90,120].map(n=><button key={n} type="button" style={filterStyle(days===n)} onClick={()=>setDays(n)}>{n} days</button>)}
 </div>
 {error?<p>{error}</p>:rows.length?<div style={{overflowX:"auto"}}><table className="data-table"><thead><tr><th>Contract</th><th>Current expiration</th><th>Days</th><th>Original expiration</th><th>Extensions</th></tr></thead><tbody>{rows.map(r=><tr key={r.contract_number}><td><Link href={"/contracts/"+encodeURIComponent(r.contract_number)}><strong>{r.contract_number}</strong></Link></td><td>{r.current_expiration_date}</td><td>{r.days_remaining}</td><td>{r.original_expiration_date}</td><td>{r.extension_count?String(r.extension_count):"—"}</td></tr>)}</tbody></table></div>:<p>No contracts expire in the next {days} days.</p>}</section>;
}
