"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type FilterKey = "dates"|"date"|"month"|"compareMonths"|"compareDates"|"supervisor"|"contract"|"driver"|"status";
type Config = { title:string; description:string; filters:FilterKey[]; source:string };
type OptionSet = { contracts:string[]; drivers:string[]; supervisors:string[] };
type GeofenceRow = { loadNumber?:string; operatingDate?:string; contract?:string; trip?:string; missingStops?:number; missingLocations?:string; status?:string };
type Assignment = { contract_number:string; supervisor:string; start_date:string; end_date:string|null };
type GeofenceNote = { status:string; note:string; requestedOn:string|null };
type ReportRow = { [key:string]:unknown; notes?:GeofenceNote[] };

const REPORTS: Record<string, Config> = {
  "usps-completion": { title:"USPS Completion Report", description:"Supervisor and contract completion performance.", filters:["dates","supervisor","contract"], source:"usps" },
  "driver-contract-supervisor": { title:"Driver / Contract / Supervisor", description:"Driver assignments by contract and supervisor.", filters:["date","supervisor","contract","driver"], source:"driver_contract" },
  "load-reconciliation": { title:"Load Reconciliation", description:"CLEAR and FourKites matching, extras, cancellations, and unmatched loads.", filters:["dates","contract","status"], source:"load_master" },
  "completion-totals": { title:"Completion Totals", description:"Completion totals across the operation.", filters:["dates","supervisor","contract"], source:"usps" },
  "geofence": { title:"Geofence / Missed Stops", description:"Missed-stop and location-level exceptions.", filters:["dates","supervisor","contract"], source:"geofence" },
  "monthly-reconciliation": { title:"Monthly Reconciliation", description:"CLEAR actuals, rates, approvals, and monthly reconciliation.", filters:["month","contract"], source:"monthly" },
  "contract-summary": { title:"Contract Report", description:"Contract-at-a-glance reporting.", filters:["month","contract"], source:"contract" },
  "company-fuel": { title:"Company Fuel Report", description:"Monthly company fuel activity.", filters:["month","contract"], source:"fuel" },
  "driver-fuel": { title:"Driver Fuel Report", description:"Driver diesel, gas, misc, and transaction totals.", filters:["month","driver","contract"], source:"fuel" },
  "fuel-comparison": { title:"Fuel Month Comparison", description:"Compare fuel activity between two months.", filters:["compareMonths","driver","contract"], source:"fuel" },
  "payroll": { title:"Payroll Report", description:"Payroll reporting by selected period.", filters:["dates","contract","driver"], source:"payroll" },
  "timecard-comparison": { title:"Timecard Comparison", description:"Compare payroll periods.", filters:["compareDates","contract","driver"], source:"payroll" },
  "contract-payroll-hours": { title:"Contract Payroll Hours", description:"Payroll hours by contract and period.", filters:["dates","contract"], source:"payroll" },
};
const fieldStyle={display:"grid",gap:5,minWidth:190} as const;
const inputStyle={padding:"9px 10px",border:"1px solid #b8c5d3",borderRadius:8,background:"white"} as const;
const uniq=(items:(string|null|undefined)[])=>[...new Set(items.filter(Boolean).map(String))].sort();
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[character]||character);
const assignedNames=(value:string)=>value.split("/").map((name)=>name.trim()).filter(Boolean);

function supervisorsFor(row:GeofenceRow, dated:Assignment[], current: {contract_number:string;supervisor:string}[]) {
  const contract=String(row.contract||"Unmapped"); const day=String(row.operatingDate||"");
  const matching=dated.filter((item)=>item.contract_number===contract&&item.start_date<=day&&(!item.end_date||item.end_date>=day));
  if(matching.length) return uniq(matching.flatMap((item)=>assignedNames(item.supervisor)));
  if(dated.some((item)=>item.contract_number===contract)) return [];
  return uniq(current.filter((item)=>item.contract_number===contract).flatMap((item)=>assignedNames(item.supervisor)));
}

export default function ReportLauncherPage(){
  const params=useParams<{report:string}>(); const router=useRouter();
  const config=REPORTS[String(params.report)]||{title:"Report",description:"Select filters and generate the report.",filters:["dates"],source:"unknown"};
  const [values,setValues]=useState<Record<string,string>>({}); const [generated,setGenerated]=useState(false); const [loading,setLoading]=useState(false); const [error,setError]=useState(""); const [rows,setRows]=useState<ReportRow[]>([]); const [emailAddress,setEmailAddress]=useState(""); const [emailCopied,setEmailCopied]=useState(false);
  const [options,setOptions]=useState<OptionSet>({contracts:[],drivers:[],supervisors:[]});
  const set=(k:string,v:string)=>{setValues(x=>({...x,[k]:v}));setGenerated(false);};

  useEffect(()=>{ void (async()=>{
    const contracts:string[]=[]; const drivers:string[]=[]; const supervisors:string[]=[];
    if(config.source==="load_master") { const {data}=await supabase.from("load_master").select("contract_number").limit(5000); contracts.push(...uniq((data||[]).map(x=>x.contract_number))); }
    if(config.source==="fuel") { const {data}=await supabase.rpc("fuel_filter_options_v2"); if(data){ contracts.push(...(data.contracts||[])); drivers.push(...(data.people||[])); supervisors.push(...(data.supervisors||[])); } }
    if(config.source==="geofence") {
      let historyQuery=supabase.from("report_history").select("data,period_start,period_end").eq("report_type","missed_stops");
      if(values.end) historyQuery=historyQuery.lte("period_start",values.end); if(values.start) historyQuery=historyQuery.gte("period_end",values.start);
      const [history,dated,current]=await Promise.all([
        historyQuery,
        supabase.from("contract_assignment_periods").select("contract_number,supervisor,start_date,end_date"),
        supabase.from("contract_supervisors").select("contract_number,supervisor"),
      ]);
      const failed=history.error||dated.error||current.error;
      if(failed) setError(failed.message);
      else {
        const reportRows=((history.data||[]).flatMap((record)=>((record.data as {rows?:GeofenceRow[]})?.rows||[])));
        const assignmentRows=(dated.data||[]) as Assignment[];
        const currentRows=(current.data||[]) as {contract_number:string;supervisor:string}[];
        const withMissedStops=reportRows.filter((row)=>Number(row.missingStops||0)>0);
        contracts.push(...uniq(withMissedStops.map((row)=>row.contract||"Unmapped")));
        supervisors.push(...uniq(withMissedStops.flatMap((row)=>supervisorsFor(row,assignmentRows,currentRows))));
      }
    }
    setOptions({contracts:uniq(contracts),drivers:uniq(drivers),supervisors:uniq(supervisors)});
  })(); },[config.source,values.start,values.end]);

  async function generate(){ setLoading(true);setError("");setRows([]);
    try{
      if(config.source==="load_master"){
        let q=supabase.from("load_master").select("service_date,load_number,contract_number,trip_number,service_code,clear_present,fourkites_present,clear_miles,service_class,operation_status,cancellation_reason").order("service_date",{ascending:false}).limit(5000);
        if(values.start) q=q.gte("service_date",values.start); if(values.end) q=q.lte("service_date",values.end); if(values.contract&&values.contract!=="all") q=q.eq("contract_number",values.contract);
        const {data,error:e}=await q; if(e) throw e; let result=(data||[]) as Record<string,unknown>[];
        if(values.status&&values.status!=="all") result=result.filter(r=>values.status==="matched"?r.clear_present&&r.fourkites_present:values.status==="clear_only"?r.clear_present&&!r.fourkites_present:values.status==="fourkites_only"?!r.clear_present&&r.fourkites_present:values.status==="extra"?r.service_class==="extra"||r.operation_status==="extra_service":values.status==="cancelled"?r.operation_status==="usps_cancelled":values.status==="review"?r.service_class==="needs_review"||r.operation_status==="needs_review":true);
        setRows(result);
      }
      if(config.source==="geofence"){
        let q=supabase.from("report_history").select("data,period_start,period_end").eq("report_type","missed_stops");
        if(values.end) q=q.lte("period_start",values.end); if(values.start) q=q.gte("period_end",values.start);
        const {data,error:e}=await q; if(e) throw e;
        const [dated,current,notes]=await Promise.all([
          supabase.from("contract_assignment_periods").select("contract_number,supervisor,start_date,end_date"),
          supabase.from("contract_supervisors").select("contract_number,supervisor"),
          supabase.from("operational_notes").select("contract_number,trip_number,status,note,requested_on,effective_start,effective_end"),
        ]);
        if(dated.error) throw dated.error; if(current.error) throw current.error; if(notes.error) throw notes.error;
        const assignmentRows=(dated.data||[]) as Assignment[];
        const currentRows=(current.data||[]) as {contract_number:string;supervisor:string}[];
        const operationalNotes=(notes.data||[]) as {contract_number:string;trip_number:string|null;status:string;note:string;requested_on:string|null;effective_start:string;effective_end:string|null}[];
        const sourceRows=((data||[]).flatMap((record)=>((record.data as {rows?:GeofenceRow[]})?.rows||[])));
        const result=sourceRows.filter((row)=>{
          const day=String(row.operatingDate||"");
          if(!day||Number(row.missingStops||0)<=0||(values.start&&day<values.start)||(values.end&&day>values.end)) return false;
          if(values.contract&&values.contract!=="all"&&String(row.contract||"Unmapped")!==values.contract) return false;
          if(values.supervisor&&values.supervisor!=="all"&&!supervisorsFor(row,assignmentRows,currentRows).includes(values.supervisor)) return false;
          return true;
        }).map((row)=>({
          operatingDate:String(row.operatingDate||""), loadNumber:String(row.loadNumber||""), contract:String(row.contract||"Unmapped"),
          trip:String(row.trip||""), missingStops:Number(row.missingStops||0), missingLocations:String(row.missingLocations||""), status:String(row.status||""),
          notes:operationalNotes.filter((item)=>item.contract_number===String(row.contract||"Unmapped")&&(!item.trip_number||item.trip_number===String(row.trip||""))&&item.effective_start<=String(row.operatingDate||"")&&(!item.effective_end||item.effective_end>=String(row.operatingDate||""))).map((item)=>({status:item.status,note:item.note,requestedOn:item.requested_on})),
        }));
        setRows(result);
      }
      setGenerated(true);
    }catch(e){setError(e instanceof Error?e.message:"Unable to generate report.");} finally{setLoading(false);}
  }

  async function copyGeofenceEmailReport(){
    if(!rows.length){setError("Generate a report with matching missed-stop records first.");return;}
    const rowNotes=(row:ReportRow)=>row.notes||[];
    const noteHtml=(row:ReportRow)=>rowNotes(row).length?rowNotes(row).map((note)=>`<div style="margin:0 0 5px"><strong>${escapeHtml(note.status.replaceAll("_"," "))}</strong>: ${escapeHtml(note.note)}${note.requestedOn?`<br><small>USPS requested ${escapeHtml(note.requestedOn)}</small>`:""}</div>`).join(""):"—";
    const noteText=(row:ReportRow)=>rowNotes(row).length?rowNotes(row).map((note)=>`${note.status.replaceAll("_"," ")}: ${note.note}${note.requestedOn?` (USPS requested ${note.requestedOn})`:""}`).join(" | "):"—";
    const tableRows=rows.map((row)=>`<tr><td>${escapeHtml(String(row.operatingDate||""))}</td><td>${escapeHtml(String(row.contract||""))}</td><td>${escapeHtml(String(row.trip||"—"))}</td><td>${escapeHtml(String(row.loadNumber||""))}</td><td style="text-align:right">${Number(row.missingStops||0)}</td><td>${escapeHtml(String(row.missingLocations||"—"))}</td><td>${escapeHtml(String(row.status||"—"))}</td><td>${noteHtml(row)}</td></tr>`).join("");
    const html=`<div style="font-family:Arial,sans-serif;color:#243746"><div style="background:#123b61;color:#fff;padding:18px 22px"><div style="font-size:11px;letter-spacing:1px">DAVENPORT TRANSPORTATION</div><h2 style="margin:5px 0">Geofence / Missed Stops</h2><div>${values.start||"All dates"} – ${values.end||"All dates"}</div></div><p><strong>${rows.length.toLocaleString()} affected loads</strong> · ${rows.reduce((sum,row)=>sum+Number(row.missingStops||0),0).toLocaleString()} stops without geofence check-in</p><table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr>${["Operating date","Contract","Trip","Load","Missing stops","Missing locations","Status","Operational notes"].map((label)=>`<th style="padding:7px;border:1px solid #b8c5d3;background:#123b61;color:#fff;text-align:left">${label}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></div>`;
    const text=["Geofence / Missed Stops",`${values.start||"All dates"} – ${values.end||"All dates"}`,`${rows.length.toLocaleString()} affected loads · ${rows.reduce((sum,row)=>sum+Number(row.missingStops||0),0).toLocaleString()} stops without geofence check-in`,"","Operating date\tContract\tTrip\tLoad\tMissing stops\tMissing locations\tStatus\tOperational notes",...rows.map((row)=>`${row.operatingDate}\t${row.contract}\t${row.trip||"—"}\t${row.loadNumber}\t${row.missingStops}\t${row.missingLocations||"—"}\t${row.status||"—"}\t${noteText(row)}`)].join("\n");
    try{
      if(typeof ClipboardItem!=="undefined"&&navigator.clipboard.write) await navigator.clipboard.write([new ClipboardItem({"text/plain":new Blob([text],{type:"text/plain"}),"text/html":new Blob([html],{type:"text/html"})})]);
      else await navigator.clipboard.writeText(text);
      setEmailCopied(true);window.setTimeout(()=>setEmailCopied(false),2500);
    }catch{setError("The report could not be copied. Allow clipboard access, or print the report and attach the PDF.");}
  }

  function openGeofenceEmailDraft(){
    if(!emailAddress.trim()){setError("Enter the supervisor’s email address first.");return;}
    if(!values.supervisor||values.supervisor==="all"){setError("Choose one supervisor before preparing the email.");return;}
    const subject=`Missed stops to review · ${values.start||"All dates"} to ${values.end||"All dates"}`;
    const body=`Hi ${values.supervisor},\n\nPlease review the missed stops for your contracts in the selected period. The detailed report is on your clipboard; paste it into this email below.\n\nThank you`;
    window.location.href=`mailto:${encodeURIComponent(emailAddress.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  const select=(key:string,label:string,items:string[])=><label key={key} style={fieldStyle}>{label}<select style={inputStyle} value={values[key]||"all"} onChange={e=>set(key,e.target.value)}><option value="all">All {label.toLowerCase()}s</option>{items.map(x=><option key={x} value={x}>{x}</option>)}</select></label>;
  const fields=useMemo(()=>config.filters.flatMap(filter=>{
    if(filter==="dates")return[<label key="start" style={fieldStyle}>Start date<input style={inputStyle} type="date" value={values.start||""} onChange={e=>set("start",e.target.value)}/></label>,<label key="end" style={fieldStyle}>End date<input style={inputStyle} type="date" value={values.end||""} onChange={e=>set("end",e.target.value)}/></label>];
    if(filter==="date")return[<label key="date" style={fieldStyle}>Effective date<input style={inputStyle} type="date" value={values.date||""} onChange={e=>set("date",e.target.value)}/></label>];
    if(filter==="month")return[<label key="month" style={fieldStyle}>Month<input style={inputStyle} type="month" value={values.month||""} onChange={e=>set("month",e.target.value)}/></label>];
    if(filter==="compareMonths")return[<label key="month1" style={fieldStyle}>First month<input style={inputStyle} type="month" value={values.month1||""} onChange={e=>set("month1",e.target.value)}/></label>,<label key="month2" style={fieldStyle}>Compare month<input style={inputStyle} type="month" value={values.month2||""} onChange={e=>set("month2",e.target.value)}/></label>];
    if(filter==="compareDates")return[<label key="period1" style={fieldStyle}>First pay period<input style={inputStyle} type="text" value={values.period1||""} onChange={e=>set("period1",e.target.value)}/></label>,<label key="period2" style={fieldStyle}>Compare pay period<input style={inputStyle} type="text" value={values.period2||""} onChange={e=>set("period2",e.target.value)}/></label>];
    if(filter==="contract")return[select("contract","Contract",options.contracts)]; if(filter==="driver")return[select("driver","Driver",options.drivers)]; if(filter==="supervisor")return[select("supervisor","Supervisor",options.supervisors)];
    return[<label key="status" style={fieldStyle}>Status<select style={inputStyle} value={values.status||"all"} onChange={e=>set("status",e.target.value)}><option value="all">All statuses</option><option value="matched">Both systems</option><option value="clear_only">CLEAR only</option><option value="fourkites_only">FourKites only</option><option value="extra">Extras</option><option value="cancelled">USPS cancelled</option><option value="review">Needs review</option></select></label>];
  }),[config.filters,values,options]);

  return <main className="page-shell"><div className="no-print" style={{marginBottom:14}}><button onClick={()=>router.push("/reports")} style={{border:0,background:"transparent",color:"#123b61",fontWeight:800,cursor:"pointer"}}>← Reports Center</button></div>
    <header className="page-intro"><div><p className="eyebrow">Report</p><h1>{config.title}</h1><p>{config.description}</p></div></header>
    <section className="no-print" style={{background:"white",border:"1px solid #d7e0ea",borderRadius:14,padding:18,marginBottom:18}}><h2 style={{margin:"0 0 4px",fontSize:18,color:"#0f2747"}}>Report filters</h2><p style={{margin:"0 0 14px",color:"#607286",fontSize:13}}>Choose what you want included, then generate the printable report.</p><div style={{display:"flex",flexWrap:"wrap",gap:12,alignItems:"end"}}>{fields}<button onClick={()=>void generate()} disabled={loading} style={{padding:"10px 16px",border:0,borderRadius:8,background:"#123b61",color:"white",fontWeight:800,cursor:"pointer"}}>{loading?"Generating…":"Generate Report"}</button></div></section>
    {error&&<div style={{padding:14,background:"#fff1f1",color:"#8d1f1f",borderRadius:10}}>{error}</div>}
    {generated&&<section style={{background:"white",border:"1px solid #d7e0ea",borderRadius:14,padding:22}}><div style={{display:"flex",justifyContent:"space-between",gap:18,alignItems:"start",borderBottom:"2px solid #17375e",paddingBottom:12}}><div><div style={{fontWeight:900,color:"#0f2747",fontSize:22}}>Davenport Transportation</div><h2 style={{margin:"4px 0 0",fontSize:19}}>{config.title}</h2></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{config.source==="geofence"&&<button className="no-print" onClick={()=>void copyGeofenceEmailReport()} style={{padding:"9px 15px",borderRadius:8,border:0,background:"#e8eff5",color:"#123b61",fontWeight:800}}>{emailCopied?"Report copied — paste into email":"Copy report for email"}</button>}<button className="no-print" onClick={()=>window.print()} style={{padding:"9px 15px",borderRadius:8,border:0,background:"#17375e",color:"white",fontWeight:800}}>Print / Save PDF</button></div></div>
      <div style={{padding:"12px 0",color:"#607286",fontSize:13}}>{Object.entries(values).filter(([,v])=>v&&v!=="all").map(([k,v])=>`${k}: ${v}`).join(" · ")||"All available records"}</div>
      {config.source==="load_master"?<div style={{overflowX:"auto"}}><table className="data-table"><thead><tr><th>Date</th><th>Load</th><th>Contract</th><th>Trip</th><th>CLEAR</th><th>FourKites</th><th>CLEAR Miles</th><th>Classification</th><th>Status</th></tr></thead><tbody>{rows.map((r,i)=><tr key={`${r.load_number}-${r.service_date}-${i}`}><td>{String(r.service_date||"")}</td><td>{String(r.load_number||"")}</td><td>{String(r.contract_number||"—")}</td><td>{String(r.trip_number||r.service_code||"—")}</td><td>{r.clear_present?"Yes":"—"}</td><td>{r.fourkites_present?"Yes":"—"}</td><td>{r.clear_miles==null?"—":Number(r.clear_miles).toFixed(1)}</td><td>{String(r.service_class||"").replaceAll("_"," ")}</td><td>{String(r.operation_status||"").replaceAll("_"," ")}</td></tr>)}</tbody></table>{!rows.length&&<div style={{padding:24,textAlign:"center"}}>No loads matched these filters.</div>}</div>:config.source==="geofence"?<div style={{overflowX:"auto"}}><div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}><div className="metric-card"><span>Affected loads</span><strong>{rows.length.toLocaleString()}</strong></div><div className="metric-card"><span>Stops without geofence check-in</span><strong>{rows.reduce((sum,row)=>sum+Number(row.missingStops||0),0).toLocaleString()}</strong></div></div>{values.supervisor&&values.supervisor!=="all"&&<div className="no-print" style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"end",padding:"12px 0"}}><label style={fieldStyle}>Email {values.supervisor}<input style={inputStyle} type="email" value={emailAddress} onChange={(event)=>setEmailAddress(event.target.value)} placeholder="supervisor@dtexpress.net" /></label><button type="button" onClick={openGeofenceEmailDraft} style={{padding:"9px 15px",borderRadius:8,border:0,background:"#123b61",color:"white",fontWeight:800}}>Open email draft</button><span style={{color:"#607286",fontSize:12}}>Copy the report first, then paste it into the email draft before sending.</span></div>}<table className="data-table geofence-report-table"><thead><tr><th>Operating date</th><th>Contract</th><th>Trip</th><th>Load</th><th>Missing geofence stops</th><th>Missing locations</th><th>Status</th><th>Operational notes</th></tr></thead><tbody>{rows.map((r,i)=><tr key={`${r.loadNumber}-${r.operatingDate}-${i}`}><td>{String(r.operatingDate||"")}</td><td>{String(r.contract||"Unmapped")}</td><td>{String(r.trip||"—")}</td><td>{String(r.loadNumber||"")}</td><td>{Number(r.missingStops||0).toLocaleString()}</td><td>{String(r.missingLocations||"—")}</td><td>{String(r.status||"—")}</td><td>{r.notes?.length?r.notes.map((note,index)=><div key={`${note.status}-${index}`} style={{minWidth:180,marginBottom:6}}><strong>{note.status.replaceAll("_"," ")}</strong>: {note.note}{note.requestedOn&&<small style={{display:"block",color:"#607286"}}>USPS requested {note.requestedOn}</small>}</div>):"—"}</td></tr>)}</tbody></table>{!rows.length&&<div style={{padding:24,textAlign:"center"}}>No missed-stop records matched these dates and filters.</div>}<p style={{marginTop:12,color:"#607286",fontSize:12}}>This report uses saved Missed Stops uploads. Supervisor filtering follows the contract assignment in effect on each operating date.</p></div>:<div style={{padding:28,textAlign:"center",background:"#f6f8fa",borderRadius:10,color:"#52677f"}}>This report’s data source is not connected yet.</div>}
    </section>}
  </main>;
}
