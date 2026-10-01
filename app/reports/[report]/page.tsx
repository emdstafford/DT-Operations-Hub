"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type FilterKey = "dates"|"date"|"month"|"compareMonths"|"compareDates"|"supervisor"|"contract"|"driver"|"status";
type Config = { title:string; description:string; filters:FilterKey[]; source:string };
type OptionSet = { contracts:string[]; drivers:string[]; supervisors:string[] };

const REPORTS: Record<string, Config> = {
  "usps-completion": { title:"USPS Completion Report", description:"Supervisor and contract completion performance.", filters:["dates","supervisor","contract"], source:"usps" },
  "driver-contract-supervisor": { title:"Driver / Contract / Supervisor", description:"Driver assignments by contract and supervisor.", filters:["date","supervisor","contract","driver"], source:"driver_contract" },
  "load-reconciliation": { title:"Load Reconciliation", description:"CLEAR and FourKites matching, extras, cancellations, and unmatched loads.", filters:["dates","contract","status"], source:"load_master" },
  "completion-totals": { title:"Completion Totals", description:"Completion totals across the operation.", filters:["dates","supervisor","contract"], source:"usps" },
  "geofence": { title:"Geofence / Missed Stops", description:"Missed-stop and location-level exceptions.", filters:["dates","supervisor","contract"], source:"usps" },
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

export default function ReportLauncherPage(){
  const params=useParams<{report:string}>(); const router=useRouter();
  const config=REPORTS[String(params.report)]||{title:"Report",description:"Select filters and generate the report.",filters:["dates"],source:"unknown"};
  const [values,setValues]=useState<Record<string,string>>({}); const [generated,setGenerated]=useState(false); const [loading,setLoading]=useState(false); const [error,setError]=useState(""); const [rows,setRows]=useState<Record<string,unknown>[]>([]);
  const [options,setOptions]=useState<OptionSet>({contracts:[],drivers:[],supervisors:[]});
  const set=(k:string,v:string)=>{setValues(x=>({...x,[k]:v}));setGenerated(false);};

  useEffect(()=>{ void (async()=>{
    const contracts:string[]=[]; const drivers:string[]=[]; const supervisors:string[]=[];
    if(config.source==="load_master") { const {data}=await supabase.from("load_master").select("contract_number").limit(5000); contracts.push(...uniq((data||[]).map(x=>x.contract_number))); }
    if(config.source==="fuel") { const {data}=await supabase.rpc("fuel_filter_options_v2"); if(data){ contracts.push(...(data.contracts||[])); drivers.push(...(data.people||[])); supervisors.push(...(data.supervisors||[])); } }
    setOptions({contracts:uniq(contracts),drivers:uniq(drivers),supervisors:uniq(supervisors)});
  })(); },[config.source]);

  async function generate(){ setLoading(true);setError("");setRows([]);
    try{
      if(config.source==="load_master"){
        let q=supabase.from("load_master").select("service_date,load_number,contract_number,trip_number,service_code,clear_present,fourkites_present,clear_miles,service_class,operation_status,cancellation_reason").order("service_date",{ascending:false}).limit(5000);
        if(values.start) q=q.gte("service_date",values.start); if(values.end) q=q.lte("service_date",values.end); if(values.contract&&values.contract!=="all") q=q.eq("contract_number",values.contract);
        const {data,error:e}=await q; if(e) throw e; let result=(data||[]) as Record<string,unknown>[];
        if(values.status&&values.status!=="all") result=result.filter(r=>values.status==="matched"?r.clear_present&&r.fourkites_present:values.status==="clear_only"?r.clear_present&&!r.fourkites_present:values.status==="fourkites_only"?!r.clear_present&&r.fourkites_present:values.status==="extra"?r.service_class==="extra"||r.operation_status==="extra_service":values.status==="cancelled"?r.operation_status==="usps_cancelled":values.status==="review"?r.service_class==="needs_review"||r.operation_status==="needs_review":true);
        setRows(result);
      }
      setGenerated(true);
    }catch(e){setError(e instanceof Error?e.message:"Unable to generate report.");} finally{setLoading(false);}
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
    {generated&&<section style={{background:"white",border:"1px solid #d7e0ea",borderRadius:14,padding:22}}><div style={{display:"flex",justifyContent:"space-between",gap:18,alignItems:"start",borderBottom:"2px solid #17375e",paddingBottom:12}}><div><div style={{fontWeight:900,color:"#0f2747",fontSize:22}}>Davenport Transportation</div><h2 style={{margin:"4px 0 0",fontSize:19}}>{config.title}</h2></div><button className="no-print" onClick={()=>window.print()} style={{padding:"9px 15px",borderRadius:8,border:0,background:"#17375e",color:"white",fontWeight:800}}>Print / Save PDF</button></div>
      <div style={{padding:"12px 0",color:"#607286",fontSize:13}}>{Object.entries(values).filter(([,v])=>v&&v!=="all").map(([k,v])=>`${k}: ${v}`).join(" · ")||"All available records"}</div>
      {config.source==="load_master"?<div style={{overflowX:"auto"}}><table className="data-table"><thead><tr><th>Date</th><th>Load</th><th>Contract</th><th>Trip</th><th>CLEAR</th><th>FourKites</th><th>CLEAR Miles</th><th>Classification</th><th>Status</th></tr></thead><tbody>{rows.map((r,i)=><tr key={`${r.load_number}-${r.service_date}-${i}`}><td>{String(r.service_date||"")}</td><td>{String(r.load_number||"")}</td><td>{String(r.contract_number||"—")}</td><td>{String(r.trip_number||r.service_code||"—")}</td><td>{r.clear_present?"Yes":"—"}</td><td>{r.fourkites_present?"Yes":"—"}</td><td>{r.clear_miles==null?"—":Number(r.clear_miles).toFixed(1)}</td><td>{String(r.service_class||"").replaceAll("_"," ")}</td><td>{String(r.operation_status||"").replaceAll("_"," ")}</td></tr>)}</tbody></table>{!rows.length&&<div style={{padding:24,textAlign:"center"}}>No loads matched these filters.</div>}</div>:<div style={{padding:28,textAlign:"center",background:"#f6f8fa",borderRadius:10,color:"#52677f"}}>This dedicated report is ready for its existing data source to be connected. It no longer redirects to the working module.</div>}
    </section>}
  </main>;
}
