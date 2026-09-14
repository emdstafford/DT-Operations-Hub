"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PeriodAnnotations from "@/components/PeriodAnnotations";
import { supabase } from "@/lib/supabase";

type Row = { period_start?: string; contract_number?: string; supervisor?: string; load_count: number; total_stops: number; completed_stops: number; incomplete_stops: number; completion_percent: number };
type HubData = { totals: Row; trend: Row[]; contracts: Row[]; supervisors: Row[] };
const empty: HubData = { totals: { load_count: 0, total_stops: 0, completed_stops: 0, incomplete_stops: 0, completion_percent: 0 }, trend: [], contracts: [], supervisors: [] };
const number = (value: number) => Number(value || 0).toLocaleString("en-US");
const percent = (value: number) => `${(Number(value || 0) * 100).toFixed(2)}%`;

export default function DashboardHub() {
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(`${today.slice(0, 4)}-01-01`);
  const [end, setEnd] = useState(today);
  const [grain, setGrain] = useState("week");
  const [selectedContracts, setSelectedContracts] = useState<string[]>([]);
  const [selectedSupervisors, setSelectedSupervisors] = useState<string[]>([]);
  const [contractOptions, setContractOptions] = useState<string[]>([]);
  const [supervisorOptions, setSupervisorOptions] = useState<string[]>([]);
  const [excludeAugust, setExcludeAugust] = useState(false);
  const [data, setData] = useState<HubData>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void (async () => {
    const [latest, contracts, supervisors] = await Promise.all([
      supabase.from("report_history").select("period_start,period_end").eq("report_type","usps_loads").order("period_end",{ascending:false}).limit(1).maybeSingle(),
      supabase.rpc("contract_options"), supabase.rpc("supervisor_options"),
    ]);
    if (latest.data) { setStart(latest.data.period_start); setEnd(latest.data.period_end); }
    setContractOptions((contracts.data ?? []).map((row: { contract_number: string }) => row.contract_number));
    setSupervisorOptions((supervisors.data ?? []).map((row: { supervisor: string }) => row.supervisor).filter((name: string) => name !== "Unassigned"));
  })(); }, []);

  useEffect(() => { void (async () => {
    setLoading(true); setError("");
    const result = await supabase.rpc("dashboard_hub_filtered", {
      p_start: start, p_end: end, p_grain: grain,
      p_contracts: selectedContracts.length ? selectedContracts : null,
      p_supervisors: selectedSupervisors.length ? selectedSupervisors : null,
      p_exclude_august_2026: excludeAugust,
    });
    if (result.error) { setError(result.error.message); setData(empty); }
    else setData((result.data ?? empty) as HubData);
    setLoading(false);
  })(); }, [start, end, grain, selectedContracts, selectedSupervisors, excludeAugust]);

  const maxIncomplete = useMemo(() => Math.max(1, ...data.trend.map((row) => Number(row.incomplete_stops))), [data.trend]);
  return <div className="report-stack">
    <section className="panel hub-filters">
      <label>Start date<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label>End date<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      <label>View by<select value={grain} onChange={(event) => setGrain(event.target.value)}><option value="day">Day</option><option value="week">Week (Sat–Fri)</option><option value="month">Month</option><option value="year">Year</option></select></label>
      <MultiSelect label="Supervisors" options={supervisorOptions} selected={selectedSupervisors} setSelected={setSelectedSupervisors} />
      <MultiSelect label="Contracts" options={contractOptions} selected={selectedContracts} setSelected={setSelectedContracts} />
      <label className="filter-checkbox"><input type="checkbox" checked={excludeAugust} onChange={(event) => setExcludeAugust(event.target.checked)} />Exclude Aug 13–20</label>
      {(selectedContracts.length > 0 || selectedSupervisors.length > 0) && <button className="clear-filters" onClick={() => { setSelectedContracts([]); setSelectedSupervisors([]); }}>Clear selections</button>}
    </section>
    <PeriodAnnotations start={start} end={end} />
    {error && <div className="alert alert-error">{error.includes("dashboard_hub_filtered") ? "The dashboard database update still needs to be installed in Supabase." : error}</div>}
    {loading ? <section className="hub-loading">Loading your operations picture…</section> : <>
      <section className="metric-grid">
        <article className="metric-card metric-primary"><span>Completion</span><strong>{percent(data.totals.completion_percent)}</strong></article>
        <article className="metric-card"><span>Unique loads</span><strong>{number(data.totals.load_count)}</strong></article>
        <article className="metric-card"><span>Total stops</span><strong>{number(data.totals.total_stops)}</strong></article>
        <article className="metric-card"><span>Incomplete stops</span><strong>{number(data.totals.incomplete_stops)}</strong></article>
      </section>
      <section className="hub-grid">
        <section className="panel hub-trend"><div className="panel-heading"><h2>Performance trend</h2><span>{data.trend.length} periods</span></div><div className="trend-list">{data.trend.map((row) => <div className="trend-row" key={row.period_start}><div><strong>{row.period_start}</strong><span>{percent(row.completion_percent)}</span></div><div className="trend-track"><i style={{width:`${Math.max(2, Number(row.incomplete_stops) / maxIncomplete * 100)}%`}} /></div><small>{number(row.incomplete_stops)} incomplete</small></div>)}</div></section>
        <section className="panel attention-panel"><div className="panel-heading"><h2>Needs attention</h2><span>Lowest contracts</span></div><div className="attention-list">{data.contracts.slice(0,10).map((row,index) => <Link href={`/contracts/${encodeURIComponent(row.contract_number || "Unmapped")}`} key={row.contract_number}><span>{index+1}</span><strong>{row.contract_number}</strong><em>{percent(row.completion_percent)}</em><small>{number(row.incomplete_stops)} incomplete</small></Link>)}</div></section>
      </section>
      <section className="hub-grid">
        <HubTable title="Supervisors" rows={data.supervisors} kind="supervisor" />
        <HubTable title="Contracts" rows={data.contracts} kind="contract" />
      </section>
    </>}
  </div>;
}

function MultiSelect({ label, options, selected, setSelected }: { label: string; options: string[]; selected: string[]; setSelected: (values: string[]) => void }) {
  return <div className="multi-filter"><span>{label}</span><details><summary>{selected.length ? `${selected.length} selected` : `All ${label.toLowerCase()}`}</summary><div className="multi-menu"><button type="button" onClick={() => setSelected(selected.length === options.length ? [] : options)}>{selected.length === options.length ? "Clear all" : "Select all"}</button>{options.map((option) => <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={() => setSelected(selected.includes(option) ? selected.filter((value) => value !== option) : [...selected, option])} />{option}</label>)}</div></details></div>;
}

function HubTable({ title, rows, kind }: { title: string; rows: Row[]; kind: "contract" | "supervisor" }) {
  return <section className="panel overflow-hidden"><div className="panel-heading"><h2>{title}</h2><span>{rows.length} results</span></div><div className="table-scroll hub-table-scroll"><table className="data-table"><thead><tr><th>{title.slice(0,-1)}</th><th>Stops</th><th>Incomplete</th><th>Completion</th></tr></thead><tbody>{rows.map((row,index) => { const name = kind === "contract" ? row.contract_number : row.supervisor; return <tr key={name} className={kind === "supervisor" && index < 5 ? "top-performer-row" : kind === "contract" && index < 10 ? "bottom-contract-row" : ""}><td className="font-semibold text-navy">{kind === "contract" ? <Link className="day-button" href={`/contracts/${encodeURIComponent(name || "Unmapped")}`}>{name}</Link> : name}</td><td>{number(row.total_stops)}</td><td>{number(row.incomplete_stops)}</td><td>{percent(row.completion_percent)}</td></tr>; })}</tbody></table></div></section>;
}
