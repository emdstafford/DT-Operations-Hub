"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PeriodAnnotations from "@/components/PeriodAnnotations";

type TrendRow = { period_start: string; load_count: number; total_stops: number; completed_stops: number; incomplete_stops: number; completion_percent: number };
type ContractRow = Omit<TrendRow, "period_start"> & { contract_number: string };
const formatNumber = (value: number) => Number(value || 0).toLocaleString("en-US");
const formatPercent = (value: number) => `${(Number(value || 0) * 100).toFixed(2)}%`;

export default function CompletionExplorer() {
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(`${today.slice(0, 4)}-01-01`);
  const [end, setEnd] = useState(today);
  const [grain, setGrain] = useState("week");
  const [supervisor, setSupervisor] = useState("");
  const [excludeAugust, setExcludeAugust] = useState(false);
  const [supervisorOptions, setSupervisorOptions] = useState<string[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const result = await supabase.rpc("supervisor_options");
      if (result.error) setError(result.error.message);
      else setSupervisorOptions((result.data ?? []).map((row: { supervisor: string }) => row.supervisor));
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError("");
      const trendResult = await supabase.rpc("performance_trend_filtered", {
        p_start: start, p_end: end, p_grain: grain,
        p_contract: null, p_supervisor: supervisor || null,
        p_exclude_august_2026: excludeAugust,
      });
      if (trendResult.error) {
        setError(trendResult.error.message);
        setTrend([]);
      } else setTrend((trendResult.data ?? []) as TrendRow[]);

      if (supervisor) {
        const contractResult = await supabase.rpc("supervisor_contract_performance_filtered", {
          p_start: start, p_end: end, p_supervisor: supervisor,
          p_exclude_august_2026: excludeAugust,
        });
        if (contractResult.error) setError(contractResult.error.message);
        setContracts((contractResult.data ?? []) as ContractRow[]);
      } else setContracts([]);
      setLoading(false);
    })();
  }, [start, end, grain, supervisor, excludeAugust]);

  const totals = trend.reduce((sum, row) => ({
    loads: sum.loads + Number(row.load_count),
    total: sum.total + Number(row.total_stops),
    completed: sum.completed + Number(row.completed_stops),
    incomplete: sum.incomplete + Number(row.incomplete_stops),
  }), { loads: 0, total: 0, completed: 0, incomplete: 0 });

  return <div className="report-stack">
    <section className="panel filter-bar">
      <label>Start date<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label>End date<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      <label>Trend grouping<select value={grain} onChange={(event) => setGrain(event.target.value)}><option value="day">Daily</option><option value="week">Weekly (Sat–Fri)</option><option value="month">Monthly</option><option value="year">Yearly</option></select></label>
      <label>Supervisor<select value={supervisor} onChange={(event) => setSupervisor(event.target.value)}><option value="">Overall company</option>{supervisorOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label className="filter-checkbox"><input type="checkbox" checked={excludeAugust} onChange={(event) => setExcludeAugust(event.target.checked)} />Exclude Aug 13–20</label>
    </section>

    <PeriodAnnotations start={start} end={end} />

    {error && <div className="alert alert-error">{error}</div>}
    {loading ? <section className="empty-state"><h2>Loading shared history…</h2></section> : <>
      <section className="metric-grid">
        <article className="metric-card metric-primary"><span>{supervisor || "Company"} completion</span><strong>{formatPercent(totals.total ? totals.completed / totals.total : 0)}</strong></article>
        <article className="metric-card"><span>Unique loads</span><strong>{formatNumber(totals.loads)}</strong></article>
        <article className="metric-card"><span>Total stops</span><strong>{formatNumber(totals.total)}</strong></article>
        <article className="metric-card"><span>Incomplete</span><strong>{formatNumber(totals.incomplete)}</strong></article>
      </section>
      <Table title={`${grain[0].toUpperCase() + grain.slice(1)} trend`} rows={trend} />
      {supervisor ? <ContractTable supervisor={supervisor} rows={contracts} /> : <section className="panel empty-state"><h2>Select a supervisor</h2><p>The contracts belonging to that supervisor during the selected dates will appear here.</p></section>}
    </>}
  </div>;
}

function Table({ title, rows }: { title: string; rows: TrendRow[] }) {
  return <section className="panel overflow-hidden"><div className="panel-heading"><h2>{title}</h2><span>{rows.length} periods</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Period starting</th><th>Loads</th><th>Total</th><th>Completed</th><th>Incomplete</th><th>Completion</th></tr></thead><tbody>{rows.map((row) => <tr key={row.period_start}><td className="font-semibold text-navy">{row.period_start}</td><td>{formatNumber(row.load_count)}</td><td>{formatNumber(row.total_stops)}</td><td>{formatNumber(row.completed_stops)}</td><td>{formatNumber(row.incomplete_stops)}</td><td>{formatPercent(row.completion_percent)}</td></tr>)}</tbody></table></div></section>;
}

function ContractTable({ supervisor, rows }: { supervisor: string; rows: ContractRow[] }) {
  return <section className="panel overflow-hidden"><div className="panel-heading"><h2>{supervisor}&apos;s contracts</h2><span>Assignments are matched by operating date</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>Loads</th><th>Total</th><th>Completed</th><th>Incomplete</th><th>Completion</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.contract_number} className={index < 10 ? "bottom-contract-row" : ""}><td><Link className="day-button" href={`/contracts/${encodeURIComponent(row.contract_number)}`}>{row.contract_number}</Link></td><td>{formatNumber(row.load_count)}</td><td>{formatNumber(row.total_stops)}</td><td>{formatNumber(row.completed_stops)}</td><td>{formatNumber(row.incomplete_stops)}</td><td>{formatPercent(row.completion_percent)}</td></tr>)}</tbody></table></div></section>;
}
