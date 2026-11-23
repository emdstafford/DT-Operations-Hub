"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { includeUnassignedContract, normalizeTripContract, type UnassignedTripRow } from "@/components/WeeklyUnassignedTrips";

const dayAfter = (date:string, days:number) => new Date(Date.parse(date+"T12:00:00Z")+days*86400000).toISOString().slice(0,10);
const mostRecentSaturday = () => {
  const d = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d)?d:new Date().toISOString().slice(0,10);
  return dayAfter(date,-((new Date(date+"T12:00:00Z").getUTCDay()+1)%7));
};
const numeric = (a:string,b:string) => a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"});
type Totals = {contract:string;regular:number;extra:number;weeks:number};

export default function UnassignedTripsReport(){
  const [start,setStart]=useState("");
  const [end,setEnd]=useState("");
  const [includeRegular,setIncludeRegular]=useState(true);
  const [includeExtra,setIncludeExtra]=useState(true);
  const [contract,setContract]=useState("all");
  const [rows,setRows]=useState<UnassignedTripRow[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [access,setAccess]=useState<boolean|null>(null);
  useEffect(()=>{ const s=mostRecentSaturday();setStart(s);setEnd(dayAfter(s,6)); },[]);
  const load=useCallback(async()=>{
    if(!start||!end)return;
    if(start>end){setError("Start date must not be after end date.");return;}
    if(new Date(start+"T12:00:00Z").getUTCDay()!==6||new Date(end+"T12:00:00Z").getUTCDay()!==5){
      setError("Choose a Saturday start and Friday end so saved weekly counts are not partially represented.");return;
    }
    setLoading(true);setError("");
    const {data:{user}}=await supabase.auth.getUser();
    const email=user?.email?.toLowerCase()||"";
    const permission=email?await supabase.from("approved_users").select("email").eq("email",email).eq("active",true).maybeSingle():null;
    if(!permission?.data){setAccess(false);setRows([]);setError("This report requires approved operations access.");setLoading(false);return;}
    setAccess(true);
    const collected:UnassignedTripRow[]=[];
    let offset=0;
    for(;;){
      const result=await supabase.from("weekly_unassigned_trips").select("week_start,week_end,contract_number,trip_count,extra_trip_count,revision,updated_by,updated_at").gte("week_start",start).lte("week_end",end).order("week_start").order("contract_number").range(offset,offset+999);
      if(result.error){setRows([]);setError(result.error.message);setLoading(false);return;}
      const batch=(result.data||[]) as UnassignedTripRow[];
      collected.push(...batch);
      if(batch.length<1000)break;
      offset+=1000;
    }
    setRows(collected.filter(r=>includeUnassignedContract(r.contract_number)));
    setLoading(false);
  },[start,end]);
  useEffect(()=>{if(start&&end)void load();},[start,end,load]);
  const allContracts=useMemo(()=>Array.from(new Set(rows.map(r=>normalizeTripContract(r.contract_number)))).sort(numeric),[rows]);
  const displayed=useMemo(()=>{
    const map=new Map<string,Totals>();
    for(const row of rows){
      const id=normalizeTripContract(row.contract_number);
      if(contract!=="all"&&id!==contract)continue;
      const previous=map.get(id)||{contract:id,regular:0,extra:0,weeks:0};
      previous.regular+=Number(row.trip_count)||0;previous.extra+=Number(row.extra_trip_count)||0;previous.weeks++;
      map.set(id,previous);
    }
    return Array.from(map.values()).sort((a,b)=>numeric(a.contract,b.contract));
  },[rows,contract]);
  const totals=useMemo(()=>displayed.reduce((a,r)=>({regular:a.regular+r.regular,extra:a.extra+r.extra}),{regular:0,extra:0}),[displayed]);
  const selectedTotal=(includeRegular?totals.regular:0)+(includeExtra?totals.extra:0);
  function exportCsv(){
    const header=["Contract",...(includeRegular?["Regular unassigned"]:[]),...(includeExtra?["Extra-trip unassigned"]:[]),"Selected total","Weeks saved"];
    const data=displayed.map(r=>[r.contract,...(includeRegular?[String(r.regular)]:[]),...(includeExtra?[String(r.extra)]:[]),String((includeRegular?r.regular:0)+(includeExtra?r.extra:0)),String(r.weeks)]);
    const csv=[header,...data].map(cols=>cols.join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download=`unassigned-trips-${start}-to-${end}.csv`;a.click();URL.revokeObjectURL(url);
  }
  return <main className="page-shell operations-polish">
    <header className="page-intro"><div><p className="eyebrow">DT Intelligence Hub · Operations</p><h1>Unassigned Trips Report</h1><p>Saved weekly counts by contract. Toggle regular and extra-trip unassigned independently.</p></div><Link href="/reports" className="hub-secondary-link">Back to reports</Link></header>
    <section className="panel no-print" style={{padding:18,marginBottom:18}}>
      <h2 style={{marginTop:0}}>Report filters</h2>
      <div style={{display:"flex",flexWrap:"wrap",gap:16,alignItems:"end"}}>
        <label style={{display:"grid",gap:6}}>Start (Saturday)<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
        <label style={{display:"grid",gap:6}}>End (Friday)<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
        <label style={{display:"grid",gap:6}}>Contract<select value={contract} onChange={e=>setContract(e.target.value)}><option value="all">All contracts</option>{allContracts.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:20,marginTop:16}}>
        <label><input type="checkbox" checked={includeRegular} onChange={e=>setIncludeRegular(e.target.checked)}/> Regular unassigned</label>
        <label><input type="checkbox" checked={includeExtra} onChange={e=>setIncludeExtra(e.target.checked)}/> Extra-trip unassigned</label>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:10,marginTop:16}}>
        <button onClick={()=>void load()} disabled={loading}> {loading?"Loading…":"Refresh saved counts"}</button>
        <button onClick={()=>window.print()} disabled={loading||access!==true||!includeRegular&&!includeExtra}>Print report</button>
        <button onClick={exportCsv} disabled={loading||access!==true||!includeRegular&&!includeExtra}>Export CSV</button>
        <Link href="/unassigned-trips">Edit saved weekly counts</Link>
      </div>
      <p style={{fontSize:12,color:"#526171"}}>Reports use counts already saved in Unassigned Trips. Weeks without saved entries cannot be inferred automatically.</p>
    </section>
    {error&&<p role="alert" style={{color:"#ae2929"}}>{error}</p>}
    {access===true&&!error&&<section className="panel" style={{padding:18}}>
      <h2 style={{marginTop:0}}>Unassigned trips · {start} through {end}</h2>
      <p>{includeRegular?"Regular: "+totals.regular.toLocaleString()+" · ":""}{includeExtra?"Extra: "+totals.extra.toLocaleString()+" · ":""}<strong>Selected total: {selectedTotal.toLocaleString()}</strong></p>
      {!includeRegular&&!includeExtra?<p>Switch on at least one category to display a report.</p>:displayed.length===0?<p>No saved entries found for the selected weeks and contract.</p>:
      <div style={{overflowX:"auto"}}><table className="data-table"><thead><tr><th>Contract</th>{includeRegular&&<th>Regular unassigned</th>}{includeExtra&&<th>Extra-trip unassigned</th>}<th>Selected total</th><th>Weeks saved</th></tr></thead><tbody>
        {displayed.map(r=><tr key={r.contract}><td>{r.contract}</td>{includeRegular&&<td>{r.regular.toLocaleString()}</td>}{includeExtra&&<td>{r.extra.toLocaleString()}</td>}<td>{((includeRegular?r.regular:0)+(includeExtra?r.extra:0)).toLocaleString()}</td><td>{r.weeks}</td></tr>)}
        <tr><th>Total</th>{includeRegular&&<th>{totals.regular.toLocaleString()}</th>}{includeExtra&&<th>{totals.extra.toLocaleString()}</th>}<th>{selectedTotal.toLocaleString()}</th><th>—</th></tr>
      </tbody></table></div>}
    </section>}
  </main>;
}
