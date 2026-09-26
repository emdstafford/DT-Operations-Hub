"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

type Cell = string | number | boolean | Date | null | undefined;
type TripRow = {
  contract_number:string; trip_number:string; effective_start:string; effective_end:string|null;
  unit_cost:number|null; annual_trip_cost:number|null; calculated_rate_per_mile:number|null;
  detention_rate:number|null; fuel_type:string|null; usps_mpg:number|null; wage_rate:number|null;
  health_welfare_rate:number|null; equipment_type:string|null; frequency:string|null;
  annual_trip_count:number|null; per_trip_miles:number|null; per_trip_hours:number|null;
  annual_miles:number|null; source_row_number:number; source_payload:Record<string,Cell>;
};
type PreviewSheet = {
  sheetName:string; contractNumber:string; rows:TripRow[]; status:"ready"|"review";
  note?:string; expirationDates:string[]; effectiveDates:string[];
};

const REQUIRED = ["Effective Date*","Expiration Date","HCR*","Trip*","Unit Cost*","Annual Trip Cost (Calculated)"];
const ALIASES:Record<string,string[]> = {
  rate:["Rate Per Mile (Calculated)"], detention:["Detention Rate"], fuel:["Fuel Type*"],
  mpg:["Miles Per Gallon"], wage:["WD Rate"], hw:["WD Health and Welfare Rate"],
  equipment:["Equipment Type*"], frequency:["Frequency Description","Frequency Code"],
  trips:["Annual Trip Count*"], miles:["Per Trip Miles*"], hours:["Per Trip Hours*"],
  annualMiles:["Annual Miles (Calculated)"]
};
const clean=(v:Cell)=>String(v??"").trim();
const num=(v:Cell)=>v==null||clean(v)===""?null:Number.isFinite(Number(v))?Number(v):null;
const iso=(v:Cell)=>{
  if(v instanceof Date) return v.toISOString().slice(0,10);
  const s=clean(v); if(!s) return null;
  const d=new Date(s+"T00:00:00"); return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);
};
function findHeader(rows:Cell[][]){
  return rows.findIndex(row=>REQUIRED.every(h=>row.some(v=>clean(v)===h)));
}
function pick(row:Cell[], map:Map<string,number>, names:string[]){
  for(const n of names){const i=map.get(n);if(i!=null)return row[i];} return null;
}

export default function UspsRateImport(){
  const [fileName,setFileName]=useState(""); const [sheets,setSheets]=useState<PreviewSheet[]>([]);
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false); const [saved,setSaved]=useState("");
  const totals=useMemo(()=>({contracts:sheets.length,trips:sheets.reduce((n,s)=>n+s.rows.length,0),review:sheets.filter(s=>s.status==="review").length}),[sheets]);

  async function preview(file?:File){
    if(!file)return; setError("");setSaved("");setFileName(file.name);
    try{
      const wb=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
      const parsed:PreviewSheet[]=wb.SheetNames.map(sheetName=>{
        const raw=XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[sheetName],{header:1,defval:null,raw:true});
        const hi=findHeader(raw); if(hi<0)return {sheetName,contractNumber:sheetName,rows:[],status:"review",note:"USPS header row not found",expirationDates:[],effectiveDates:[]};
        const headers=raw[hi].map(clean); const map=new Map(headers.map((h,i)=>[h,i]));
        const missing=REQUIRED.filter(h=>!map.has(h)); const rows:TripRow[]=[];
        for(let r=hi+1;r<raw.length;r++){
          const row=raw[r]; const contract=clean(pick(row,map,["HCR*"])).toUpperCase(); const trip=clean(pick(row,map,["Trip*"]));
          if(!contract||!trip)continue; const effective=iso(pick(row,map,["Effective Date*"])); if(!effective)continue;
          rows.push({
            contract_number:contract,trip_number:trip,effective_start:effective,effective_end:iso(pick(row,map,["Expiration Date"])),
            unit_cost:num(pick(row,map,["Unit Cost*"])),annual_trip_cost:num(pick(row,map,["Annual Trip Cost (Calculated)"])),
            calculated_rate_per_mile:num(pick(row,map,ALIASES.rate)),detention_rate:num(pick(row,map,ALIASES.detention)),
            fuel_type:clean(pick(row,map,ALIASES.fuel))||null,usps_mpg:num(pick(row,map,ALIASES.mpg)),
            wage_rate:num(pick(row,map,ALIASES.wage)),health_welfare_rate:num(pick(row,map,ALIASES.hw)),
            equipment_type:clean(pick(row,map,ALIASES.equipment))||null,frequency:clean(pick(row,map,ALIASES.frequency))||null,
            annual_trip_count:num(pick(row,map,ALIASES.trips)),per_trip_miles:num(pick(row,map,ALIASES.miles)),
            per_trip_hours:num(pick(row,map,ALIASES.hours)),annual_miles:num(pick(row,map,ALIASES.annualMiles)),
            source_row_number:r+1,source_payload:Object.fromEntries(headers.map((h,i)=>[h,row[i]]).filter(([h])=>h))
          });
        }
        const contract=rows[0]?.contract_number??sheetName.replace(/\s*\(\d+\)\s*$/,"").split("-")[0].trim().toUpperCase();
        const exp=[...new Set(rows.map(x=>x.effective_end).filter(Boolean) as string[])].sort();
        const eff=[...new Set(rows.map(x=>x.effective_start))].sort();
        const term=/TERM|TERMINAT/i.test(sheetName+" "+raw.slice(0,hi).flat().map(clean).join(" "));
        return {sheetName,contractNumber:contract,rows,status:missing.length||!rows.length?"review":"ready",
          note:missing.length?"Missing: "+missing.join(", "):term?"Termination noted in USPS workbook":undefined,expirationDates:exp,effectiveDates:eff};
      });
      setSheets(parsed);
    }catch{setSheets([]);setError("I could not read that workbook. Please use the original USPS Excel file.");}
  }

  async function saveRates(){
    if(!sheets.length||totals.review){setError("Resolve workbook exceptions before saving.");return;}
    setSaving(true);setError("");setSaved("");
    try{
      const {data:{user}}=await supabase.auth.getUser(); if(!user)throw new Error("Sign in again before importing rates.");
      const {data:imp,error:ie}=await supabase.from("usps_rate_imports").insert({
        source_file_name:fileName,imported_by:user.id,sheet_count:sheets.length,trip_count:totals.trips,status:"validating"
      }).select("id").single(); if(ie)throw ie;
      for(const sheet of sheets){
        const groups=new Map<string,TripRow[]>();
        for(const row of sheet.rows){const key=row.effective_start+"|"+(row.effective_end??"");groups.set(key,[...(groups.get(key)??[]),row]);}
        for(const group of groups.values()){
          const first=group[0];
          const {data:version,error:ve}=await supabase.from("usps_contract_rate_versions").insert({
            contract_number:first.contract_number,effective_start:first.effective_start,effective_end:first.effective_end,
            source_import_id:imp.id,source_sheet_name:sheet.sheetName,
            contract_status:sheet.note==="Termination noted in USPS workbook"?"terminated":"active",termination_note:sheet.note==="Termination noted in USPS workbook"?sheet.note:null,created_by:user.id
          }).select("id").single(); if(ve)throw ve;
          const payload=group.map(({effective_start,effective_end,usps_mpg,...row})=>({...row,contract_rate_version_id:version.id}));
          const {error:te}=await supabase.from("usps_trip_rates").insert(payload);if(te)throw te;
        }
      }
      const {error:completeError}=await supabase.from("usps_rate_imports").update({status:"completed"}).eq("id",imp.id);
      if(completeError)throw completeError;
      setSaved(`Saved ${totals.trips.toLocaleString()} USPS trip rates across ${totals.contracts} contracts.`);
    }catch(e){
      const x=e as {message?:string;details?:string;hint?:string;code?:string};
      const parts=[x?.message,x?.details,x?.hint,x?.code?\`Code: ${x.code}\`:null].filter(Boolean);
      setError(parts.length?parts.join(" — "):"The USPS rates could not be saved.");
    }
    finally{setSaving(false);}
  }

  return <section className="hub-card no-print" style={{marginTop:24}}>
    <div className="section-heading"><div><p className="eyebrow">USPS contract financials</p><h2>Import USPS Rates</h2>
      <p>USPS is the authoritative source for contracted trips and rates. Valid rows import automatically; only structural exceptions are flagged.</p></div></div>
    <label className="hub-secondary-link" style={{display:"inline-block",cursor:"pointer"}}>Choose USPS workbook
      <input type="file" accept=".xlsx,.xls" onChange={e=>preview(e.target.files?.[0])} style={{display:"none"}}/></label>
    {error&&<p role="alert" style={{marginTop:16}}>{error}</p>}{saved&&<p style={{marginTop:16}}><strong>{saved}</strong></p>}
    {!!sheets.length&&<><div className="summary-grid" style={{marginTop:20}}>
      <div className="summary-card"><span>Workbook</span><strong>{fileName}</strong></div>
      <div className="summary-card"><span>Contracts</span><strong>{totals.contracts}</strong></div>
      <div className="summary-card"><span>USPS trips</span><strong>{totals.trips.toLocaleString()}</strong></div>
      <div className="summary-card"><span>Exceptions</span><strong>{totals.review}</strong></div>
    </div><div style={{overflowX:"auto",marginTop:20}}><table className="data-table"><thead><tr><th>Contract</th><th>Trips</th><th>Effective</th><th>Expiration</th><th>Status</th></tr></thead>
    <tbody>{sheets.map(s=><tr key={s.sheetName}><td><strong>{s.contractNumber}</strong></td><td>{s.rows.length.toLocaleString()}</td>
      <td>{s.effectiveDates.join(", ")||"—"}</td><td>{s.expirationDates.join(", ")||"—"}</td><td>{s.note??(s.status==="ready"?"Ready":"Review")}</td></tr>)}</tbody></table></div>
    <button className="hub-primary-link" type="button" onClick={saveRates} disabled={saving||totals.review>0} style={{marginTop:18}}>
      {saving?"Saving USPS rates…":"Save USPS Rates"}</button>
    <p style={{marginTop:12}}>Saving creates effective-dated rate history. A later USPS workbook will not erase prior contract periods.</p></>}
  </section>;
}
