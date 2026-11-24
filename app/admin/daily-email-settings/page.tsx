"use client";

import Link from "next/link";
import {useCallback,useEffect,useMemo,useState} from "react";
import {supabase} from "@/lib/supabase";
import {useAccessRole} from "@/components/AccessRole";

type Settings={id:number;delivery_enabled:boolean;company_enabled:boolean;individual_enabled:boolean;threshold_percent:number;updated_at:string};
type Recipient={name:string;email:string;recipient_type:"supervisor"|"distribution"|"cc"|"bcc";enabled:boolean};
type Assignment={contract_number:string;supervisor:string;start_date?:string|null;end_date?:string|null;active?:boolean|null};
const clean=(value:string)=>value.trim().toLowerCase();
const dateInNewYork=()=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const part=(name:string)=>parts.find(p=>p.type===name)?.value||"";return [part("year"),part("month"),part("day")].join("-")};
const formatDate=(value:string)=>new Intl.DateTimeFormat("en-US",{timeZone:"UTC",year:"numeric",month:"long",day:"numeric"}).format(new Date(value+"T12:00:00Z"));
const emailOk=(s:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isTonya=(r:Recipient)=>/tonya\s*(capps|owens?)/i.test(r.name)||r.email.trim().toLowerCase()==="tocapps@bellsouth.net";

export default function DailyEmailSettingsPage(){
 const role=useAccessRole();
 const [settings,setSettings]=useState<Settings|null>(null);
 const [recipients,setRecipients]=useState<Recipient[]>([]);
 const [assignmentPeriods,setAssignmentPeriods]=useState<Assignment[]>([]);
 const [currentAssignments,setCurrentAssignments]=useState<Assignment[]>([]);
 const [directorySearch,setDirectorySearch]=useState("");
 const [draftEmails,setDraftEmails]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState("");
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const admin=role==="admin";
 const refresh=useCallback(async()=>{
   if(!admin)return;
   setLoading(true);setError("");
   const [s,r,periods,assignments]=await Promise.all([
     supabase.from("daily_email_settings").select("*").eq("id",1).single(),
     supabase.from("daily_report_recipients").select("name,email,recipient_type,enabled").order("recipient_type").order("name"),
     supabase.from("contract_assignment_periods").select("contract_number,supervisor,start_date,end_date"),
     supabase.from("contract_supervisors").select("contract_number,supervisor,active").eq("active",true)
   ]);
   if(s.error||r.error||periods.error||assignments.error){setError(s.error?.message||r.error?.message||periods.error?.message||assignments.error?.message||"Unable to load daily email settings");setLoading(false);return;}
   setSettings(s.data as Settings);
   setAssignmentPeriods((periods.data||[]) as Assignment[]);
   setCurrentAssignments((assignments.data||[]) as Assignment[]);
   setRecipients((r.data||[]) as Recipient[]);
   setDraftEmails(Object.fromEntries((r.data||[]).map((x:Recipient)=>[x.name,x.email])));
   setLoading(false);
 },[admin]);
 useEffect(()=>{void refresh();},[refresh]);
 const today=dateInNewYork();
 const normContract=(value:string)=>value.trim().toUpperCase().replace(/^0+(?=[0-9])/,"");
 const assignmentNames=(value:string)=>value.split("/").map(v=>v.trim()).filter(Boolean);
 const directoryRows=useMemo(()=>{
  const dated=new Map<string,Set<string>>();
  const current=new Map<string,Set<string>>();
  for(const entry of assignmentPeriods){
   if(entry.start_date&&entry.start_date>today)continue;
   if(entry.end_date&&entry.end_date<today)continue;
   const key=normContract(entry.contract_number);
   const names=dated.get(key)||new Set<string>();
   assignmentNames(entry.supervisor).forEach(name=>names.add(name));
   dated.set(key,names);
  }
  for(const entry of currentAssignments){
   const key=normContract(entry.contract_number);
   const names=current.get(key)||new Set<string>();
   assignmentNames(entry.supervisor).forEach(name=>names.add(name));
   current.set(key,names);
  }
  const map=new Map<string,{contracts:Set<string>;provisional:Set<string>}>();
  for(const [contract,names] of current){
   const effective=dated.get(contract);
   for(const name of effective?.size?effective:names){
    const key=clean(name);
    const row=map.get(key)||{contracts:new Set<string>(),provisional:new Set<string>()};
    row.contracts.add(contract);
    if(!effective?.size)row.provisional.add(contract);
    map.set(key,row);
   }
  }
  for(const [contract,names] of dated){
   if(current.has(contract))continue;
   for(const name of names){
    const key=clean(name);
    const row=map.get(key)||{contracts:new Set<string>(),provisional:new Set<string>()};
    row.contracts.add(contract);
    map.set(key,row);
   }
  }
  return recipients.filter(r=>r.recipient_type==="supervisor").map(r=>{
   const matches=map.get(clean(r.name));
   return {...r,contracts:[...(matches?.contracts||[])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),
    provisional:[...(matches?.provisional||[])],};
  }).sort((a,b)=>a.name.localeCompare(b.name));
 },[recipients,assignmentPeriods,currentAssignments,today]);

 async function saveSettings(patch:Partial<Settings>){
  if(!settings)return;
  const next={...settings,...patch};
  if(!Number.isFinite(Number(next.threshold_percent))||next.threshold_percent<1||next.threshold_percent>100){setError("Threshold must be between 1% and 100%.");return;}
  setBusy("settings");setError("");setNotice("");
  const result=await supabase.from("daily_email_settings").update({
   delivery_enabled:next.delivery_enabled,
   company_enabled:next.company_enabled,
   individual_enabled:next.individual_enabled,
   threshold_percent:next.threshold_percent,
   updated_at:new Date().toISOString()
  }).eq("id",1).select("*").single();
  if(result.error)setError(result.error.message);else{setSettings(result.data as Settings);setNotice("Settings saved in DT Hub. Power Automate will use these only after the delivery integration is completed.");}
  setBusy("");
 }
 async function saveRecipient(r:Recipient,patch:Partial<Recipient>){
  if(isTonya(r)){setError("Tonya's Monday-only reports are managed separately.");return;}
  const next={...r,...patch};const newEmail=next.email.trim().toLowerCase();
  if(!emailOk(newEmail)){setError("Enter a valid email address.");return;}
  setBusy(r.name);setError("");setNotice("");
  const result=await supabase.from("daily_report_recipients")
    .update({email:newEmail,enabled:next.enabled,updated_at:new Date().toISOString()})
    .eq("name",r.name).select("name,email,recipient_type,enabled").single();
  if(result.error)setError(result.error.message);
  else{
   setRecipients(rows=>rows.map(x=>x.name===r.name?result.data as Recipient:x));
   setDraftEmails(rows=>({...rows,[r.name]:newEmail}));
   setNotice("Saved "+r.name+". Recipient holds take effect in the delivery authorization check.");
  }
  setBusy("");
 }
 async function changeGroup(r:Recipient,recipient_type:Recipient["recipient_type"]){
  if(r.recipient_type===recipient_type)return;
  if(isTonya(r)){setError("Tonya's Monday-only reports are managed separately.");return;}
  setBusy(r.name);setError("");setNotice("");
  const response=await supabase.from("daily_report_recipients").update({recipient_type,updated_at:new Date().toISOString()}).eq("name",r.name).select("name,email,recipient_type,enabled").single();
  if(response.error)setError(response.error.message);
  else{setRecipients(rows=>rows.map(item=>item.name===r.name?response.data as Recipient:item));setNotice("Updated "+r.name+"'s recipient group.");}
  setBusy("");
 }
 async function toggleRecipient(r:Recipient){await saveRecipient(r,{enabled:!r.enabled});}
 if(!admin)return <main className="page-shell operations-polish"><h1>Daily Email Settings</h1><p>Only DT administrators can change scheduled email settings.</p></main>;
 return <main className="page-shell dashboard-page operations-polish">
  <header className="hub-header"><div><p className="eyebrow">Administration · DT Intelligence Hub</p><h1>Daily Email Settings</h1><p>Manage thresholds, recipients, and holds in one place.</p></div><Link className="hub-secondary-link" href="/daily-reports">Daily Email Reports</Link></header>
  <section className="panel"><strong style={{color:"#8a3b16"}}>Scheduled Power Automate delivery is still OFF during setup.</strong><p>Changes saved here do not start Power Automate. Sender routing and per-recipient confirmations must be verified before activation. Tonya Capps-Owens remains excluded from daily emails.</p></section>
  {error&&<div role="alert" className="alert alert-error">{error}</div>}
  {notice&&<p role="status" className="ops-inline-note">{notice}</p>}
  {loading?<section className="panel">Loading settings…</section>:settings&&<>
   <section className="panel">
    <div className="panel-heading"><div><h2>Delivery controls</h2><span>Saved settings for future scheduled runs</span></div><strong>{settings.delivery_enabled?"Hub enabled":"Hub hold active"}</strong></div>
    <div style={{display:"grid",gap:16,maxWidth:600}}>
     <label><input type="checkbox" checked={settings.delivery_enabled} onChange={e=>void saveSettings({delivery_enabled:e.target.checked})} disabled={Boolean(busy)}/> Allow daily delivery from DT Hub (global hold when unchecked)</label>
     <label><input type="checkbox" checked={settings.company_enabled} onChange={e=>void saveSettings({company_enabled:e.target.checked})} disabled={Boolean(busy)}/> Company performance report</label>
     <label><input type="checkbox" checked={settings.individual_enabled} onChange={e=>void saveSettings({individual_enabled:e.target.checked})} disabled={Boolean(busy)}/> Individual supervisor reviews</label>
     <label>Supervisor review threshold (below this percentage)
      <select value={String(settings.threshold_percent)} onChange={e=>void saveSettings({threshold_percent:Number(e.target.value)})} disabled={Boolean(busy)}>
       {[90,92,94,95,96,97,98,99,100].map(n=><option key={n} value={n}>{n}%</option>)}
      </select>
     </label>
    </div>
   </section>
    <section className="panel" id="supervisor-contract-directory">
     <div className="panel-heading"><div><h2>Supervisor &amp; Email Directory</h2><span>Current assignments as of {formatDate(today)} · DT Hub source of truth</span></div><strong>{recipients.length} recipients</strong></div>
     <label style={{display:"block",marginBottom:12}}>Search name, email or contract
      <input type="search" placeholder="Search name, email, or contract number" value={directorySearch} onChange={e=>setDirectorySearch(e.target.value)} style={{display:"block",width:"100%",maxWidth:520,marginTop:6}}/>
     </label>
     <div className="table-scroll"><table className="data-table"><thead><tr><th>Name</th><th>Group</th><th>Email</th><th>Enabled</th><th>Assigned Contracts</th><th></th></tr></thead><tbody>
      {recipients.filter(r=>{
       const row=directoryRows.find(x=>clean(x.name)===clean(r.name));
       return [r.name,r.email,...(row?.contracts||[])].some(value=>value.toLowerCase().includes(directorySearch.trim().toLowerCase()));
      }).map(r=>{
       const row=directoryRows.find(x=>clean(x.name)===clean(r.name));
       return <tr key={r.name}>
        <td><strong>{r.name}</strong></td>
        <td><select aria-label={"Group for "+r.name} value={r.recipient_type} disabled={Boolean(busy)||isTonya(r)} onChange={e=>void changeGroup(r,e.target.value as Recipient["recipient_type"])}><option value="supervisor">Supervisor</option><option value="distribution">Distribution</option><option value="cc">CC</option><option value="bcc">BCC</option></select></td>
        <td><input aria-label={"Email for "+r.name} type="email" value={draftEmails[r.name]??r.email} disabled={Boolean(busy)||isTonya(r)} onChange={e=>setDraftEmails(current=>({...current,[r.name]:e.target.value}))}/></td>
        <td><input type="checkbox" aria-label={"Enabled "+r.name} checked={r.enabled} disabled={Boolean(busy)||isTonya(r)} onChange={()=>void toggleRecipient(r)}/></td>
        <td>{row?.contracts.length?row.contracts.map((contract,i)=><span key={contract}>{i?", ":""}<Link href={`/contracts/${encodeURIComponent(contract)}`}>{contract}</Link>{row.provisional.includes(contract)?" *":""}</span>):r.recipient_type==="supervisor"?<strong style={{color:"#a24444"}}>No current contract assignment found</strong>:"—"}</td>
        <td><button type="button" className="hub-secondary-link" disabled={Boolean(busy)||isTonya(r)||clean(draftEmails[r.name]??r.email)===clean(r.email)} onClick={()=>void saveRecipient(r,{email:draftEmails[r.name]})}>{busy===r.name?"Saving…":"Save email"}</button></td>
       </tr>;
      })}
      </tbody></table></div>
     <p className="ops-summary">Contract assignments reflect DT Hub’s current effective-date records. Asterisk (*) means the contract has no matching dated assignment and is using its current assignment as a provisional fallback. Edit contracts through the existing contract management workflow.</p>
    </section>

   <section className="panel"><h2>Delivery history</h2><p>Review sent, pending, and failed deliveries in Daily Email Reports. Duplicate-email prevention remains controlled by DT Hub.</p><Link href="/daily-reports" className="hub-secondary-link">Open Delivery History</Link></section>
  </>}
 </main>;
}
