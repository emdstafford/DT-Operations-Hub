"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type MonthlyRow = {
  contract_number:string; month_start:string; contracted_revenue:number; scheduled_miles:number;
  active_days:number; calendar_days:number; rate_period_count:number;
};
const money=(n:number)=>Number(n||0).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2});
const number=(n:number)=>Number(n||0).toLocaleString("en-US",{maximumFractionDigits:1});

export default function ContractMonthlyFinancials({contract}:{contract:string}){
  const now=new Date(); const [month,setMonth]=useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`);
  const [row,setRow]=useState<MonthlyRow|null>(null); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  useEffect(()=>{let active=true;(async()=>{
    setLoading(true);setError("");
    const {data,error}=await supabase.rpc("usps_contract_monthly_financials",{p_contract:contract,p_month:month+"-01"});
    if(!active)return;
    if(error){setRow(null);setError("Monthly USPS financials will appear after the contract financial SQL is installed.");}
    else setRow((data?.[0]??null) as MonthlyRow|null);
    setLoading(false);
  })();return()=>{active=false};},[contract,month]);

  return <section className="panel" style={{marginTop:24}}>
    <div className="panel-heading"><div><p className="eyebrow">Contract financials</p><h2>Monthly financials</h2>
      <span>USPS contracted baseline for the selected month. Labor, fuel and other costs will layer into this same view.</span></div>
      <label className="no-print">Month <input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
    </div>
    {error&&<p className="alert alert-error">{error}</p>}
    {loading?<p>Loading monthly financials…</p>:row?<div className="summary-grid">
      <div className="summary-card"><span>Contracted revenue</span><strong>{money(row.contracted_revenue)}</strong></div>
      <div className="summary-card"><span>Scheduled miles</span><strong>{number(row.scheduled_miles)}</strong></div>
      <div className="summary-card"><span>Rate periods used</span><strong>{row.rate_period_count}</strong></div>
      <div className="summary-card"><span>Contract coverage</span><strong>{row.active_days} days</strong></div>
    </div>:<p>No USPS contract rate was active for this month.</p>}
    <div style={{overflowX:"auto",marginTop:18}}><table className="data-table"><thead><tr>
      <th>Contracted revenue</th><th>Earned revenue</th><th>Paid revenue</th><th>Driver pay</th><th>Fringe / burden</th><th>Fuel</th><th>Equipment / other</th><th>Profit</th><th>Margin</th>
    </tr></thead><tbody><tr><td>{row?money(row.contracted_revenue):"—"}</td><td>Coming next</td><td>Future USPS payment data</td><td>Timecards</td><td>Payroll data</td><td>Comdata</td><td>Future costs</td><td>—</td><td>—</td></tr></tbody></table></div>
    <p style={{marginTop:12}}>Contracted revenue is the USPS schedule baseline. It is intentionally kept separate from earned revenue and actual USPS payment so we can reconcile all three later.</p>
  </section>;
}
