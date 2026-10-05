'use client';

import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { syncClearRowsToLoadMaster } from '@/lib/loadMaster';
import { supabase } from '@/lib/supabase';
import { isTonyaTrip } from '@/lib/tonyaTrips';

type ClearRow = Record<string, unknown> & { __serviceDate?: string; __contractMiles?: number | null };
type Summary = { contract:string; trip:string; days:number; finalMiles:number; contractMiles:number|null; payableMiles:number; actualClearMiles:number; totalPaidMiles:number; overContract:boolean; missingContractMiles:boolean };
type TripVersion = { contract_number:string; trip_number:string; trip_miles:number|null; effective_from:string; effective_to:string|null };

function n(v: unknown) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function s(v: unknown) { return String(v ?? '').trim(); }
function iso(v: unknown) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0,10);
  const text=s(v); if(!text) return '';
  const direct=text.match(/^\d{4}-\d{2}-\d{2}/)?.[0]; if(direct) return direct;
  const d=new Date(text); return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);
}

export default function MonthlyClearReconciliation() {
  const [rows,setRows]=useState<ClearRow[]>([]),[name,setName]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[loadMasterMessage,setLoadMasterMessage]=useState('');

  async function upload(file?:File){
    if(!file)return; setError('');setName(file.name);setLoading(true);setLoadMasterMessage('');
    try{
      const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true}),ws=wb.Sheets[wb.SheetNames[0]];
      const matrix=XLSX.utils.sheet_to_json<unknown[]>(ws,{header:1,defval:null,raw:true});
      const headerIndex=matrix.findIndex(r=>Array.isArray(r)&&r.some(c=>s(c).toUpperCase()==='CONTRACT')&&r.some(c=>s(c).toUpperCase()==='SV TRIP ID'));
      if(headerIndex<0)throw new Error('Could not find the CLEAR header row. Expected CONTRACT and SV TRIP ID.');
      const headers=(matrix[headerIndex] as unknown[]).map(v=>s(v).toUpperCase());
      const data=matrix.slice(headerIndex+1).map(r=>{const out:ClearRow={};headers.forEach((h,i)=>{if(h)out[h]=(r as unknown[])[i];});return out;});
      const operationalRows=data.filter(r=>Object.values(r).some(v=>s(v)));
      const tonyaRows: Array<ClearRow & { __serviceDate: string }> = data.filter(r=>isTonyaTrip(s(r.CONTRACT),s(r['SV TRIP ID']))).map((r): ClearRow & { __serviceDate: string } => ({...r,__serviceDate:iso(r['PLANNED START'])}));
      const contracts=[...new Set(tonyaRows.map(r=>s(r.CONTRACT)).filter(Boolean))];
      let versions:TripVersion[]=[];
      if(contracts.length){
        const result=await supabase.from('contract_trip_versions').select('contract_number,trip_number,trip_miles,effective_from,effective_to').in('contract_number',contracts);
        if(result.error)throw result.error;
        versions=(result.data||[]) as TripVersion[];
      }
      const reviewed=tonyaRows.map(r=>{
        const contract=s(r.CONTRACT),trip=s(r['SV TRIP ID']),date=r.__serviceDate||'';
        const version=versions.filter(v=>v.contract_number===contract&&v.trip_number===trip&&v.effective_from<=date&&(!v.effective_to||v.effective_to>=date)).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
        return {...r,__contractMiles:version?.trip_miles==null?null:Number(version.trip_miles)};
      });
      setRows(reviewed);
      // Keep company Load Master sync, but do it after the reconciliation preview is ready so a large CLEAR file does not block the report.
      setLoading(false);
      void syncClearRowsToLoadMaster(operationalRows,file.name).then(imported=>setLoadMasterMessage(`${imported.synced.toLocaleString()} CLEAR loads added/updated in the company Load Master${imported.skippedWithoutIdentity?` · ${imported.skippedWithoutIdentity.toLocaleString()} rows skipped because load number/date could not be identified`:''}.`)).catch(e=>setLoadMasterMessage(`Reconciliation is ready. Load Master background sync needs review: ${e instanceof Error?e.message:String(e)}`));
    }catch(e){setRows([]);setError(e instanceof Error?e.message:'Unable to read workbook.');setLoading(false);}
  }

  const summary=useMemo(()=>{
    const map=new Map<string,{dates:Set<string>;clearMiles:number;payableMiles:number;finalMiles:number[];contractMiles:number[];over:boolean;missing:boolean}>();
    for(const r of rows){
      const contract=s(r.CONTRACT),trip=s(r['SV TRIP ID']),key=`${contract}|${trip}`,date=r.__serviceDate||'',clear=n(r['FINAL MILES']),contractMiles=r.__contractMiles??null;
      if(!map.has(key))map.set(key,{dates:new Set(),clearMiles:0,payableMiles:0,finalMiles:[],contractMiles:[],over:false,missing:false});
      const item=map.get(key)!;if(date)item.dates.add(date);if(clear>0){item.finalMiles.push(clear);item.clearMiles+=clear;}
      if(contractMiles==null){item.missing=true;}else{item.contractMiles.push(contractMiles);item.payableMiles+=Math.min(clear,contractMiles);if(clear>contractMiles)item.over=true;}
    }
    return [...map.entries()].map(([key,v]):Summary=>{const[contract,trip]=key.split('|'),finalMiles=v.finalMiles.length?Math.max(...v.finalMiles):0,contractMiles=v.contractMiles.length?Math.max(...v.contractMiles):null;return{contract,trip,days:v.dates.size,finalMiles,contractMiles,payableMiles:v.missing?0:(v.dates.size?v.payableMiles/v.dates.size:0),actualClearMiles:v.clearMiles,totalPaidMiles:v.missing?0:v.payableMiles,overContract:v.over,missingContractMiles:v.missing};}).sort((a,b)=>a.contract.localeCompare(b.contract)||Number(a.trip)-Number(b.trip));
  },[rows]);
  const totals=useMemo(()=>summary.reduce<Record<string,number>>((a,r)=>{a[r.contract]=(a[r.contract]||0)+r.totalPaidMiles;return a;},{}),[summary]);
  const totalDays=useMemo(()=>summary.reduce((x,r)=>x+r.days,0),[summary]),actualMiles=useMemo(()=>summary.reduce((x,r)=>x+r.actualClearMiles,0),[summary]),payableMiles=useMemo(()=>summary.reduce((x,r)=>x+r.totalPaidMiles,0),[summary]),cappedMiles=Math.max(0,actualMiles-payableMiles),missing=summary.filter(r=>r.missingContractMiles).length;

  return <>
    <section className="card" style={{marginBottom:18}}><p className="eyebrow">Step 3</p><h2 style={{marginTop:0,marginBottom:6}}>Upload CLEAR</h2><p className="muted" style={{marginTop:0}}>Use the untouched CLEAR workbook. The Hub reads the period from the file and applies Tonya's trip-level contract mileage cap automatically.</p>
      <label style={{display:'block',marginTop:16,padding:'28px 18px',border:'2px dashed #b9c6d6',borderRadius:12,background:'#f8fafc',textAlign:'center',cursor:'pointer'}}><div style={{fontSize:30,marginBottom:8}}>⇧</div><div style={{fontWeight:800,color:'#0f2747',fontSize:16}}>{loading?'Reading CLEAR workbook…':'Choose CLEAR workbook'}</div><div className="muted" style={{fontSize:13,marginTop:5}}>Excel .xlsx or .xls • no cleanup required before upload</div><input type="file" accept=".xlsx,.xls" disabled={loading} onChange={e=>void upload(e.target.files?.[0])} style={{display:'none'}}/></label>
      {name&&!error&&<div style={{marginTop:12,padding:11,borderRadius:9,background:'#eef4fb',color:'#0f2747'}}><strong>Loaded:</strong> {name}{loadMasterMessage&&<div style={{marginTop:5,fontSize:13}}>{loadMasterMessage}</div>}</div>}{error&&<div style={{marginTop:12,padding:11,borderRadius:9,background:'#fff1f2',color:'#9f1239',border:'1px solid #fecdd3'}}>{error}</div>}
    </section>
    {summary.length===0&&!loading&&name&&!error&&<section className="card" style={{marginBottom:18,textAlign:'center',padding:26}}><h3 style={{marginTop:0}}>No Tonya-assigned trips found</h3><p className="muted" style={{marginBottom:0}}>Check that the workbook contains 296B8 or 296C2 CLEAR activity.</p></section>}
    {summary.length>0&&<section className="card" style={{marginBottom:18}}><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}><div><p className="eyebrow">Step 4</p><h2 style={{marginTop:0,marginBottom:5}}>Tonya mileage reconciliation</h2><p className="muted" style={{marginTop:0}}>Payable mileage is the lower of CLEAR Final Miles or the contract/SVC mileage effective on that service date.</p></div><span style={{padding:'6px 10px',borderRadius:999,background:'#ecfdf5',color:'#166534',fontWeight:800,fontSize:12}}>FILE READ SUCCESSFULLY</span></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,margin:'16px 0'}}>{[['ASSIGNED TRIPS',summary.length],['TOTAL DAYS RAN',totalDays],['CLEAR MILES',actualMiles.toLocaleString(undefined,{maximumFractionDigits:1})],['PAYABLE MILES',payableMiles.toLocaleString(undefined,{maximumFractionDigits:1})],['MILES CAPPED',cappedMiles.toLocaleString(undefined,{maximumFractionDigits:1})]].map(([label,value])=><div key={String(label)} style={{padding:14,borderRadius:10,background:'#f8fafc',border:'1px solid #e2e8f0'}}><div className="muted" style={{fontSize:12}}>{label}</div><div style={{fontSize:24,fontWeight:850,color:'#0f2747'}}>{value}</div></div>)}</div>
      {missing>0&&<div style={{marginBottom:14,padding:12,borderRadius:9,background:'#fff8e8',border:'1px solid #f3d58a',color:'#76520b'}}><strong>{missing} trip{missing===1?'':'s'} need contract mileage.</strong> The Hub did not guess. Those rows are marked Review and excluded from payable totals until the effective contract/SVC mileage is available.</div>}
      <div className="table-wrap"><table><thead><tr><th>Contract</th><th>Trip</th><th>Days Ran</th><th>CLEAR Miles / Trip</th><th>Contract Miles</th><th>Rule</th><th>CLEAR Total</th><th>Payable Total</th></tr></thead><tbody>{summary.map(r=><tr key={`${r.contract}-${r.trip}`}><td><strong>{r.contract}</strong></td><td>{r.trip}</td><td>{r.days}</td><td>{r.finalMiles.toFixed(1)}</td><td>{r.contractMiles==null?'Review':r.contractMiles.toFixed(1)}</td><td>{r.missingContractMiles?'Needs contract miles':r.overContract?'Capped to contract':'CLEAR ≤ contract'}</td><td>{r.actualClearMiles.toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1})}</td><td><strong>{r.missingContractMiles?'—':r.totalPaidMiles.toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1})}</strong></td></tr>)}</tbody></table></div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:14}}>{Object.entries(totals).map(([c,t])=><div key={c} style={{padding:'10px 12px',borderRadius:9,background:'#eef4fb',color:'#0f2747'}}><strong>{c}</strong> · {t.toLocaleString(undefined,{maximumFractionDigits:1})} payable miles</div>)}</div>
    </section>}
  </>;
}
