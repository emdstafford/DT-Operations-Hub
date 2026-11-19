"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {supabase} from "@/lib/supabase";
import {useAccessRole} from "@/components/AccessRole";
import {normalizeTripContract} from "@/components/WeeklyUnassignedTrips";

type Load={operating_date:string;contract_number:string|null;trip_number:string|null;load_number:string;supervisors:string[]|null;incomplete_stops:number};
export type MissedLoadReview={id:string;operating_date:string;contract_number:string;trip_number:string;load_number:string;reason:string;explanation:string;source:string;reported_by:string;recorded_by_email:string;review_status:string;ticket_status:string;updated_at:string};
const reasons=["Driver late","Mechanical breakdown","USPS delay","Traffic or weather","Missed stop / route issue","Other","Driver Name Change","Incorrect Times","Incorrect Frequency","Incorrect NASS Code","Incorrect Contract/Trip Assignment"];
const corrections=new Set(reasons.slice(6));
const key=(x:Load|MissedLoadReview)=>[x.operating_date,normalizeTripContract(x.contract_number||""),(x.trip_number||"").trim(),x.load_number.trim()].join("|");
const labels:Record<string,string>={needs_review:"Needs Gary's review",reviewed:"Reviewed",follow_up:"Follow-up needed",not_needed:"Not needed",needs_ticket:"Ticket needed",ticket_sent:"Ticket sent",resolved:"Correction resolved"};
const sources:Record<string,string>={phone:"Phone",text:"Text",email:"Email",in_person:"In person",other:"Other",supervisor_portal:"Supervisor portal"};
type Draft={reason:string;explanation:string;source:string;reported_by:string;review_status:string;ticket_status:string};
const fresh=(r?:MissedLoadReview):Draft=>({reason:r?.reason||"Driver late",explanation:r?.explanation||"",source:r?.source||"phone",reported_by:r?.reported_by||"",review_status:r?.review_status||"needs_review",ticket_status:r?.ticket_status||"not_needed"});
export default function MissedLoadReviewHub(){
 const role=useAccessRole(),canEdit=role==="admin"||role==="uploader",canView=canEdit||role==="viewer";
 const [start,setStart]=useState(()=>{const d=new Date();d.setDate(d.getDate()-6);return d.toISOString().slice(0,10)}),[end,setEnd]=useState(()=>new Date().toISOString().slice(0,10));
 const [loads,setLoads]=useState<Load[]>([]),[reviews,setReviews]=useState<MissedLoadReview[]>([]);
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false);
 const [contract,setContract]=useState(""),[supervisor,setSupervisor]=useState(""),[reasonFilter,setReasonFilter]=useState(""),[status,setStatus]=useState(""),[sort,setSort]=useState("date");
 const [selected,setSelected]=useState(""),[draft,setDraft]=useState<Draft>(fresh()),[events,setEvents]=useState<{changed_at:string;changed_by_email:string;event_type:string}[]>([]);
 const loadData=useCallback(async()=>{
  if(!canView)return;
  if(start>end){setError("The start date must be before the end date.");return;}
  setLoading(true);setError("");
  try{
   const all:Load[]=[];
   for(let offset=0;offset<10000;offset+=1000){
    const res=await supabase.from("usps_loads").select("operating_date,contract_number,trip_number,load_number,supervisors,incomplete_stops").gte("operating_date",start).lte("operating_date",end).gt("incomplete_stops",0).order("operating_date",{ascending:false}).order("load_number").range(offset,offset+999);
    if(res.error)throw res.error;
    all.push(...(res.data||[]) as Load[]);
    if((res.data||[]).length<1000)break;
    if(offset===9000)throw Error("Too many missed loads. Select a shorter date range.");
   }
   const result=await supabase.from("missed_load_reviews").select("*").gte("operating_date",start).lte("operating_date",end).limit(10000);
   if(result.error)throw result.error;
   setLoads(all.filter(l=>!(normalizeTripContract(l.contract_number||"")==="3773G"&&l.operating_date>"2026-11-13")));
   setReviews((result.data||[]) as MissedLoadReview[]);
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  setLoading(false);
 },[start,end,canView]);
 useEffect(()=>{void loadData()},[loadData]);
 const byKey=useMemo(()=>new Map(reviews.map(r=>[key(r),r])),[reviews]);
 const grouped=useMemo(()=>{const map=new Map<string,Load>();loads.forEach(l=>{const id=key(l),old=map.get(id);if(old)old.incomplete_stops+=Number(l.incomplete_stops||0);else map.set(id,{...l,contract_number:normalizeTripContract(l.contract_number||""),supervisors:l.supervisors||[]})});return [...map.values()]},[loads]);
 const allContracts=[...new Set(grouped.map(l=>l.contract_number||""))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 const allSupervisors=[...new Set(grouped.flatMap(l=>l.supervisors||[]))].sort();
 const shown=grouped.filter(l=>{const r=byKey.get(key(l));return (!contract||l.contract_number===contract)&&(!supervisor||(l.supervisors||[]).includes(supervisor))&&(!reasonFilter||(reasonFilter==="unexplained"?!r:r?.reason===reasonFilter))&&(!status||(status==="unexplained"?!r:status.startsWith("ticket:")?r?.ticket_status===status.slice(7):r?.review_status===status))}).sort((a,b)=>sort==="missed"?b.incomplete_stops-a.incomplete_stops:sort==="contract"?(a.contract_number||"").localeCompare(b.contract_number||"",undefined,{numeric:true}):b.operating_date.localeCompare(a.operating_date));
 const current=grouped.find(l=>key(l)===selected),review=current?byKey.get(key(current)):undefined;
 function choose(l:Load){setSelected(key(l));setDraft(fresh(byKey.get(key(l))));setNotice("");setEvents([]);window.setTimeout(()=>document.getElementById("load-review")?.scrollIntoView({behavior:"smooth",block:"start"}),0)}
 useEffect(()=>{if(!review)return;let alive=true;void supabase.from("missed_load_review_events").select("changed_at,changed_by_email,event_type").eq("review_id",review.id).order("changed_at",{ascending:false}).limit(30).then(res=>{if(alive&&!res.error)setEvents(res.data||[])});return()=>{alive=false}},[review?.id,review?.updated_at]);
 async function save(){
  if(!canEdit||!current)return;
  if(!draft.explanation.trim()){setError("Please enter an explanation.");return}
  setSaving(true);setError("");setNotice("");
  const changes={...draft,reported_by:draft.reported_by.trim(),explanation:draft.explanation.trim(),ticket_status:corrections.has(draft.reason)?draft.ticket_status==="not_needed"?"needs_ticket":draft.ticket_status:"not_needed"};
  const result=review?await supabase.from("missed_load_reviews").update(changes).eq("id",review.id).select("*").single():await supabase.from("missed_load_reviews").insert({...changes,operating_date:current.operating_date,contract_number:current.contract_number,trip_number:(current.trip_number||"").trim(),load_number:current.load_number.trim(),supervisors:current.supervisors||[]}).select("*").single();
  if(result.error)setError(result.error.message);else{const saved=result.data as MissedLoadReview;setReviews(prev=>[saved,...prev.filter(r=>r.id!==saved.id)]);setDraft(fresh(saved));setNotice("Explanation saved without changing USPS data.")}
  setSaving(false);
 }
 async function markReviewed(value:"needs_review"|"reviewed"|"follow_up"){
  if(!review||!canView)return;
  setSaving(true);setError("");setNotice("");
  const res=await supabase.rpc("set_missed_load_review_status",{p_review_id:review.id,p_status:value});
  if(res.error)setError(res.error.message);
  else{setReviews(prev=>prev.map(r=>r.id===review.id?{...r,review_status:value,updated_at:new Date().toISOString()}:r));setDraft(d=>({...d,review_status:value}));setNotice("Management review status saved.");}
  setSaving(false);
 }
 function ticket(){
  if(!current)return;
  const lines=["DT Hub correction request","Reason: "+draft.reason,"Contract: "+current.contract_number,"Trip: "+(current.trip_number||"Not supplied"),"Load: "+current.load_number,"Date: "+current.operating_date,"Missed stops: "+current.incomplete_stops,"Reported by: "+(draft.reported_by||"Not specified"),"","Details: "+draft.explanation,"","Correction requested:"];
  window.location.href="mailto:itsupport@dtexpress.net?subject="+encodeURIComponent("DT Hub correction | "+draft.reason+" | "+current.contract_number)+"&body="+encodeURIComponent(lines.join("\n"));
 }
 if(!canView)return <main className="page-shell"><h1>Missed-load reviews</h1><p>Access is restricted to authorized operations reviewers.</p></main>;
 return <main className="page-shell dashboard-page">
  <header className="hub-header"><div><p className="eyebrow">DT Intelligence Hub</p><h1>Missed-load reviews</h1><p>Only loads with missed stops are shown. Explanations never change completion percentages.</p></div><Link href="/" className="hub-secondary-link">Dashboard</Link></header>
  <section className="panel"><div className="panel-heading"><div><h2>Find missed loads</h2><span>Review by load number, not just by contract.</span></div><button className="hub-secondary-link" onClick={()=>void loadData()} disabled={loading}>{loading?"Loading…":"Refresh"}</button></div>
   <div style={{display:"flex",flexWrap:"wrap",gap:12,marginBottom:12}}>
    <label>From <input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label>Through <input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
    <label>Supervisor <select value={supervisor} onChange={e=>setSupervisor(e.target.value)}><option value="">All</option>{allSupervisors.map(s=><option key={s}>{s}</option>)}</select></label>
    <label>Contract <select value={contract} onChange={e=>setContract(e.target.value)}><option value="">All</option>{allContracts.map(s=><option key={s}>{s}</option>)}</select></label>
    <label>Reason <select value={reasonFilter} onChange={e=>setReasonFilter(e.target.value)}><option value="">All</option><option value="unexplained">Awaiting explanation</option>{reasons.map(s=><option key={s}>{s}</option>)}</select></label>
    <label>Status <select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All</option><option value="unexplained">Awaiting explanation</option>{Object.entries(labels).filter(([id])=>!["not_needed"].includes(id)).map(([id,text])=><option key={id} value={["needs_ticket","ticket_sent","resolved"].includes(id)?"ticket:"+id:id}>{text}</option>)}</select></label>
    <label>Sort by <select value={sort} onChange={e=>setSort(e.target.value)}><option value="date">Newest</option><option value="contract">Contract</option><option value="missed">Most missed stops</option></select></label>
   </div>
   {error&&<div className="alert alert-error">{error}</div>}{notice&&<div className="alert">{notice}</div>}
   <p><strong>{shown.length}</strong> affected loads · <strong>{shown.filter(l=>byKey.has(key(l))).length}</strong> explained · <strong>{shown.filter(l=>!byKey.has(key(l))).length}</strong> awaiting explanation</p>
   <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Contract</th><th>Supervisor</th><th>Trip</th><th>Load</th><th>Missed</th><th>Status</th></tr></thead><tbody>{shown.map(l=>{const r=byKey.get(key(l));return <tr key={key(l)}><td>{l.operating_date}</td><td>{l.contract_number}</td><td>{(l.supervisors||[]).join(", ")||"Unassigned"}</td><td>{l.trip_number||"—"}</td><td><button className="day-button" onClick={()=>choose(l)}>{l.load_number}</button></td><td>{l.incomplete_stops}</td><td>{r?labels[r.review_status]:"Awaiting explanation"}{r&&corrections.has(r.reason)?" · "+labels[r.ticket_status]:""}</td></tr>})}</tbody></table></div>{!loading&&!shown.length&&<p>No missed loads match these filters.</p>}
  </section>
  {current&&<section className="panel" id="load-review"><div className="panel-heading"><div><h2>Load {current.load_number}</h2><span>{current.operating_date} · Contract {current.contract_number} · Trip {current.trip_number||"—"} · {current.incomplete_stops} missed stops</span></div><button className="hub-secondary-link" onClick={()=>setSelected("")}>Close</button></div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:12}}>
     <label>Reason <select disabled={!canEdit} value={draft.reason} onChange={e=>{const reason=e.target.value;setDraft(d=>({...d,reason,ticket_status:corrections.has(reason)?d.ticket_status==="not_needed"?"needs_ticket":d.ticket_status:"not_needed"}))}}>{reasons.map(s=><option key={s}>{s}</option>)}</select></label>
     <label>Source <select disabled={!canEdit} value={draft.source} onChange={e=>setDraft(d=>({...d,source:e.target.value}))}>{Object.entries(sources).map(([id,text])=><option key={id} value={id}>{text}</option>)}</select></label>
     <label>Provided by <input disabled={!canEdit} value={draft.reported_by} onChange={e=>setDraft(d=>({...d,reported_by:e.target.value}))} placeholder="Supervisor name"/></label>
     <label>Gary's review <select disabled={!canEdit} value={draft.review_status} onChange={e=>setDraft(d=>({...d,review_status:e.target.value}))}>{["needs_review","reviewed","follow_up"].map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label>
     {corrections.has(draft.reason)&&<label>Ticket status <select disabled={!canEdit} value={draft.ticket_status} onChange={e=>setDraft(d=>({...d,ticket_status:e.target.value}))}>{["needs_ticket","ticket_sent","resolved"].map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label>}
    </div>
    <label>Explanation<textarea rows={3} disabled={!canEdit} value={draft.explanation} onChange={e=>setDraft(d=>({...d,explanation:e.target.value}))} placeholder="Explain this individual missed load and any follow-up required."/></label>
    {review&&<p className="text-muted">Entered by {review.recorded_by_email} · Last updated {new Date(review.updated_at).toLocaleString()}</p>}
    <div style={{display:"flex",flexWrap:"wrap",gap:10,marginTop:12}}>{canEdit&&<button className="primary-link" disabled={saving} onClick={()=>void save()}>{saving?"Saving…":review?"Update explanation":"Save explanation"}</button>}{corrections.has(draft.reason)&&<button className="hub-secondary-link" onClick={ticket}>Open Outlook support ticket</button>}</div>
    {review&&<div style={{display:"flex",gap:10,marginTop:12,flexWrap:"wrap"}}><button className="hub-secondary-link" disabled={saving} onClick={()=>void markReviewed("reviewed")}>Mark reviewed</button><button className="hub-secondary-link" disabled={saving} onClick={()=>void markReviewed("follow_up")}>Needs follow-up</button></div>}
    {corrections.has(draft.reason)&&<p>Opening the Outlook draft does not mean it was sent. Update the ticket status after sending it to itsupport@dtexpress.net.</p>}
    {events.length>0&&<details><summary>Recorded change history ({events.length})</summary>{events.map((e,i)=><p key={i}>{new Date(e.changed_at).toLocaleString()} · {e.event_type} · {e.changed_by_email}</p>)}</details>}
  </section>}
 </main>;
}
