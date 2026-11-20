"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {supabase} from "@/lib/supabase";
import {useAccessRole} from "@/components/AccessRole";

type Recipient={name:string;email:string;recipient_type:"supervisor"|"distribution"|"bcc";enabled:boolean};
type Performance={supervisor?:string;contract_number?:string;total_stops:number;completed_stops:number;incomplete_stops:number;completion_percent:number;load_count:number};
type DashboardData={totals:Performance;supervisors:Performance[];supervisor_contracts:Performance[];contracts:Performance[]};
const empty:DashboardData={totals:{total_stops:0,completed_stops:0,incomplete_stops:0,completion_percent:0,load_count:0},supervisors:[],supervisor_contracts:[],contracts:[]};
const fmt=(n:number)=>Number(n||0).toLocaleString("en-US");
const pct=(n:number)=>((Number(n)||0)*100).toFixed(2)+"%";
const dateInNewYork=()=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const part=(name:string)=>parts.find(p=>p.type===name)?.value||"";return [part("year"),part("month"),part("day")].join("-")};
const yesterday=()=>new Date(Date.parse(dateInNewYork()+"T12:00:00Z")-86400000).toISOString().slice(0,10);
const formatDate=(value:string)=>new Intl.DateTimeFormat("en-US",{timeZone:"UTC",year:"numeric",month:"long",day:"numeric"}).format(new Date(value+"T12:00:00Z"));
const clean=(value:string)=>value.trim().toLowerCase();
const distinct=(emails:string[])=>[...new Set(emails.filter(Boolean).map(clean))];
const line=(row:Performance)=>[row.supervisor||row.contract_number||"Unassigned",pct(row.completion_percent),fmt(row.total_stops),fmt(row.completed_stops),fmt(row.incomplete_stops)].join(" | ");
const header="Supervisor / Contract | Completion | Total stops | Completed | Missed";

export default function DailyReportsPage(){
 const role=useAccessRole();
 const [day,setDay]=useState(yesterday);
 const [directory,setDirectory]=useState<Recipient[]>([]);
 const [drafts,setDrafts]=useState<Record<string,string>>({});
 const [data,setData]=useState<DashboardData>(empty);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [saving,setSaving]=useState("");
 const [message,setMessage]=useState("");
 const allowed=role==="admin";

 const refresh=useCallback(async()=>{
  if(!allowed)return;
  setLoading(true);setError("");setMessage("");
  const [recipients,report]=await Promise.all([
   supabase.from("daily_report_recipients").select("name,email,recipient_type,enabled").order("recipient_type").order("name"),
   supabase.rpc("dashboard_hub_filtered",{p_start:day,p_end:day,p_grain:"day",p_contracts:null,p_supervisors:null,p_exclude_august_2026:false,p_max_completion:null,p_min_missed_stops:null})
  ]);
  if(recipients.error||report.error){setError(recipients.error?.message||report.error?.message||"Unable to load reports");setLoading(false);return;}
  const saved=recipients.data as Recipient[];
  setDirectory(saved);setDrafts(Object.fromEntries(saved.map(r=>[r.name,r.email])));
  setData((report.data as unknown as DashboardData)||empty);setLoading(false);
 },[allowed,day]);
 useEffect(()=>{void refresh()},[refresh]);

 const listed=useMemo(()=>data.supervisors.filter(r=>r.supervisor&&r.supervisor!=="Unassigned"&&Number(r.total_stops)>0),[data]);
 const below=listed.filter(r=>Number(r.completion_percent)<0.95);
 const active=directory.filter(r=>r.enabled);
 const lookup=(name:string)=>active.find(r=>r.recipient_type==="supervisor"&&clean(r.name)===clean(name));
 const supervisors=active.filter(r=>r.recipient_type==="supervisor");
 const distribution=active.filter(r=>r.recipient_type==="distribution");
 const bcc=active.filter(r=>r.recipient_type==="bcc");
 const missing=listed.filter(r=>!lookup(r.supervisor||""));
 const dayReady=Number(data.totals.total_stops)>0;
 const generalTo=distinct([...supervisors.map(r=>r.email),...distribution.map(r=>r.email)]);
 const generalBcc=distinct(bcc.map(r=>r.email));
 const oversight=distinct(distribution.filter(r=>["Emily Stafford","Chasity Cochran","Gary"].includes(r.name)).map(r=>r.email));
 const companyBody=[
  "Davenport Transportation — USPS Daily Completion Report",
  "Operating day: "+formatDate(day),
  "Overall completion: "+pct(data.totals.completion_percent),
  "Total stops: "+fmt(data.totals.total_stops)+" | Completed: "+fmt(data.totals.completed_stops)+" | Missed: "+fmt(data.totals.incomplete_stops),
  "",
  "Supervisor Performance",header,...listed.map(line),"",
  "Contract Performance",header,...data.contracts.map(line),"",
  "DT Hub: https://dt-intelligence-hub.vercel.app/"
 ].join("\n");
 const individualBody=(r:Performance)=>{
  const contracts=data.supervisor_contracts.filter(c=>c.supervisor===r.supervisor);
  return [
   "Davenport Transportation — Daily Supervisor Performance Review",
   "Operating day: "+formatDate(day),
   "Supervisor: "+r.supervisor,
   "Completion: "+pct(r.completion_percent)+" (below the 95% expectation)",
   "Total stops: "+fmt(r.total_stops)+" | Completed: "+fmt(r.completed_stops)+" | Missed: "+fmt(r.incomplete_stops),
   "", "Contract Breakdown",header,...contracts.map(line),
   "", "Please review the missed stops and document the relevant explanations in DT Hub.",
   "https://dt-intelligence-hub.vercel.app/missed-load-reviews"
  ].join("\n");
 };
 async function copy(content:string){
  try{await navigator.clipboard.writeText(content);setMessage("Copied report preview. This does not send an email.");}
  catch{setError("Clipboard access is unavailable in this browser.");}
 }
 async function saveRecipient(r:Recipient){
  const email=(drafts[r.name]||"").trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setError("Enter a valid email for "+r.name);return;}
  setSaving(r.name);setError("");setMessage("");
  const response=await supabase.from("daily_report_recipients").update({email,updated_at:new Date().toISOString()}).eq("name",r.name);
  if(response.error)setError(response.error.message);
  else{setDirectory(current=>current.map(c=>c.name===r.name?{...c,email}:c));setMessage("Saved "+r.name+"'s email.");}
  setSaving("");
 }
 async function toggleRecipient(r:Recipient){
  setSaving(r.name);setError("");setMessage("");
  const response=await supabase.from("daily_report_recipients").update({enabled:!r.enabled,updated_at:new Date().toISOString()}).eq("name",r.name);
  if(response.error)setError(response.error.message);
  else setDirectory(current=>current.map(c=>c.name===r.name?{...c,enabled:!c.enabled}:c));
  setSaving("");
 }
 if(!allowed)return <main className="page-shell operations-polish"><h1>Daily Email Reports</h1><p>Only approved DT administrators can manage recipients and report previews.</p></main>;
 return <main className="page-shell dashboard-page operations-polish ops-daily-reports">
   <header className="hub-header"><div><p className="eyebrow">DT Intelligence Hub</p><h1>Daily Email Reports</h1><p>Preview previous-day results, verify recipients, and prepare the 7:00 AM Eastern distribution.</p></div><Link className="hub-secondary-link" href="/">Dashboard</Link></header>
   <section className="panel">
    <div className="panel-heading"><div><h2>Automation status</h2><span>Sender: it@dtexpress.net · Daily at 7:00 AM Eastern</span></div><strong className="ops-automation-off">Sending not connected</strong></div>
    <p className="ops-summary">Recipient directory and daily previews are available. <strong>Automatic ingestion and email sending are NOT enabled.</strong> Microsoft Power Automate and the shared-mailbox connection must be configured and tested first. No messages are sent from this page.</p>
    <div className="ops-filter-grid"><label>Operating day<input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label><div className="ops-daily-actions"><button type="button" className="hub-secondary-link" onClick={()=>setDay(yesterday())}>Previous day</button><button type="button" className="hub-secondary-link" onClick={()=>void refresh()} disabled={loading}>{loading?"Loading…":"Refresh"}</button></div></div>
   </section>
   {error&&<div className="alert alert-error" role="alert">{error}</div>}
   {message&&<p role="status" className="ops-inline-note">{message}</p>}
   {loading?<section className="panel ops-form-section">Loading daily performance…</section>:<>
    <section className="panel">
     <div className="panel-heading"><div><h2>Previous-day performance</h2><span>{formatDate(day)}</span></div><span>{dayReady?below.length+" supervisor(s) below 95%":"No saved stops for this day"}</span></div>
     <div className="ops-daily-stats">
      <div><small>Completion</small><strong>{dayReady?pct(data.totals.completion_percent):"—"}</strong></div>
      <div><small>Missed stops</small><strong>{fmt(data.totals.incomplete_stops)}</strong></div>
      <div><small>Supervisors below 95%</small><strong>{below.length}</strong></div>
      <div><small>Supervisor emails missing</small><strong>{missing.length}</strong></div>
     </div>
     {!dayReady?<p className="ops-summary">No saved loads exist for this operating day. Do not send the daily report until the FourKites file has been fully imported and verified.</p>:missing.length>0?<p className="ops-summary">Recipient check: {missing.map(r=>r.supervisor).join(", ")} {missing.length===1?"does":"do"} not have an active matching address in the directory. Confirm before turning on distribution.</p>:<p className="ops-summary">Supervisor addresses matched for the selected day. Verify report completeness before any automatic sending.</p>}
    </section>
    {dayReady&&<section className="panel">
     <div className="panel-heading"><div><h2>Company-wide report preview</h2><span>To: {generalTo.length} unique addresses · BCC: {generalBcc.length} · same report every day</span></div><button className="hub-secondary-link" onClick={()=>void copy(companyBody)}>Copy preview</button></div>
     <pre className="ops-daily-preview">{companyBody}</pre>
    </section>}
    <section className="panel">
     <div className="panel-heading"><div><h2>Individual reports below 95%</h2><span>Each includes the supervisor, Gary, Chasity, and Emily</span></div></div>
     {!below.length?<p className="ops-summary">{dayReady?"No supervisor is below 95% for this day.":"No completed daily report to evaluate yet."}</p>:below.map(r=>{
       const recipient=lookup(r.supervisor||"");
       const to=distinct([...(recipient?[recipient.email]:[]),...oversight]);
       return <details className="ops-daily-individual" key={r.supervisor}><summary><strong>{r.supervisor}</strong><span>{pct(r.completion_percent)} · {fmt(r.incomplete_stops)} missed · {recipient?recipient.email:"ADDRESS MISSING"}</span></summary>
        <div className="ops-daily-individual-content"><p><strong>To:</strong> {to.join("; ")}</p><pre className="ops-daily-preview">{individualBody(r)}</pre><button className="hub-secondary-link" onClick={()=>void copy(individualBody(r))}>Copy individual preview</button></div></details>;
     })}
    </section>
    <section className="panel">
     <div className="panel-heading"><div><h2>Recipient directory</h2><span>Admin-only · saved centrally · names must match Dashboard supervisor names</span></div></div>
     <p className="ops-summary">Supervisors get the company-wide report. Gary, Emily, Chasity and Sabrina are included in the main distribution; Rachelle and Cindy receive the company-wide report as BCC. Individual under-95% reports go only to the affected supervisor plus Gary, Emily and Chasity.</p>
     <div className="table-scroll"><table className="data-table"><thead><tr><th>Name</th><th>Group</th><th>Email</th><th>Active</th><th></th></tr></thead><tbody>{directory.map(r=><tr key={r.name}><td><strong>{r.name}</strong></td><td>{r.recipient_type==="bcc"?"BCC":r.recipient_type==="distribution"?"Distribution":"Supervisor"}</td><td><input aria-label={"Email for "+r.name} type="email" value={drafts[r.name]??r.email} onChange={e=>setDrafts(current=>({...current,[r.name]:e.target.value}))}/></td><td><input type="checkbox" aria-label={"Include "+r.name} checked={r.enabled} disabled={saving===r.name} onChange={()=>void toggleRecipient(r)}/></td><td><button type="button" className="hub-secondary-link" disabled={saving===r.name||clean(drafts[r.name]??r.email)===clean(r.email)} onClick={()=>void saveRecipient(r)}>{saving===r.name?"Saving…":"Save"}</button></td></tr>)}</tbody></table></div>
    </section>
   </>}
 </main>;
}
