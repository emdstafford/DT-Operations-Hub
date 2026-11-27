"use client";
import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {supabase} from "@/lib/supabase";
import {useAccessRole} from "@/components/AccessRole";

type SavedNote={id:string;contract_number:string;trip_number:string|null;status:string;note:string;effective_start:string;effective_end:string|null};
const esc=(s:unknown)=>String(s??"").replace(/[&<>"\']/g,x=>(({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","\'":"&#39;"} as Record<string,string>)[x]||x));
const canon=(s:string)=>s.trim().toUpperCase().replace(/^0+(?=\d)/,"");
type Trip={contract:string;trip:string;affected:number;observed:number;missed_stops:number;last_miss:string;affected_weeks:string[];observed_weeks:string[]};
type SupervisorContract = { supervisor: string; contract_number: string };
const permitted=new Set(["estafford@dtexpress.net","ccochran@dtexpress.net"]);
const iso=(d:Date)=>d.toISOString().slice(0,10);
const shift=(day:string,n:number)=>{const d=new Date(day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return iso(d)};
function lastFriday(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const get=(k:string)=>p.find(x=>x.type===k)?.value||"";const d=new Date(get("year")+"-"+get("month")+"-"+get("day")+"T12:00:00Z");return shift(iso(d),-((d.getUTCDay()+2)%7||7));}
const fmt=(n:number)=>Number(n||0).toLocaleString("en-US");
export default function TripWatchlist(){
 const role=useAccessRole();
 const [access,setAccess]=useState<boolean|null>(null);
 const [end,setEnd]=useState(lastFriday);
 const [weeks,setWeeks]=useState(14);
 const [minimum,setMinimum]=useState(7);
 const [query,setQuery]=useState("");
 const [supervisor,setSupervisor]=useState("");
 const [contract,setContract]=useState("");
 const [assignmentResult,setAssignmentResult]=useState<{
   start: string; end: string; refresh: number; rows: SupervisorContract[]; error: string;
 } | null>(null);
 const [rows,setRows]=useState<Trip[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [refresh,setRefresh]=useState(0);
 const [notes,setNotes]=useState<SavedNote[]>([]);
 const [noteError,setNoteError]=useState("");
 const [draft,setDraft]=useState<{contract:string;trip:string;note:string;status:string;effective:string;id?:string}|null>(null);
 const [saving,setSaving]=useState(false);
 const [printLimit,setPrintLimit]=useState(50);
 useEffect(()=>{let live=true;void supabase.auth.getUser().then(({data})=>{if(live)setAccess(permitted.has((data.user?.email||"").toLowerCase()))});return()=>{live=false}},[]);
 useEffect(()=>{if(access!==true||role!=="admin")return;let live=true;setLoading(true);setError("");setRows([]);
 void supabase.rpc("dt_private_recurring_trip_watchlist",{p_end:end,p_weeks:weeks}).then(({data,error})=>{if(!live)return;if(error)setError(error.message);else setRows((data||[]) as Trip[]);setLoading(false)});
 return()=>{live=false};
 },[access,role,end,weeks,refresh]);
 useEffect(()=>{if(access!==true||role!=="admin")return;let live=true;setNoteError("");void (async()=>{const all:SavedNote[]=[];for(let offset=0;;offset+=500){const res=await supabase.from("operational_notes").select("id,contract_number,trip_number,status,note,effective_start,effective_end").is("effective_end",null).neq("status","resolved").order("id").range(offset,offset+499);if(!live)return;if(res.error){setNoteError(res.error.message);return;}all.push(...(res.data||[]) as SavedNote[]);if((res.data||[]).length<500)break;}if(live)setNotes(all)})();return()=>{live=false}},[access,role,refresh]);
 const notesFor=(t:Trip)=>notes.filter(n=>canon(n.contract_number)===canon(t.contract)&&n.trip_number?.trim()===t.trip);
 async function saveNote(){if(!draft||!draft.note.trim()||saving)return;setSaving(true);setNoteError("");const values={contract_number:draft.contract,trip_number:draft.trip,status:draft.status,note:draft.note.trim(),effective_start:draft.effective,updated_at:new Date().toISOString()};const res=draft.id?await supabase.from("operational_notes").update(values).eq("id",draft.id).select("id").single():await supabase.from("operational_notes").insert(values).select("id").single();if(res.error)setNoteError(res.error.message);else{setDraft(null);setRefresh(n=>n+1)}setSaving(false);}
 const start=shift(end,-(weeks*7-1));
 useEffect(() => {
   if (access !== true || role !== "admin") return;
   let live = true;
   void supabase.rpc("dashboard_hub_filtered", {
     p_start: start,
     p_end: end,
     p_grain: "week",
     p_exclude_august_2026: false,
   }).then(({ data, error }) => {
     if (live) setAssignmentResult({
       start, end, refresh,
       rows: data?.supervisor_contracts ?? [],
       error: error?.message ?? "",
     });
   });
   return () => { live = false; };
 }, [access, role, start, end, refresh]);

 const assignments = assignmentResult?.start === start && assignmentResult.end === end
   && assignmentResult.refresh === refresh ? assignmentResult : null;
 const watchlistContracts = useMemo(() => new Set(rows.map(t => t.contract)), [rows]);
 const supervisorContracts = useMemo(() => {
   const bySupervisor = new Map<string, Set<string>>();
   for (const row of assignments?.rows ?? []) {
     const contractNumber = canon(row.contract_number);
     if (!watchlistContracts.has(contractNumber)) continue;
     const contracts = bySupervisor.get(row.supervisor) ?? new Set<string>();
     contracts.add(contractNumber);
     bySupervisor.set(row.supervisor, contracts);
   }
   return bySupervisor;
 }, [assignments, watchlistContracts]);
 const matchedContracts = supervisorContracts.get(supervisor);
 const contractOptions = [...(supervisor ? matchedContracts ?? [] : watchlistContracts)].sort();
 const supervisorFilterLoading = !!supervisor && !assignments;
 const supervisorFilterError = !!supervisor && !!assignments?.error;
 const weekStarts=Array.from({length:weeks},(_,i)=>shift(start,i*7));
 const high=Math.ceil(weeks/2);
 const groups=useMemo(()=>{const m=new Map<string,Trip[]>();const term=query.trim().toUpperCase();for(const t of rows){
 if (supervisor && !matchedContracts?.has(t.contract)) continue;
 if (contract && t.contract !== contract) continue;
 if(t.affected<minimum||term&&!t.contract.toUpperCase().includes(term)&&!t.trip.toUpperCase().includes(term))continue;const a=m.get(t.contract)||[];a.push(t);m.set(t.contract,a)}return [...m].map(([contract,trips])=>({contract,trips:trips.sort((a,b)=>b.affected-a.affected||b.missed_stops-a.missed_stops),misses:trips.reduce((n,t)=>n+Number(t.missed_stops),0),high:trips.filter(t=>t.affected>=high).length})).sort((a,b)=>b.trips[0].affected-a.trips[0].affected||b.high-a.high||b.misses-a.misses||a.contract.localeCompare(b.contract));},[rows,minimum,query,high,supervisor,matchedContracts,contract]);
 function printChecklist(){
 const selected=groups.flatMap(g=>g.trips).sort((a,b)=>b.affected-a.affected||b.missed_stops-a.missed_stops||a.contract.localeCompare(b.contract)||a.trip.localeCompare(b.trip)).slice(0,printLimit||undefined).sort((a,b)=>a.contract.localeCompare(b.contract)||b.affected-a.affected||b.missed_stops-a.missed_stops);
 const win=window.open("","_blank");if(!win){setNoteError("Allow pop-ups to print the checklist.");return;}
 const rowsHtml=selected.map(t=>'<tr><td class="check">□</td><td>'+esc(t.contract)+'</td><td>'+esc(t.trip)+'</td><td>'+t.affected+'/'+t.observed+'</td><td>'+fmt(t.missed_stops)+'</td><td>'+esc(t.last_miss)+'</td><td>'+notesFor(t).map(n=>esc(n.status.replaceAll("_"," ")+": "+n.note)).join("<br>")+'<div class="write"></div></td></tr>').join("");
 win.document.write('<!doctype html><html><head><title>Recurring Trip Checklist</title><style>@page{size:landscape;margin:10mm}body{font:10pt Arial;color:#172b3f}h1{font-size:17pt;margin:0 0 4pt}p{margin:4pt 0 9pt}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aab4be;padding:5pt;text-align:left;vertical-align:top}th{background:#e8edf2}thead{display:table-header-group}tr{break-inside:avoid}.check{font-size:15pt;width:18pt}.write{min-height:13pt;border-bottom:1px dotted #999}td:last-child{width:37%}</style></head><body><h1>DT Intelligence Hub | Recurring Trip Checklist</h1><p>'+esc(start)+' – '+esc(end)+' · '+selected.length+' of '+groups.reduce((n,g)=>n+g.trips.length,0)+' filtered trips · '+esc(supervisor || "All supervisors")+' · '+esc(contract || "All contracts")+' · Minimum '+minimum+' affected weeks · Preliminary saved load history</p><table><thead><tr><th>Done</th><th>Contract</th><th>Trip</th><th>Missed weeks / recorded</th><th>Incomplete stops</th><th>Last missed</th><th>Saved notes / follow-up</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></body></html>');win.document.close();win.focus();win.print();
 }
 if(access===null)return <main className="page-shell"><p>Checking access…</p></main>;
 if(!access||role!=="admin")return <main className="page-shell"><h1>Recurring Trip Watchlist</h1><p>This report is restricted to authorized administrators.</p></main>;
 return <main className="page-shell operations-polish" style={{maxWidth:1200,margin:"0 auto",display:"grid",gap:16}}>
 <header className="hub-header"><div><p className="eyebrow">Private operations intelligence</p><h1>Recurring Trip Watchlist</h1><p>Find repeated incomplete stops across every mapped contract, ranked by frequency and impact.</p></div><Link className="hub-secondary-link" href="/trends">Contract Trends</Link></header>
 <section className="panel no-print"><div className="ops-filter-grid" style={{display:"flex",flexWrap:"wrap",gap:12}}>
 <label>Through (Friday)<input type="date" value={end} max={lastFriday()} onChange={e=>{if(e.target.value){setEnd(e.target.value);setSupervisor("");setContract("")}}}/></label>
 <label>Lookback<select value={weeks} onChange={e=>{const n=Number(e.target.value);setWeeks(n);setMinimum(Math.ceil(n/2));setSupervisor("");setContract("")}}>{[4,8,12,14,16].map(n=><option key={n} value={n}>{n} weeks</option>)}</select></label>
 <label>Minimum weeks with misses<select value={minimum} onChange={e=>setMinimum(Number(e.target.value))}>{Array.from({length:weeks-1},(_,i)=>i+2).map(n=><option key={n} value={n}>{n} weeks</option>)}</select></label>
 <label>Supervisor<select value={supervisor} onChange={e=>{setSupervisor(e.target.value);setContract("")}}>
   <option value="">All supervisors</option>
   {supervisor && !matchedContracts && <option value={supervisor}>{supervisor}</option>}
   {[...supervisorContracts.keys()].sort().map(name=><option key={name} value={name}>{name}</option>)}
 </select></label>
 <label>Contract<select value={contract} onChange={e=>setContract(e.target.value)}>
   <option value="">All contracts</option>
   {contract && !contractOptions.includes(contract) && <option value={contract}>{contract}</option>}
   {contractOptions.map(number=><option key={number} value={number}>{number}</option>)}
 </select></label>
 <label>Contract or trip<input value={query} placeholder="e.g. 280L3" onChange={e=>setQuery(e.target.value)}/></label>
 <button className="hub-secondary-link" onClick={()=>setRefresh(n=>n+1)}>Refresh</button><label>Checklist size<select value={printLimit} onChange={e=>setPrintLimit(Number(e.target.value))}><option value={25}>Top 25</option><option value={50}>Top 50</option><option value={100}>Top 100</option><option value={0}>All filtered trips</option></select></label><button className="hub-secondary-link" onClick={printChecklist} disabled={loading||!!error||supervisorFilterLoading||supervisorFilterError}>Print checklist</button></div>
 <p className="ops-summary">Saturday–Friday weeks. Default shows trips with misses in at least half of the selected weeks. The flagged August 7–13 period is excluded, as is 3773G after November 13. Unmapped trips are grouped by contract; they may represent more than one underlying trip. These are investigation leads, not proof of responsibility.</p></section>
 {!assignments && <p role="status">Loading supervisor options…</p>}
 {assignments?.error && <p role="alert">Unable to load supervisor options. Select Refresh to retry.</p>}
 {noteError&&<p role="alert">{noteError}</p>}
 {loading?<p>Checking saved USPS load history…</p>:error?<p role="alert">Unable to load the watchlist: {error}. Choose a completed Friday and retry.</p>:supervisorFilterLoading||supervisorFilterError?null:<>
 <section className="panel"><div className="panel-heading"><h2>{start} – {end}</h2><span>Filtered results</span></div><div className="ops-daily-stats"><div><small>Contracts flagged</small><strong>{groups.length}</strong></div><div><small>Recurring trips</small><strong>{groups.reduce((n,g)=>n+g.trips.length,0)}</strong></div><div><small>High priority ({high}+ weeks)</small><strong>{groups.reduce((n,g)=>n+g.high,0)}</strong></div></div><p className="ops-summary">Red = incomplete stops; green = recorded stops with no misses; gray = no recorded stops. Missing data is not counted as successful completion.</p></section>
 {!groups.length&&<p>No trips meet these filters.</p>}
 {groups.map((g,i)=><details open={!!contract||query.trim().length>0||i<3} className="panel watchlist-contract" key={g.contract} style={{padding:14}}><summary style={{cursor:"pointer",display:"list-item",fontWeight:700,color:"#123b61"}}>{g.contract} · {g.trips.length} flagged · {fmt(g.misses)} incomplete stops · worst {g.trips[0].affected}/{weeks} weeks</summary>
 <div style={{display:"grid",gap:12,marginTop:12}}>{g.trips.map(t=><div key={t.trip} style={{borderTop:"1px solid #dce3e8",paddingTop:12,breakInside:"avoid"}}><div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><strong>Trip {t.trip} · {t.affected}/{t.observed} recorded weeks with misses</strong><Link href={"/missed-load-reviews?"+new URLSearchParams({contract:g.contract,trip:t.trip==="Unmapped"?"":t.trip,start,end})}>Review loads →</Link></div><p style={{fontSize:13,margin:"5px 0"}}>{fmt(t.missed_stops)} incomplete stops · Last missed {t.last_miss} · <button className="clear-filters" onClick={()=>setDraft({contract:g.contract,trip:t.trip,note:"",status:"monitoring",effective:start})}>Add note</button></p>{notesFor(t).map(n=><div key={n.id} style={{fontSize:13,background:"#edf3f8",padding:8,marginBottom:5}}><strong>{n.status.replaceAll("_"," ")}</strong> · {n.note} <button className="clear-filters" onClick={()=>setDraft({contract:n.contract_number,trip:n.trip_number||t.trip,note:n.note,status:n.status,effective:n.effective_start,id:n.id})}>Edit</button></div>)}{draft&&canon(draft.contract)===canon(g.contract)&&draft.trip===t.trip&&<form onSubmit={e=>{e.preventDefault();void saveNote()}} style={{display:"grid",gap:8,padding:10,background:"#f5f7fa"}}><label>Status<select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}><option value="monitoring">Monitoring</option><option value="waiting_on_usps">Waiting on USPS</option></select></label><label>Applies beginning<input type="date" required value={draft.effective} onChange={e=>setDraft({...draft,effective:e.target.value})}/></label><label>Supervisor-facing operational note<textarea required rows={3} value={draft.note} onChange={e=>setDraft({...draft,note:e.target.value})}/></label><div><button className="hub-secondary-link" disabled={saving} type="submit">{saving?"Saving…":"Save note"}</button> <button className="clear-filters" type="button" onClick={()=>setDraft(null)}>Cancel</button></div></form>}<div style={{display:"flex",gap:3}}>{weekStarts.map((w,i)=>{const state=t.affected_weeks?.includes(w)?"Missed stops":t.observed_weeks?.includes(w)?"No misses":"No data";return <div key={w} title={w+": "+state} aria-label={w+": "+state} style={{flex:1,minWidth:0,textAlign:"center",fontSize:10}}><div style={{height:22,borderRadius:3,background:state==="Missed stops"?"#c66e65":state==="No misses"?"#8aad9b":"#cfd5db"}}/>{i+1}</div>})}</div></div>)}</div></details>)}
 </>}
 </main>;
}
