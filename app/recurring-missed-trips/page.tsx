"use client";

import Link from "next/link";
import {useCallback,useEffect,useMemo,useState} from "react";
import {supabase} from "@/lib/supabase";
import {useAccessRole} from "@/components/AccessRole";

type TripNote={contract_number:string;trip_number:string|null;status:string;note:string;effective_start:string;effective_end:string|null};
type RepeatRow={
 contract_number:string;trip_number:string;weeks_affected:number;weeks_observed:number;
 affected_weeks:string[];missed_days:number;missed_stops:number;last_missed_date:string;
};
const dateNY=()=>{
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const get=(k:string)=>parts.find(p=>p.type===k)?.value||"";
 return [get("year"),get("month"),get("day")].join("-");
};
const lastSunday=()=>{const today=new Date(dateNY()+"T12:00:00Z");const weekday=today.getUTCDay();today.setUTCDate(today.getUTCDate()-(weekday===0?0:weekday));return today.toISOString().slice(0,10)};
const fmt=(v:number)=>Number(v||0).toLocaleString("en-US");
export default function RecurringMissedTripsPage(){
 const role=useAccessRole();
 const [end,setEnd]=useState(lastSunday);
 const [weeks,setWeeks]=useState(8);
 const [rows,setRows]=useState<RepeatRow[]>([]);
 const [notes,setNotes]=useState<TripNote[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const allowed=["admin","uploader","viewer"].includes(role||"");
 const refresh=useCallback(async()=>{
  if(!allowed)return;
  setLoading(true);setError("");
  const [repeats,tripNotes]=await Promise.all([
   supabase.rpc("recurring_missed_trips",{p_end:end,p_weeks:weeks}),
   supabase.from("operational_notes").select("contract_number,trip_number,status,note,effective_start,effective_end").is("effective_end",null).limit(2000)
  ]);
  if(repeats.error||tripNotes.error)setError(repeats.error?.message||tripNotes.error?.message||"Could not retrieve recurring trips");
  else {setRows((repeats.data||[]) as RepeatRow[]);setNotes((tripNotes.data||[]) as TripNote[]);}
  setLoading(false);
 },[allowed,end,weeks]);
 useEffect(()=>{void refresh()},[refresh]);
 const repeating=useMemo(()=>rows.filter(r=>r.weeks_affected>=3),[rows]);
 const watching=useMemo(()=>rows.filter(r=>r.weeks_affected===2),[rows]);
 const noteFor=(r:RepeatRow)=>notes.find(n=>
   n.contract_number.trim().toUpperCase().replace(/^0+(?=[0-9])/,"")===r.contract_number &&
   n.trip_number?.trim()===r.trip_number && n.status!=="resolved");
 if(!allowed)return <main className="page-shell operations-polish"><h1>Recurring Missed Trips</h1><p>This reporting view is available to approved operations employees.</p></main>;
 const render=(items:RepeatRow[])=>items.length?<div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>Trip</th><th>Weeks with misses</th><th>Missed days</th><th>Reported missed stops</th><th>Last seen</th><th>Existing trip note</th><th>Action</th><th>Weeks affected (starting Monday)</th></tr></thead><tbody>{items.map(row=><tr key={row.contract_number+"|"+row.trip_number}>
 <td><Link href={`/contracts/${encodeURIComponent(row.contract_number)}`}>{row.contract_number}</Link></td>
 <td><strong>{row.trip_number}</strong></td>
 <td><strong>{row.weeks_affected} of {row.weeks_observed}</strong></td>
 <td>{fmt(row.missed_days)}</td><td>{fmt(row.missed_stops)}</td><td>{row.last_missed_date}</td>
 <td>{noteFor(row)?<><strong>{noteFor(row)?.status.replaceAll("_"," ")}</strong><span style={{display:"block",maxWidth:340}}>{noteFor(row)?.note}</span></>:"No trip note yet"}</td>
 <td><Link className="hub-secondary-link" href={`/contracts/${encodeURIComponent(row.contract_number)}?trip=${encodeURIComponent(row.trip_number==="Unassigned"?"":row.trip_number)}#contract-notes`}>View / add note</Link></td>
 <td>{row.affected_weeks.join(", ")}</td>
 </tr>)}</tbody></table></div>:<p className="ops-summary">No contract/trip combinations meet this frequency in the selected period.</p>;
 return <main className="page-shell dashboard-page operations-polish">
  <header className="hub-header"><div><p className="eyebrow">FourKites · Recurring issues</p><h1>Recurring Missed Trips</h1><p>Identify contract and trip combinations with repeated reported misses across weeks.</p></div><Link href="/missed-load-reviews" className="hub-secondary-link">Missed Load Reviews</Link></header>
  <section className="panel"><div className="panel-heading"><div><h2>Lookback period</h2><span>Weeks run Monday–Sunday; use a completed Sunday for full-week comparisons.</span></div></div>
   <div className="ops-filter-grid"><label>Through (Sunday)<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><label>Weeks to examine<select value={weeks} onChange={e=>setWeeks(Number(e.target.value))}><option value={4}>4 weeks</option><option value={8}>8 weeks</option><option value={12}>12 weeks</option><option value={16}>16 weeks</option></select></label><button type="button" className="hub-secondary-link" onClick={()=>void refresh()} disabled={loading}>Refresh</button></div>
   <p className="ops-summary"><strong>Reported misses are not necessarily USPS-countable misses.</strong> This identifies repeat patterns in saved FourKites data, not responsibility or a verified contract error. Confirm with the Sunday USPS report and contract records before taking action.</p>
   <p className="ops-summary">Candidate follow-up: investigate whether the route schedule, frequency, trip assignment, or USPS contract information needs correction. A repeated flag is not proof of the cause.</p>
  </section>
  {error&&<section className="panel"><p role="alert">{error}</p></section>}
  {loading?<section className="panel">Checking saved trip history…</section>:<>
   <section className="panel"><div className="panel-heading"><div><h2>Recurring issues — 3+ weeks</h2></div><strong>{repeating.length} flagged</strong></div>{render(repeating)}</section>
   <section className="panel"><div className="panel-heading"><div><h2>Worth watching — 2 weeks</h2></div><strong>{watching.length} flagged</strong></div>{render(watching)}</section>
   <section className="panel"><p className="ops-summary">Each operating-day load is counted once using its latest saved FourKites observation. Counts reflect the weeks represented in available imports; missing coverage can understate recurrence. This page does not modify completion percentages or send emails.</p></section>
  </>}
 </main>;
}
