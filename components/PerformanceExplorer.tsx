"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PeriodAnnotations from "@/components/PeriodAnnotations";

type Row = { period_start?: string; contract_number?: string; supervisor?: string; load_count: number; total_stops: number; completed_stops: number; incomplete_stops: number; completion_percent: number };
const number = (value: number) => Number(value || 0).toLocaleString("en-US");
const percent = (value: number) => `${(Number(value || 0) * 100).toFixed(2)}%`;

export default function PerformanceExplorer({ fixedContract, contractsOnly = false }: { fixedContract?: string; contractsOnly?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(`${today.slice(0, 4)}-01-01`);
  const [end, setEnd] = useState(today);
  const [grain, setGrain] = useState("week");
  const [selectedSupervisor, setSelectedSupervisor] = useState("");
  const [trend, setTrend] = useState<Row[]>([]);
  const [contracts, setContracts] = useState<Row[]>([]);
  const [supervisors, setSupervisors] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { void (async () => {
    setLoading(true); setError("");
    const [trendResult, contractResult, supervisorResult] = await Promise.all([
      supabase.rpc("performance_trend", { p_start: start, p_end: end, p_grain: grain, p_contract: fixedContract ?? null, p_supervisor: selectedSupervisor || null }),
      supabase.rpc("contract_performance", { p_start: start, p_end: end }),
      supabase.rpc("supervisor_performance", { p_start: start, p_end: end }),
    ]);
    const failure = trendResult.error || contractResult.error || supervisorResult.error;
    if (failure) setError(failure.message);
    setTrend((trendResult.data ?? []) as Row[]);
    setContracts(((contractResult.data ?? []) as Row[]).filter((row) => !fixedContract || row.contract_number === fixedContract));
    setSupervisors((supervisorResult.data ?? []) as Row[]);
    setLoading(false);
  })(); }, [start, end, grain, fixedContract, selectedSupervisor]);

  const totals = trend.reduce((sum, row) => ({ loads: sum.loads + Number(row.load_count), total: sum.total + Number(row.total_stops), completed: sum.completed + Number(row.completed_stops), incomplete: sum.incomplete + Number(row.incomplete_stops) }), { loads: 0, total: 0, completed: 0, incomplete: 0 });
  return <div className="report-stack">
    <section className="panel filter-bar">
      <label>Start date<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label>End date<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      <label>Trend grouping<select value={grain} onChange={(event) => setGrain(event.target.value)}><option value="day">Daily</option><option value="week">Weekly (Sat–Fri)</option><option value="month">Monthly</option><option value="year">Yearly</option></select></label>
      {!contractsOnly && !fixedContract && <label>Supervisor<select value={selectedSupervisor} onChange={(event) => setSelectedSupervisor(event.target.value)}><option value="">All supervisors</option>{supervisors.filter((row) => row.supervisor && row.supervisor !== "Unassigned").map((row) => <option key={row.supervisor} value={row.supervisor}>{row.supervisor}</option>)}</select></label>}
    </section>
    <PeriodAnnotations start={start} end={end} />
    {error && <div className="alert alert-error">{error}</div>}
    {loading ? <section className="empty-state"><h2>Loading shared history…</h2></section> : <>
      <section className="metric-grid"><article className="metric-card metric-primary"><span>Completion</span><strong>{percent(totals.total ? totals.completed / totals.total : 0)}</strong></article><article className="metric-card"><span>Unique loads</span><strong>{number(totals.loads)}</strong></article><article className="metric-card"><span>Total stops</span><strong>{number(totals.total)}</strong></article><article className="metric-card"><span>Incomplete</span><strong>{number(totals.incomplete)}</strong></article></section>
      {!contractsOnly && <ResultsTable title={`${grain[0].toUpperCase() + grain.slice(1)} trend`} rows={trend} kind="trend" />}
      {!fixedContract && <ResultsTable title="Contracts" rows={contracts} kind="contract" />}
      {!contractsOnly && !fixedContract && <ResultsTable title="Supervisors" rows={supervisors} kind="supervisor" />}
    </>}
  </div>;
}

function ResultsTable({ title, rows, kind }: { title: string; rows: Row[]; kind: "trend" | "contract" | "supervisor" }) {
  return <section className="panel overflow-hidden"><div className="panel-heading"><h2>{title}</h2><span>{kind === "contract" ? "Click a contract to drill down" : `${rows.length} results`}</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>{kind === "trend" ? "Period starting" : kind === "contract" ? "Contract" : "Supervisor"}</th><th>Loads</th><th>Total</th><th>Completed</th><th>Incomplete</th><th>Completion</th></tr></thead><tbody>{rows.map((row, index) => { const key = row.period_start || row.contract_number || row.supervisor || String(index); return <tr key={key} className={kind === "contract" && index < 10 ? "bottom-contract-row" : kind === "supervisor" && index < 5 ? "top-performer-row" : ""}><td className="font-semibold text-navy">{kind === "contract" ? <Link className="day-button" href={`/contracts/${encodeURIComponent(row.contract_number || "Unmapped")}`}>{row.contract_number}</Link> : key}</td><td>{number(row.load_count)}</td><td>{number(row.total_stops)}</td><td>{number(row.completed_stops)}</td><td>{number(row.incomplete_stops)}</td><td>{percent(row.completion_percent)}</td></tr> })}</tbody></table></div></section>;
}
