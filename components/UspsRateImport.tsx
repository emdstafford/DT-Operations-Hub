"use client";

import { useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
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
  const [fileName,setFileName]=useState(""); const [fileHash,setFileHash]=useState(""); const [sheets,setSheets]=useState<PreviewSheet[]>([]);
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false); const [saved,setSaved]=useState("");
  const [dragging,setDragging]=useState(false); const inputRef=useRef<HTMLInputElement>(null);
  const totals=useMemo(()=>({contracts:sheets.length,trips:sheets.reduce((n,s)=>n+s.rows.length,0),review:sheets.filter(s=>s.status==="review").length}),[sheets]);

  async function preview(file?:File){
    if(!file)return; setError("");setSaved("");setFileName(file.name);setFileHash("");
    try{
      const bytes=await file.arrayBuffer();
      const digest=await crypto.subtle.digest("SHA-256",bytes);
      setFileHash(Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join(""));
      const wb=XLSX.read(bytes,{type:"array",cellDates:true});
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

  function onDrop(event:DragEvent<HTMLDivElement>){
    event.preventDefault();setDragging(false);
    void preview(event.dataTransfer.files?.[0]);
  }

  async function saveRates(){
    if(!sheets.length||totals.review){setError("Resolve workbook exceptions before saving.");return;}
    if(!fileHash){setError("Choose the USPS workbook again so its file fingerprint can be verified.");return;}
    setSaving(true);setError("");setSaved("");
    try{
      const {data:{user}}=await supabase.auth.getUser(); if(!user)throw new Error("Sign in again before importing rates.");

      const {error:cleanupError}=await supabase.rpc("cleanup_incomplete_usps_rate_imports",{p_source_file_name:fileName});
      if(cleanupError)throw cleanupError;

      const payload=sheets.map(sheet=>({
        sheetName:sheet.sheetName,
        contractNumber:sheet.contractNumber,
        note:sheet.note??null,
        rows:sheet.rows
      }));
      const {error:importError}=await supabase.rpc("import_usps_rate_workbook",{
        p_source_file_name:fileName,
        p_source_file_hash:fileHash,
        p_sheet_count:sheets.length,
        p_trip_count:totals.trips,
        p_sheets:payload
      });
      if(importError)throw importError;

      setSaved(`Saved ${totals.trips.toLocaleString()} USPS trip rates across ${totals.contracts} contracts. The import is complete and connected to contract mileage history.`);
    }catch(e){
      const x=e as {message?:string;details?:string;hint?:string;code?:string};
      const parts=[x?.message,x?.details,x?.hint,x?.code?`Code: ${x.code}`:null].filter(Boolean);
      setError(parts.length?parts.join(" — "):"The USPS rates could not be saved.");
    }
    finally{setSaving(false);}
  }

  return <section className="contract-intake no-print">
    <div
      className={`contract-drop-zone${dragging?" is-dragging":""}`}
      onDragEnter={event=>{event.preventDefault();setDragging(true);}}
      onDragOver={event=>{event.preventDefault();setDragging(true);}}
      onDragLeave={event=>{event.preventDefault();const next=event.relatedTarget as Node | null;if(!next||!event.currentTarget.contains(next))setDragging(false);}}
      onDrop={onDrop}
      onClick={()=>inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();inputRef.current?.click();}}}
    >
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.pdf,.doc,.docx" onChange={event=>void preview(event.target.files?.[0])} />
      <div className="contract-drop-icon" aria-hidden="true">↑</div>
      <p className="eyebrow">Contract intake</p>
      <h2>{fileName?"Choose another file":"Drop a contract file here"}</h2>
      <p>Drag and drop a USPS workbook, contract, amendment, extension, or bid package — or click to browse.</p>
      <span>Excel · PDF · Word</span>
    </div>

    {fileName&&<div className="contract-detected-file"><span>Selected file</span><strong>{fileName}</strong>{sheets.length>0&&<em>Recognized as USPS rate workbook</em>}</div>}
    {error&&<p className="alert alert-error" role="alert">{error}</p>}
    {saved&&<p className="alert contract-import-success"><strong>{saved}</strong></p>}

    {!!sheets.length&&<section className="panel contract-import-preview">
      <div className="panel-heading"><div><p className="eyebrow">Detected automatically</p><h2>USPS Rate Workbook</h2><span>Review the detected contracts and trips before saving.</span></div></div>
      <div className="summary-grid contract-import-summary">
        <div className="summary-card"><span>Contracts</span><strong>{totals.contracts}</strong></div>
        <div className="summary-card"><span>USPS trips</span><strong>{totals.trips.toLocaleString()}</strong></div>
        <div className="summary-card"><span>Exceptions</span><strong>{totals.review}</strong></div>
      </div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>Trips</th><th>Effective</th><th>Expiration</th><th>Status</th></tr></thead>
      <tbody>{sheets.map(sheet=><tr key={sheet.sheetName}><td><strong>{sheet.contractNumber}</strong></td><td>{sheet.rows.length.toLocaleString()}</td>
        <td>{sheet.effectiveDates.join(", ")||"—"}</td><td>{sheet.expirationDates.join(", ")||"—"}</td><td>{sheet.note??(sheet.status==="ready"?"Ready":"Review")}</td></tr>)}</tbody></table></div>
      <div className="contract-import-actions">
        <button className="primary-link" type="button" onClick={()=>void saveRates()} disabled={saving||totals.review>0}>{saving?"Saving USPS rates…":"Save USPS Rates"}</button>
        <span>Saving creates effective-dated history. Later USPS files do not erase prior contract periods.</span>
      </div>
    </section>}
  </section>;
}
