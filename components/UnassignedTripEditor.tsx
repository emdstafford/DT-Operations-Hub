"use client";

import Link from "next/link";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {supabase} from "@/lib/supabase";
import {normalizeTripContract,includeUnassignedContract,type UnassignedTripRow} from "@/components/WeeklyUnassignedTrips";

type Draft = {regular:string;extra:string;baseRevision:number};
type ContractPeriod = {contract_number:string;start_date:string|null;end_date:string|null};
type Status = "ready"|"saving"|"saved"|"conflict"|"error";
type RowState = {status:Status;message?:string};
const zero={regular:0,extra:0};
const dateAfter=(date:string,days:number)=>new Date(Date.parse(date+"T12:00:00Z")+days*86400000).toISOString().slice(0,10);
const weekFor=(date:string)=>{const d=new Date(date+"T12:00:00Z"); return dateAfter(date,-((d.getUTCDay()+1)%7));};
const validCount=(n:string)=>/^(0|[1-9]\d*)$/.test(n)&&Number.isSafeInteger(Number(n))&&Number(n)<=2147483647;
const compare=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"});
const dateDisplay=(d:string)=>new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(d+"T12:00:00Z"));
const todayInGeorgia=()=>{
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const part=(type:string)=>parts.find(p=>p.type===type)?.value??"";
 return `${part("year")}-${part("month")}-${part("day")}`;
};

export default function UnassignedTripEditor(){
 const [weekStart,setWeekStart]=useState("");
 const [contracts,setContracts]=useState<string[]>([]);
 const [contractPeriods,setContractPeriods]=useState<ContractPeriod[]>([]);
 const [periodError,setPeriodError]=useState("");
 const [saved,setSaved]=useState<UnassignedTripRow[]>([]);
 const [drafts,setDrafts]=useState<Record<string,Draft>>({});
 const [statuses,setStatuses]=useState<Record<string,RowState>>({});
 const [loading,setLoading]=useState(true);
 const savesInFlight=useRef(new Set<string>());
 const [message,setMessage]=useState("");
 const [readError,setReadError]=useState("");
 const [canEdit,setCanEdit]=useState(false);
 const [hasAccess,setHasAccess]=useState(false);
 const [currentEmail,setCurrentEmail]=useState("");
 const [removing,setRemoving]=useState("");
 const [order,setOrder]=useState<"ascending"|"descending">("ascending");
 const [filter,setFilter]=useState("");
 const [showOnlyPending,setShowOnlyPending]=useState(false);
 const draftsRef=useRef(drafts);

 const weekRef=useRef(weekStart);
 draftsRef.current=drafts;

 weekRef.current=weekStart;
 const end=weekStart?dateAfter(weekStart,6):"";
 const rowsByContract=useMemo(()=>new Map(saved.filter(r=>includeUnassignedContract(r.contract_number)).map(r=>[r.contract_number,r])),[saved]);
 const options=useMemo(()=>Array.from(new Set([...contracts,...saved.map(r=>r.contract_number)].map(normalizeTripContract).filter(c=>Boolean(c)&&includeUnassignedContract(c)))).sort(compare),[contracts,saved]);
 const endedContracts=useMemo(()=>{
  if(!weekStart)return new Set<string>();
  const periods=new Map<string,ContractPeriod[]>();
  for(const row of contractPeriods){
   const key=normalizeTripContract(row.contract_number);
   periods.set(key,[...(periods.get(key)??[]),row]);
  }
  return new Set(options.filter(contract=>{
   // Contract 3773G expired November 13, 2026. Hide it from weeks
   // beginning after that date; keep the final active week and its history.
   if(contract==="3773G")return weekStart>"2026-11-13";
   if(periodError)return false; // Keep all other contracts visible on lookup errors.
   const known=periods.get(contract);
   if(!known?.length)return false; // Unknown dates must never hide a contract.
   // A contract remains selectable if it was in service for any part of the selected week.
   return known.every(period=>Boolean((period.end_date&&period.end_date<weekStart)||(period.start_date&&period.start_date>end)));
  }));
 },[options,contractPeriods,weekStart,end,periodError]);
 const available=useMemo(()=>options.filter(c=>!endedContracts.has(c)||!!drafts[c]),[options,endedContracts,drafts]);
 const filtered=useMemo(()=>available.filter(c=>(!filter||c.toLowerCase().includes(filter.toLowerCase()))&&(!showOnlyPending||!rowsByContract.has(c)||!!drafts[c])).sort((a,b)=>order==="ascending"?compare(a,b):compare(b,a)),[available,filter,showOnlyPending,rowsByContract,drafts,order]);
 const pending=Object.keys(drafts).length;
 const totals=saved.filter(r=>includeUnassignedContract(r.contract_number)).reduce((a,r)=>({regular:a.regular+r.trip_count,extra:a.extra+r.extra_trip_count}),zero);
 const readyCount=available.filter(c=>rowsByContract.has(c)).length;
 const ownSaved=saved.filter(r=>r.updated_by.toLowerCase()===currentEmail&&includeUnassignedContract(r.contract_number));

 const refresh=useCallback(async(start:string)=>{
  const {data,error}=await supabase.from("weekly_unassigned_trips").select("week_start,week_end,contract_number,trip_count,extra_trip_count,revision,updated_by,updated_at").eq("week_start",start);
  if(start!==weekRef.current)return;
  if(error){setReadError("Could not load saved counts: "+error.message);return;}
  setReadError("");
  setSaved((data??[]) as UnassignedTripRow[]);
 },[]);
 useEffect(()=>{
  let active=true;
  void (async()=>{
   const {data:user}=await supabase.auth.getUser();
   const email=user.user?.email?.toLowerCase();
   if(!email){if(active){setLoading(false);setReadError("Please sign in to view this page.");}return;}
   const [approval,contractResult,latest,periodResult]=await Promise.all([
    supabase.from("approved_users").select("role").eq("email",email).eq("active",true).maybeSingle(),
    supabase.rpc("contract_options"),
    supabase.from("report_history").select("period_end").eq("report_type","usps_loads").order("period_end",{ascending:false}).limit(1).maybeSingle(),
    supabase.from("contract_supervisors").select("contract_number,start_date,end_date").limit(1000)
   ]);
   if(!active)return;
   setCurrentEmail(email);
   const role=approval.data?.role;
   setCanEdit(role==="admin"||role==="uploader");
   setHasAccess(Boolean(role));
   if(contractResult.error)setReadError("Contract list could not be loaded: "+contractResult.error.message);
   else setContracts((contractResult.data??[]).map((r:{contract_number:string})=>r.contract_number));
   if(periodResult.error)setPeriodError("Contract expiration dates could not be loaded, so all contracts are shown: "+periodResult.error.message);
   else setContractPeriods((periodResult.data??[]) as ContractPeriod[]);
   const anchor=todayInGeorgia();
   setWeekStart(weekFor(anchor));
   setLoading(false);
  })();
  return()=>{active=false;};
 },[]);
 useEffect(()=>{
  if(!weekStart)return;
  weekRef.current=weekStart;
  setSaved([]);
  setDrafts({});
  setStatuses({});
  setMessage("");
  void refresh(weekStart);
  const channel=supabase.channel("unassigned-editor-"+weekStart)
   .on("postgres_changes",{event:"*",schema:"public",table:"weekly_unassigned_trips",filter:"week_start=eq."+weekStart},()=>{void refresh(weekStart);}).subscribe();
  // Recover when a network connection drops or the other editor saves while this window is hidden.
  const poll=window.setInterval(()=>{void refresh(weekStart);},5000);
  const onFocus=()=>{void refresh(weekStart);};
  window.addEventListener("focus",onFocus);
  return()=>{window.clearInterval(poll);window.removeEventListener("focus",onFocus);void supabase.removeChannel(channel);};
 },[weekStart,refresh]);

 function edit(contract:string,kind:"regular"|"extra",value:string){
  const baseline=rowsByContract.get(contract);
  setDrafts(prev=>{
   const before=prev[contract]??{regular:String(baseline?.trip_count??""),extra:String(baseline?.extra_trip_count??""),baseRevision:baseline?.revision??0};
   const next={...before,[kind]:value};
   if(next.regular===String(baseline?.trip_count??"")&&next.extra===String(baseline?.extra_trip_count??"")){
    const copy={...prev};delete copy[contract];return copy;
   }
   return {...prev,[contract]:next};
  });
  setStatuses(prev=>({...prev,[contract]:{status:"ready"}}));
  setMessage("");
 }
 function discard(contract:string){
  if(savesInFlight.current.has(contract)){setMessage("This contract is saving. Once saved, use Remove saved entry to undo it.");return;}
  setDrafts(prev=>{const next={...prev};delete next[contract];return next;});
  setStatuses(prev=>{const next={...prev};delete next[contract];return next;});
 }
 const persist=useCallback(async(contract:string,week:string)=>{
  if(weekRef.current!==week||savesInFlight.current.has(contract))return;
  const values=draftsRef.current[contract];
  if(!values)return;
  const regular=values.regular===""?0:Number(values.regular);
  const extra=values.extra===""?0:Number(values.extra);
  if((values.regular===""&&values.extra==="")||!validCount(String(regular))||!validCount(String(extra)))return;
  savesInFlight.current.add(contract);
  setStatuses(prev=>({...prev,[contract]:{status:"saving"}}));
  const {error}=await supabase.rpc("save_weekly_unassigned_trip_count",{
   p_week_start:week,p_contract:contract,p_count:regular,p_extra_count:extra,p_expected_revision:values.baseRevision
  });
  if(weekRef.current===week){
   if(error){
    const conflict=/changed by another user/i.test(error.message);
    setStatuses(prev=>({...prev,[contract]:{status:conflict?"conflict":"error",message:conflict?"Another editor saved this contract first. Review their count and choose Discard to use the latest values.":error.message}}));
   }else{
    setDrafts(prev=>{
     const next={...prev};
     if(next[contract]?.regular===values.regular&&next[contract]?.extra===values.extra&&next[contract]?.baseRevision===values.baseRevision)delete next[contract];
     else if(next[contract]?.baseRevision===values.baseRevision)next[contract]={...next[contract],baseRevision:values.baseRevision+1};
     return next;
    });
    setStatuses(prev=>({...prev,[contract]:{status:"saved"}}));
   }
   await refresh(week);
  }
  savesInFlight.current.delete(contract);
 },[refresh]);
 useEffect(()=>{
  if(!weekStart||!canEdit)return;
  const timers=Object.entries(drafts)
   .filter(([contract,d])=>!savesInFlight.current.has(contract)&&statuses[contract]?.status!=="conflict"&&statuses[contract]?.status!=="error"&&(d.regular!==""||d.extra!==""))
   .map(([contract])=>window.setTimeout(()=>{void persist(contract,weekStart);},850));
  return()=>{timers.forEach(t=>window.clearTimeout(t));};
 },[drafts,statuses,weekStart,canEdit,persist]);

 async function removeSavedEntry(contract:string){
  const existing=rowsByContract.get(contract);
  if(!existing||!canEdit||existing.updated_by.toLowerCase()!==currentEmail||removing||drafts[contract]||savesInFlight.current.size)return;
  if(!window.confirm(`Remove the saved counts for contract ${contract} from ${dateDisplay(weekStart)}–${dateDisplay(end)}? This does not affect another reporting week or contract.`))return;
  setRemoving(contract);setMessage("");
  const {error}=await supabase.rpc("remove_my_unassigned_trip_count",{p_week_start:weekStart,p_contract:contract,p_expected_revision:existing.revision});
  if(error)setMessage("Could not remove "+contract+": "+error.message);
  else {await refresh(weekStart);setMessage("Removed the saved entry for "+contract+" from this reporting week. A removal audit was retained.");}
  setRemoving("");
 }
 async function removeMyWeek(){
  if(!weekStart||!canEdit||!currentEmail||!ownSaved.length||removing||pending||savesInFlight.current.size)return;
  const count=ownSaved.length;
  const confirmed=window.prompt(`Remove your ${count} saved contract entries for ${dateDisplay(weekStart)}–${dateDisplay(end)}? Chasity's entries and other weeks will remain unchanged. Type REMOVE to confirm.`);
  if(confirmed!=="REMOVE")return;
  setRemoving("week");setMessage("");
  const {data,error}=await supabase.rpc("remove_my_unassigned_trip_counts_for_week",{p_week_start:weekStart});
  if(error)setMessage("Could not remove this week's entries: "+error.message);
  else {await refresh(weekStart);setMessage(`Removed ${Number(data??0)} of your saved entries from ${dateDisplay(weekStart)}–${dateDisplay(end)}. A removal audit was retained. Other editors' entries were not changed.`);}
  setRemoving("");
 }
 function changeWeek(value:string){
  if(!value)return;
  if((pending||savesInFlight.current.size>0||!!removing)&&!window.confirm("Entries may still be saving. Switch reporting weeks and discard unfinished edits?"))return;
  setWeekStart(weekFor(value));
 }
 if(!hasAccess&&!loading)return <main className="page-shell"><p>You do not have access to this page.</p></main>;
 return <main className="page-shell">
  <header className="page-intro"><div><p className="eyebrow">Davenport Transportation</p><h1>Unassigned Trips</h1><p>Shared weekly entry for regular and extra unassigned trips. You can work from the top while another editor works from the bottom.</p></div><Link className="hub-secondary-link" href="/">Back to Dashboard</Link></header>
  <section className="panel" style={{padding:20,marginBottom:16}}>
   <div style={{display:"flex",gap:18,alignItems:"end",flexWrap:"wrap",justifyContent:"space-between"}}>
    <label style={{display:"grid",gap:5,fontWeight:700}}>Reporting week (Saturday–Friday)<input type="date" value={weekStart} onChange={e=>changeWeek(e.target.value)} style={{padding:10,border:"1px solid #bcc8d3",borderRadius:6}} /></label>
    <div style={{display:"flex",gap:20,flexWrap:"wrap"}}><div><small>Regular</small><strong style={{display:"block",fontSize:24}}>{totals.regular}</strong></div><div><small>Extra</small><strong style={{display:"block",fontSize:24}}>{totals.extra}</strong></div><div><small>Total</small><strong style={{display:"block",fontSize:24}}>{totals.regular+totals.extra}</strong></div><div><small>Contracts saved</small><strong style={{display:"block",fontSize:24}}>{readyCount} / {available.length}</strong></div></div>
   </div>
   <p style={{fontSize:13,color:"#526171",marginBottom:0}}>{weekStart?`${dateDisplay(weekStart)} – ${dateDisplay(end)}`:"Loading reporting week…"} · Both editors must select the same reporting week. Counts save automatically after you type; blanks remain unentered until edited.</p>
  </section>
  <section className="panel" style={{padding:"16px 20px",marginBottom:16,borderLeft:"4px solid #123b61"}} aria-label="LoadTrek search instructions">
   <h2 style={{margin:"0 0 8px",fontSize:18}}>LoadTrek search checklist</h2>
   <p style={{margin:"0 0 10px",color:"#526171",fontSize:13}}>Before counting trips, use these search settings in LoadTrek for the reporting week selected above.</p>
   <div style={{display:"flex",gap:22,flexWrap:"wrap",alignItems:"center"}}>
    <div><strong style={{display:"block",fontSize:12,color:"#526171"}}>Date range (inclusive)</strong><strong style={{display:"block",fontSize:16,color:"#123b61"}}>{weekStart?`${dateDisplay(weekStart)} – ${dateDisplay(end)}`:"Select a reporting week above"}</strong></div>
    <div><strong style={{display:"block",fontSize:12,color:"#526171"}}>Include all three search selections</strong><span style={{display:"block",fontSize:14,fontWeight:700}}>Unassigned · Assigned · USPS Remote Tenders</span></div>
   </div>
   <p style={{fontSize:12,margin:"10px 0 0",color:"#526171"}}>Use the same Saturday–Friday dates in both LoadTrek and this page. Enter Regular and Extra unassigned counts in their separate columns below.</p>
  </section>
  <section className="panel" style={{padding:20}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"end",marginBottom:16}}>
    <div><h2 style={{margin:"0 0 6px"}}>Contracts for this reporting week</h2><span style={{fontSize:13,color:"#667789"}}>Counts save individually per contract, preventing one editor from replacing the other editor&apos;s entries.</span></div>
    <span role="status" style={{fontWeight:700,color:"#123b61"}}>{pending?`${pending} row(s) pending autosave`:"All changes saved"}</span>
   </div>
   <div style={{display:"flex",gap:16,alignItems:"end",flexWrap:"wrap",marginBottom:16}}>
    <label style={{display:"grid",gap:5}}>Find contract<input type="search" placeholder="Contract number" value={filter} onChange={e=>setFilter(e.target.value)} style={{padding:9,border:"1px solid #bcc8d3",borderRadius:6}} /></label>
    <label style={{display:"grid",gap:5}}>Order<select value={order} onChange={e=>setOrder(e.target.value as "ascending"|"descending")} style={{padding:9,border:"1px solid #bcc8d3",borderRadius:6}}><option value="ascending">Contract number: low to high</option><option value="descending">Contract number: high to low</option></select></label>
    <label style={{display:"flex",gap:6,alignItems:"center",paddingBottom:10}}><input type="checkbox" checked={showOnlyPending} onChange={e=>setShowOnlyPending(e.target.checked)} />Only not entered / unsaved</label>
   </div>
   {readError&&<p className="alert alert-error" role="alert">{readError}</p>}
   {periodError&&<p className="alert alert-error" role="alert">{periodError}</p>}
   {!periodError&&endedContracts.size>0&&<p style={{fontSize:13,color:"#526171"}}>{endedContracts.size} ended contracts excluded for this reporting week. They remain available in earlier weeks when their service dates overlap.</p>}
   {message&&<p role="status" style={{color:"#123b61",fontWeight:600}}>{message}</p>}
   {canEdit&&ownSaved.length>0&&<div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:14,padding:"10px 12px",border:"1px solid #d8e1e8",borderRadius:7}}>
     <span style={{fontSize:13}}>Wrong reporting week? You have {ownSaved.length} saved contract entr{ownSaved.length===1?"y":"ies"} for {dateDisplay(weekStart)}–{dateDisplay(end)}.</span>
     <button type="button" disabled={!!removing||pending>0||savesInFlight.current.size>0} onClick={()=>void removeMyWeek()} style={{background:"white",color:"#8d2734",border:"1px solid #b47a80",borderRadius:6,padding:"8px 11px",fontWeight:700,cursor:"pointer"}}>{removing==="week"?"Removing…":"Remove my saved entries for this week"}</button>
     <small style={{color:"#667789"}}>Requires confirmation. Does not remove another person's entries.</small>
   </div>}
   <div style={{overflowX:"auto"}}>
   <table style={{width:"100%",borderCollapse:"collapse",minWidth:690,fontSize:13}}>
    <thead><tr style={{background:"#123b61",color:"white"}}><th style={{padding:10,textAlign:"left"}}>Contract</th><th style={{padding:10,textAlign:"right"}}>Regular unassigned</th><th style={{padding:10,textAlign:"right"}}>Extra unassigned</th><th style={{padding:10,textAlign:"right"}}>Total</th><th style={{padding:10,textAlign:"left"}}>Status / last updated by</th><th style={{padding:10}}> </th></tr></thead>
    <tbody>{filtered.map(contract=>{
     const current=rowsByContract.get(contract);
     const draft=drafts[contract];
     const state=statuses[contract];
     const regular=draft?.regular??String(current?.trip_count??"");
     const extra=draft?.extra??String(current?.extra_trip_count??"");
     const total=validCount(regular)&&validCount(extra)?Number(regular)+Number(extra):"—";
     return <tr key={contract} style={{borderBottom:"1px solid #e1e6eb",background:state?.status==="conflict"?"#fff1ed":draft?"#fff9e6":"transparent"}}>
      <td style={{padding:"9px 10px",fontWeight:700}}>{contract}</td>
      <td style={{padding:"6px 10px",textAlign:"right"}}><input type="number" min="0" step="1" aria-label={`Regular unassigned trips for ${contract}`} value={regular} disabled={!canEdit} onChange={e=>edit(contract,"regular",e.target.value)} placeholder="—" style={{width:98,padding:7,textAlign:"right",border:"1px solid #bcc8d3",borderRadius:6}} /></td>
      <td style={{padding:"6px 10px",textAlign:"right"}}><input type="number" min="0" step="1" aria-label={`Extra unassigned trips for ${contract}`} value={extra} disabled={!canEdit} onChange={e=>edit(contract,"extra",e.target.value)} placeholder="—" style={{width:98,padding:7,textAlign:"right",border:"1px solid #bcc8d3",borderRadius:6}} /></td>
      <td style={{padding:"9px 10px",textAlign:"right",fontWeight:700}}>{total}</td>
      <td style={{padding:"8px 10px",color:state?.status==="conflict"?"#9d2929":"#526171"}}>{state?.status==="conflict"||state?.status==="error"?state.message:state?.status==="saving"?"Saving…":draft?"Saving automatically…":current?`Saved · ${current.updated_by}`:"Not entered"}</td>
      <td style={{padding:6}}>{draft?
        <button type="button" onClick={()=>discard(contract)} disabled={savesInFlight.current.has(contract)||!!removing} style={{border:"1px solid #bcc8d3",borderRadius:6,padding:"5px 9px",background:"white",cursor:"pointer",whiteSpace:"nowrap"}}>Discard unsaved edit</button>
       :current&&current.updated_by.toLowerCase()===currentEmail&&canEdit?
        <button type="button" onClick={()=>void removeSavedEntry(contract)} disabled={!!removing||pending>0||savesInFlight.current.size>0} style={{border:"1px solid #b47a80",color:"#8d2734",borderRadius:6,padding:"5px 9px",background:"white",cursor:"pointer",whiteSpace:"nowrap"}}>{removing===contract?"Removing…":"Remove saved entry"}</button>:null}</td>
     </tr>;
    })}</tbody>
   </table>
   {!filtered.length&&!loading&&<p>No matching contracts.</p>}
   </div>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",marginTop:16}}>
    <span style={{fontSize:13,color:"#667789"}}>{filtered.length} active contracts displayed · {pending} unsaved · Saved counts from both editors refresh every 5 seconds.</span>
    <span role="status" style={{fontWeight:700,color:"#123b61"}}>{pending?`${pending} row(s) pending autosave`:"All changes saved"}</span>
   </div>
  </section>
 </main>;
}
