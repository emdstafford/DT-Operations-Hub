"use client";
import Link from "next/link";
import {useCallback,useEffect,useMemo,useState} from "react";
import {supabase} from "@/lib/supabase";

export type UnassignedTripRow = {week_start:string;week_end:string;contract_number:string;trip_count:number;extra_trip_count:number;revision:number;updated_by:string;updated_at:string};
export const normalizeTripContract=(v:string)=>v.trim().toUpperCase().replace(/^0+/,"");
export const fullTripWeek=(start:string,end:string)=>!!start&&!!end&&new Date(start+"T12:00:00Z").getUTCDay()===6&&new Date(new Date(start+"T12:00:00Z").getTime()+6*86400000).toISOString().slice(0,10)===end;
type Props={start:string;end:string;contracts:string[];onRowsChange:(rows:UnassignedTripRow[],ready:boolean)=>void;summaryOnly?:boolean};
export default function WeeklyUnassignedTrips({start,end,contracts,onRowsChange,summaryOnly=false}:Props){
 const [rows,setRows]=useState<UnassignedTripRow[]>([]);
 const [draft,setDraft]=useState<Record<string,{regular:string;extra:string;baseRevision:number}>>({});
 const [saving,setSaving]=useState<string|null>(null);
 const [selected,setSelected]=useState("");
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [canEdit,setCanEdit]=useState(false);
 const valid=fullTripWeek(start,end);
 const options=useMemo(()=>Array.from(new Set([...contracts,...rows.map(r=>r.contract_number)].map(normalizeTripContract).filter(Boolean))).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),[contracts,rows]);
 const current=options.includes(selected)?selected:options[0]??"";
 const saved=rows.find(r=>r.contract_number===current);
 const currentDraft=draft[current]??{regular:String(saved?.trip_count??""),extra:String(saved?.extra_trip_count??""),baseRevision:saved?.revision??0};
 const totals=rows.reduce((a,r)=>({regular:a.regular+r.trip_count,extra:a.extra+r.extra_trip_count}),{regular:0,extra:0});
 const load=useCallback(async()=>{
  if(!valid){setRows([]);setLoading(false);onRowsChange([],true);return;}
  setLoading(true);
  const {data,error:err}=await supabase.from("weekly_unassigned_trips").select("week_start,week_end,contract_number,trip_count,extra_trip_count,revision,updated_by,updated_at").eq("week_start",start).order("contract_number");
  if(err){setError(err.message);onRowsChange([],false);}
  else{const next=data as UnassignedTripRow[]??[];setRows(next);onRowsChange(next,true);setError("");}
  setLoading(false);
 },[valid,start,onRowsChange]);
 useEffect(()=>{
  let active=true;
  void supabase.auth.getUser().then(async ({data})=>{
   if(!data.user?.email)return;
   const {data:approval}=await supabase.from("approved_users").select("role").eq("email",data.user.email.toLowerCase()).eq("active",true).maybeSingle();
   if(active)setCanEdit(approval?.role==="admin"||approval?.role==="uploader");
  });
  return()=>{active=false;};
 },[]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{
  if(!valid)return;
  const channel=supabase.channel("unassigned-"+start).on("postgres_changes",{event:"*",schema:"public",table:"weekly_unassigned_trips",filter:"week_start=eq."+start},()=>{void load();}).subscribe();
  return()=>{void supabase.removeChannel(channel);};
 },[start,valid,load]);
 function edit(kind:"regular"|"extra",value:string){setDraft(old=>({...old,[current]:{...currentDraft,[kind]:value}}));}
 async function save(){
  if(!current||!valid)return;
  if(!/^(0|[1-9][0-9]*)$/.test(currentDraft.regular)||!/^(0|[1-9][0-9]*)$/.test(currentDraft.extra)){setError("Enter whole-number counts for both regular and extra trips (zero is allowed).");return;}
  setSaving(current);setError("");
  const {error:err}=await supabase.rpc("save_weekly_unassigned_trip_count",{p_week_start:start,p_contract:current,p_count:Number(currentDraft.regular),p_extra_count:Number(currentDraft.extra),p_expected_revision:currentDraft.baseRevision});
  if(err){await load();setError(err.message);}
  else{setDraft(old=>{const next={...old};delete next[current];return next;});await load();}
  setSaving(null);
 }
 if(summaryOnly)return <section className="panel" style={{padding:20,marginBottom:18}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"center"}}>
   <div><p className="eyebrow">Weekly summary</p><h2 style={{margin:"4px 0 6px"}}>Unassigned Trips</h2><p style={{margin:0,color:"#667789",fontSize:13}}>{start} – {end} · {loading?"Loading…":!valid?"Select a full Saturday–Friday week":rows.length?`${rows.length} contracts saved`:"Not entered"}</p></div>
   <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}><span>Regular <strong>{totals.regular}</strong></span><span>Extra <strong>{totals.extra}</strong></span><span>Total <strong>{totals.regular+totals.extra}</strong></span><Link className="primary-link" href="/unassigned-trips">Open Unassigned Trips</Link></div>
  </div>
 </section>;
 return <section className="panel" style={{padding:20,marginBottom:18}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
   <div><p className="eyebrow">Shared weekly entry</p><h2 style={{margin:"4px 0 8px"}}>Unassigned Trips</h2><p style={{margin:0,fontSize:13,color:"#667789"}}>{start} through {end} · Regular and Extra trips are tracked separately</p></div>
   <div style={{display:"flex",gap:20}}><div><small>Regular</small><strong style={{display:"block",fontSize:24}}>{totals.regular}</strong></div><div><small>Extra</small><strong style={{display:"block",fontSize:24}}>{totals.extra}</strong></div><div><small>Total</small><strong style={{display:"block",fontSize:24}}>{totals.regular+totals.extra}</strong></div></div>
  </div>
  {!valid?<p style={{marginTop:14}}>Choose a full Saturday–Friday reporting week to enter or edit trip counts. Other date ranges remain available for viewing reports.</p>:<>
   <p style={{fontSize:13,color:"#667789"}}>{loading?"Loading saved weekly counts…":rows.length?rows.length+" contracts entered for this week":"Not entered — no counts have been saved for this week."}</p>
   {canEdit&&<div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"end"}}>
    <label style={{display:"grid",gap:4}}>Contract<select value={current} onChange={e=>setSelected(e.target.value)} style={{padding:9,minWidth:130}}>{options.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
    <label style={{display:"grid",gap:4}}>Regular trips<input type="number" min="0" step="1" value={currentDraft.regular} onChange={e=>edit("regular",e.target.value)} style={{width:110,padding:9}} /></label>
    <label style={{display:"grid",gap:4}}>Extra trips<input type="number" min="0" step="1" value={currentDraft.extra} onChange={e=>edit("extra",e.target.value)} style={{width:110,padding:9}} /></label>
    <button className="primary-link" disabled={!current||!!saving||loading} onClick={()=>void save()}>{saving?"Saving…":"Save counts"}</button>
   </div>}
   {!!rows.length&&<div style={{overflowX:"auto",marginTop:14}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr><th align="left">Contract</th><th align="right">Regular</th><th align="right">Extra</th><th align="right">Total</th><th align="left">Last updated by</th></tr></thead><tbody>{rows.map(r=><tr key={r.contract_number} style={{borderTop:"1px solid #e1e7ed"}}><td style={{padding:"7px 0"}}>{r.contract_number}</td><td align="right">{r.trip_count}</td><td align="right">{r.extra_trip_count}</td><td align="right">{r.trip_count+r.extra_trip_count}</td><td style={{paddingLeft:12}}>{r.updated_by}</td></tr>)}</tbody></table></div>}
   {error&&<p role="alert" style={{color:"#8b252d"}}>{error}</p>}
  </>}
 </section>;
}
