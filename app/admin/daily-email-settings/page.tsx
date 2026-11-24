"use client";

import Link from "next/link";
import {useCallback,useEffect,useMemo,useState} from "react";
import {supabase} from "@/lib/supabase";
import {useAccessRole} from "@/components/AccessRole";

type Settings={id:number;delivery_enabled:boolean;company_enabled:boolean;individual_enabled:boolean;threshold_percent:number;updated_at:string};
type Recipient={name:string;email:string;recipient_type:"supervisor"|"distribution"|"cc"|"bcc";enabled:boolean};
const emailOk=(s:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isTonya=(r:Recipient)=>/tonya\s*(capps|owens?)/i.test(r.name)||r.email.trim().toLowerCase()==="tocapps@bellsouth.net";

export default function DailyEmailSettingsPage(){
 const role=useAccessRole();
 const [settings,setSettings]=useState<Settings|null>(null);
 const [recipients,setRecipients]=useState<Recipient[]>([]);
 const [draftEmails,setDraftEmails]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState("");
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const admin=role==="admin";
 const refresh=useCallback(async()=>{
   if(!admin)return;
   setLoading(true);setError("");
   const [s,r]=await Promise.all([
     supabase.from("daily_email_settings").select("*").eq("id",1).single(),
     supabase.from("daily_report_recipients").select("name,email,recipient_type,enabled").order("recipient_type").order("name")
   ]);
   if(s.error||r.error){setError(s.error?.message||r.error?.message||"Unable to load daily email settings");setLoading(false);return;}
   setSettings(s.data as Settings);
   setRecipients((r.data||[]) as Recipient[]);
   setDraftEmails(Object.fromEntries((r.data||[]).map((x:Recipient)=>[x.name,x.email])));
   setLoading(false);
 },[admin]);
 useEffect(()=>{void refresh();},[refresh]);
 const groups=useMemo(()=>({
   supervisors:recipients.filter(r=>r.recipient_type==="supervisor"&&!isTonya(r)),
   oversight:recipients.filter(r=>r.recipient_type==="distribution"&&!isTonya(r)),
   cc:recipients.filter(r=>r.recipient_type==="cc"&&!isTonya(r)),
   bcc:recipients.filter(r=>r.recipient_type==="bcc"&&!isTonya(r))
 }),[recipients]);

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
 if(!admin)return <main className="page-shell operations-polish"><h1>Daily Email Settings</h1><p>Only DT administrators can change scheduled email settings.</p></main>;
 const renderGroup=(title:string,description:string,rows:Recipient[])=><section className="panel" key={title}>
  <div className="panel-heading"><div><h2>{title}</h2><span>{description}</span></div><strong>{rows.filter(r=>r.enabled).length} active</strong></div>
  {rows.length===0?<p>No configured recipients in this group.</p>:<div style={{display:"grid",gap:12}}>
   {rows.map(r=><div key={r.name} style={{display:"flex",gap:12,alignItems:"end",flexWrap:"wrap",padding:"10px 0",borderBottom:"1px solid #dde5eb"}}>
    <div style={{flex:"1 1 170px"}}><strong>{r.name}</strong><div style={{fontSize:12,opacity:.8}}>{r.enabled?"Active":"On hold"}</div></div>
    <label style={{flex:"2 1 230px"}}>Email<input type="email" aria-label={r.name+" email"} value={draftEmails[r.name]??r.email} onChange={e=>setDraftEmails(old=>({...old,[r.name]:e.target.value}))}/></label>
    <button type="button" className="hub-secondary-link" disabled={Boolean(busy)||draftEmails[r.name]===r.email} onClick={()=>void saveRecipient(r,{email:draftEmails[r.name]})}>Save email</button>
    <button type="button" className="hub-secondary-link" disabled={Boolean(busy)} onClick={()=>void saveRecipient(r,{enabled:!r.enabled})}>{r.enabled?"Put on hold":"Reactivate"}</button>
   </div>)}
  </div>}
 </section>;
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
   {renderGroup("Supervisors","Each eligible supervisor receives only their own performance review; contracts remain managed in Contracts.",groups.supervisors)}
   {renderGroup("Oversight distribution","Approved individuals who receive copies of individual supervisor reviews.",groups.oversight)}
   {renderGroup("Company CC","Company report carbon-copy recipients.",groups.cc)}
   {renderGroup("Company BCC","Company report blind-copy recipients.",groups.bcc)}
   <section className="panel"><h2>Delivery history</h2><p>Review sent, pending, and failed deliveries in Daily Email Reports. Duplicate-email prevention remains controlled by DT Hub.</p><Link href="/daily-reports" className="hub-secondary-link">Open Delivery History</Link></section>
  </>}
 </main>;
}
