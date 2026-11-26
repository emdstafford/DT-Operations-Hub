"use client";
import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {supabase} from "@/lib/supabase";
import {useAccessRole} from "@/components/AccessRole";

type Trip={contract:string;trip:string;affected:number;observed:number;missed_stops:number;last_miss:string;affected_weeks:string[];observed_weeks:string[]};
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
 const [rows,setRows]=useState<Trip[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{let live=true;void supabase.auth.getUser().then(({data})=>{if(live)setAccess(permitted.has((data.user?.email||"").toLowerCase()))});return()=>{live=false}},[]);
 useEffect(()=>{if(access!==true||role!=="admin")return;let live=true;setLoading(true);setError("");setRows([]);
 void supabase.rpc("dt_private_recurring_trip_watchlist",{p_end:end,p_weeks:weeks}).then(({data,error})=>{if(!live)return;if(error)setError(error.message);else setRows((data||[]) as Trip[]);setLoading(false)});
 return()=>{live=false};
 },[access,role,end,weeks,refresh]);
 const start=shift(end,-(weeks*7-1));
 const weekStarts=Array.from({length:weeks},(_,i)=>shift(start,i*7));
 const high=Math.ceil(weeks/2);
 const groups=useMemo(()=>{const m=new Map<string,Trip[]>();const term=query.trim().toUpperCase();for(const t of rows){if(t.affected<minimum||term&&!t.contract.toUpperCase().includes(term)&&!t.trip.toUpperCase().includes(term))continue;const a=m.get(t.contract)||[];a.push(t);m.set(t.contract,a)}return [...m].map(([contract,trips])=>({contract,trips:trips.sort((a,b)=>b.affected-a.affected||b.missed_stops-a.missed_stops),misses:trips.reduce((n,t)=>n+Number(t.missed_stops),0),high:trips.filter(t=>t.affected>=high).length})).sort((a,b)=>b.trips[0].affected-a.trips[0].affected||b.high-a.high||b.misses-a.misses||a.contract.localeCompare(b.contract));},[rows,minimum,query,high]);
 if(access===null)return <main className="page-shell"><p>Checking access…</p></main>;
 if(!access||role!=="admin")return <main className="page-shell"><h1>Recurring Trip Watchlist</h1><p>This report is restricted to authorized administrators.</p></main>;
 return <main className="page-shell operations-polish" style={{maxWidth:1200,margin:"0 auto",display:"grid",gap:16}}>
 <header className="hub-header"><div><p className="eyebrow">Private operations intelligence</p><h1>Recurring Trip Watchlist</h1><p>Find repeated incomplete stops across every mapped contract, ranked by frequency and impact.</p></div><Link className="hub-secondary-link" href="/trends">Contract Trends</Link></header>
 <section className="panel no-print"><div className="ops-filter-grid" style={{display:"flex",flexWrap:"wrap",gap:12}}>
 <label>Through (Friday)<input type="date" value={end} max={lastFriday()} onChange={e=>{if(e.target.value)setEnd(e.target.value)}}/></label>
 <label>Lookback<select value={weeks} onChange={e=>{const n=Number(e.target.value);setWeeks(n);setMinimum(Math.ceil(n/2))}}>{[4,8,12,14,16].map(n=><option key={n} value={n}>{n} weeks</option>)}</select></label>
 <label>Minimum weeks with misses<select value={minimum} onChange={e=>setMinimum(Number(e.target.value))}>{Array.from({length:weeks-1},(_,i)=>i+2).map(n=><option key={n} value={n}>{n} weeks</option>)}</select></label>
 <label>Contract or trip<input value={query} placeholder="e.g. 280L3" onChange={e=>setQuery(e.target.value)}/></label>
 <button className="hub-secondary-link" onClick={()=>setRefresh(n=>n+1)}>Refresh</button><button className="hub-secondary-link" onClick={()=>{const items=Array.from(document.querySelectorAll<HTMLDetailsElement>("details.watchlist-contract"));const previouslyClosed=items.filter(d=>!d.open);items.forEach(d=>{d.open=true});try{window.print()}finally{previouslyClosed.forEach(d=>{d.open=false})}}} disabled={loading||!!error}>Print report</button></div>
 <p className="ops-summary">Saturday–Friday weeks. Default shows trips with misses in at least half of the selected weeks. The flagged August 7–13 period is excluded, as is 3773G after November 13. Unmapped trips are grouped by contract; they may represent more than one underlying trip. These are investigation leads, not proof of responsibility.</p></section>
 {loading?<p>Checking saved USPS load history…</p>:error?<p role="alert">Unable to load the watchlist: {error}. Choose a completed Friday and retry.</p>:<>
 <section className="panel"><div className="panel-heading"><h2>{start} – {end}</h2><span>Filtered results</span></div><div className="ops-daily-stats"><div><small>Contracts flagged</small><strong>{groups.length}</strong></div><div><small>Recurring trips</small><strong>{groups.reduce((n,g)=>n+g.trips.length,0)}</strong></div><div><small>High priority ({high}+ weeks)</small><strong>{groups.reduce((n,g)=>n+g.high,0)}</strong></div></div><p className="ops-summary">Red = incomplete stops; green = recorded stops with no misses; gray = no recorded stops. Missing data is not counted as successful completion.</p></section>
 {!groups.length&&<p>No trips meet these filters.</p>}
 {groups.map((g,i)=><details open={query.trim().length>0||i<3} className="panel watchlist-contract" key={g.contract} style={{padding:14}}><summary style={{cursor:"pointer",display:"list-item",fontWeight:700,color:"#123b61"}}>{g.contract} · {g.trips.length} flagged · {fmt(g.misses)} incomplete stops · worst {g.trips[0].affected}/{weeks} weeks</summary>
 <div style={{display:"grid",gap:12,marginTop:12}}>{g.trips.map(t=><div key={t.trip} style={{borderTop:"1px solid #dce3e8",paddingTop:12,breakInside:"avoid"}}><div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><strong>Trip {t.trip} · {t.affected}/{t.observed} recorded weeks with misses</strong><Link href={"/missed-load-reviews?"+new URLSearchParams({contract:g.contract,trip:t.trip==="Unmapped"?"":t.trip,start,end})}>Review loads →</Link></div><p style={{fontSize:13,margin:"5px 0"}}>{fmt(t.missed_stops)} incomplete stops · Last missed {t.last_miss} · <Link href={"/contracts/"+encodeURIComponent(g.contract)+"?trip="+encodeURIComponent(t.trip==="Unmapped"?"":t.trip)+"#contract-notes"}>View / add note</Link></p><div style={{display:"flex",gap:3}}>{weekStarts.map((w,i)=>{const state=t.affected_weeks?.includes(w)?"Missed stops":t.observed_weeks?.includes(w)?"No misses":"No data";return <div key={w} title={w+": "+state} aria-label={w+": "+state} style={{flex:1,minWidth:0,textAlign:"center",fontSize:10}}><div style={{height:22,borderRadius:3,background:state==="Missed stops"?"#c66e65":state==="No misses"?"#8aad9b":"#cfd5db"}}/>{i+1}</div>})}</div></div>)}</div></details>)}
 </>}
 </main>;
}
