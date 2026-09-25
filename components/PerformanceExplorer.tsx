"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PeriodAnnotations from "@/components/PeriodAnnotations";

type Row = { period_start?: string; contract_number?: string; supervisor?: string; load_count: number; total_stops: number; completed_stops: number; incomplete_stops: number; completion_percent: number };
type MissedLoad = { operating_date: string; trip_number: string | null; load_number: string; incomplete_stops: number };
type MissedTrip = { date: string; trip: string; loads: string[]; incomplete: number };
const number = (value: number) => Number(value || 0).toLocaleString("en-US");
const percent = (value: number) => `${(Number(value || 0) * 100).toFixed(2)}%`;

export default function PerformanceExplorer({ fixedContract, contractsOnly = false, initialStart, initialEnd }: { fixedContract?: string; contractsOnly?: boolean; initialStart?: string; initialEnd?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(initialStart || `${today.slice(0, 4)}-01-01`);
  const [end, setEnd] = useState(initialEnd || today);
  const [grain, setGrain] = useState("week");
  const [selectedSupervisor, setSelectedSupervisor] = useState("");
  const [excludeAugust, setExcludeAugust] = useState(false);
  const [trend, setTrend] = useState<Row[]>([]);
  const [contracts, setContracts] = useState<Row[]>([]);
  const [supervisors, setSupervisors] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [missedTrips, setMissedTrips] = useState<MissedTrip[]>([]);
  const [missedLoading, setMissedLoading] = useState(false);
  const [missedError, setMissedError] = useState("");
  const [showAllTrips, setShowAllTrips] = useState(false);

  useEffect(() => { void (async () => {
    setLoading(true); setError("");
    const [trendResult, contractResult, supervisorResult] = await Promise.all([
      supabase.rpc("performance_trend_filtered", { p_start: start, p_end: end, p_grain: grain, p_contract: fixedContract ?? null, p_supervisor: selectedSupervisor || null, p_exclude_august_2026: excludeAugust }),
      supabase.rpc("contract_performance_filtered", { p_start: start, p_end: end, p_exclude_august_2026: excludeAugust }),
      supabase.rpc("supervisor_performance_filtered", { p_start: start, p_end: end, p_exclude_august_2026: excludeAugust }),
    ]);
    const failure = trendResult.error || contractResult.error || supervisorResult.error;
    if (failure) setError(failure.message);
    setTrend((trendResult.data ?? []) as Row[]);
    setContracts(((contractResult.data ?? []) as Row[]).filter((row) => !fixedContract || row.contract_number === fixedContract));
    setSupervisors((supervisorResult.data ?? []) as Row[]);
    setLoading(false);
  })(); }, [start, end, grain, fixedContract, selectedSupervisor, excludeAugust]);

  useEffect(() => {
    if (!fixedContract || !start || !end || start > end) return;
    let active = true;
    setMissedLoading(true); setMissedError(""); setShowAllTrips(false);
    void (async () => {
      const grouped = new Map<string, MissedTrip>();
      try {
        for (let offset = 0; active; offset += 1000) {
          const result = await supabase.from("usps_loads")
            .select("operating_date,trip_number,load_number,incomplete_stops")
            .eq("contract_number", fixedContract).gte("operating_date", start).lte("operating_date", end)
            .gt("incomplete_stops", 0).order("operating_date", { ascending: false })
            .order("load_number").range(offset, offset + 999);
          if (!active) return;
          if (result.error) throw result.error;
          for (const load of (result.data ?? []) as MissedLoad[]) {
            if (excludeAugust && load.operating_date >= "2026-08-13" && load.operating_date <= "2026-08-20") continue;
            const trip = load.trip_number || "Unmapped";
            const key = `${load.operating_date}\u0000${trip}`;
            const group = grouped.get(key) ?? { date: load.operating_date, trip, loads: [], incomplete: 0 };
            group.loads.push(load.load_number);
            group.incomplete += Number(load.incomplete_stops || 0);
            grouped.set(key, group);
          }
          if ((result.data ?? []).length < 1000) break;
        }
        if (active) setMissedTrips([...grouped.values()].sort((a, b) => b.incomplete - a.incomplete || b.date.localeCompare(a.date) || a.trip.localeCompare(b.trip, undefined, { numeric: true })));
      } catch (cause) {
        if (active) { setMissedError(cause instanceof Error ? cause.message : "Could not load incomplete stops by trip."); setMissedTrips([]); }
      } finally { if (active) setMissedLoading(false); }
    })();
    return () => { active = false; };
  }, [fixedContract, start, end, excludeAugust]);

  const totals = trend.reduce((sum, row) => ({ loads: sum.loads + Number(row.load_count), total: sum.total + Number(row.total_stops), completed: sum.completed + Number(row.completed_stops), incomplete: sum.incomplete + Number(row.incomplete_stops) }), { loads: 0, total: 0, completed: 0, incomplete: 0 });
  return <div className="report-stack">
    {fixedContract && <div className="contract-print-toolbar no-print"><div><strong>Contract {fixedContract}</strong><span>Print the totals and {grain} trend for the selected dates.</span></div><button className="primary-link" type="button" disabled={loading} onClick={() => window.print()}>Print contract report</button></div>}
    {fixedContract && <div className="print-only print-report-heading"><p>DT Intelligence Hub</p><h1>Contract {fixedContract} Performance</h1><strong>{start} – {end}</strong></div>}
    <section className="panel filter-bar no-print">
      <label>Start date<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label>End date<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      <label>Trend grouping<select value={grain} onChange={(event) => setGrain(event.target.value)}><option value="day">Daily</option><option value="week">Weekly (Sat–Fri)</option><option value="month">Monthly</option><option value="year">Yearly</option></select></label>
      {!contractsOnly && !fixedContract && <label>Supervisor<select value={selectedSupervisor} onChange={(event) => setSelectedSupervisor(event.target.value)}><option value="">All supervisors</option>{supervisors.filter((row) => row.supervisor && row.supervisor !== "Unassigned").map((row) => <option key={row.supervisor} value={row.supervisor}>{row.supervisor}</option>)}</select></label>}
      <label className="filter-checkbox"><input type="checkbox" checked={excludeAugust} onChange={(event) => setExcludeAugust(event.target.checked)} />Exclude Aug 13–20</label>
    </section>
    {!fixedContract && <PeriodAnnotations start={start} end={end} />}
    {error && <div className="alert alert-error">{error}</div>}
    {loading ? <section className="empty-state"><h2>Loading shared history…</h2></section> : <>
      <section className="metric-grid"><article className="metric-card metric-primary"><span>Completion</span><strong>{percent(totals.total ? totals.completed / totals.total : 0)}</strong></article><article className="metric-card"><span>Unique loads</span><strong>{number(totals.loads)}</strong></article><article className="metric-card"><span>Total stops</span><strong>{number(totals.total)}</strong></article><article className="metric-card"><span>Incomplete</span><strong>{number(totals.incomplete)}</strong></article></section>
      {!contractsOnly && <ResultsTable title={`${grain[0].toUpperCase() + grain.slice(1)} trend`} rows={trend} kind="trend" />}
      {fixedContract && <section className="panel contract-missed-trips"><div className="panel-heading"><div><h2>Incomplete USPS stops by day and trip</h2><span>Same operating dates and USPS load counts used in the Performance Review · {start} – {end}</span></div><strong>{number(missedTrips.reduce((sum, row) => sum + row.incomplete, 0))} incomplete</strong></div>
        {missedError && <div className="alert alert-error">{missedError}</div>}
        {missedLoading ? <div className="hub-loading">Loading affected trips…</div> : missedTrips.length ? <><div className="table-scroll"><table className="data-table"><thead><tr><th>Operating day</th><th>Trip</th><th>Incomplete stops</th><th>Loads affected</th><th>Load numbers</th></tr></thead><tbody>{(showAllTrips ? missedTrips : missedTrips.slice(0, 25)).map((row) => <tr key={`${row.date}-${row.trip}`}><td>{row.date}</td><td>{row.trip}</td><td><strong>{number(row.incomplete)}</strong></td><td>{number(row.loads.length)}</td><td><details><summary>Show loads</summary>{row.loads.join(", ")}</details></td></tr>)}</tbody></table></div>{missedTrips.length > 25 && <button type="button" className="fuel-check-expand no-print" onClick={() => setShowAllTrips(!showAllTrips)}>{showAllTrips ? "Show first 25" : `Show all ${number(missedTrips.length)} day and trip groups`}</button>}</> : !missedError && <div className="location-empty">No incomplete USPS stops for this contract during the selected dates.</div>}
        <p className="fuel-mileage-note">These are USPS load-report incomplete stops. Missed geofence locations come from the separate weekly report.</p>
      </section>}
      {!fixedContract && <ResultsTable title="Contracts" rows={contracts} kind="contract" />}
      {!contractsOnly && !fixedContract && <ResultsTable title="Supervisors" rows={supervisors} kind="supervisor" />}
    </>}
  </div>;
}

function ResultsTable({ title, rows, kind }: { title: string; rows: Row[]; kind: "trend" | "contract" | "supervisor" }) {
  return <section className="panel overflow-hidden"><div className="panel-heading"><h2>{title}</h2><span>{kind === "contract" ? "Click a contract to drill down" : `${rows.length} results`}</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>{kind === "trend" ? "Period starting" : kind === "contract" ? "Contract" : "Supervisor"}</th><th>Loads</th><th>Total</th><th>Completed</th><th>Incomplete</th><th>Completion</th></tr></thead><tbody>{rows.map((row, index) => { const key = row.period_start || row.contract_number || row.supervisor || String(index); return <tr key={key} className={kind === "contract" && index < 10 ? "bottom-contract-row" : kind === "supervisor" && index < 5 ? "top-performer-row" : ""}><td className="font-semibold text-navy">{kind === "contract" ? <Link className="day-button" href={`/contracts/${encodeURIComponent(row.contract_number || "Unmapped")}`}>{row.contract_number}</Link> : key}</td><td>{number(row.load_count)}</td><td>{number(row.total_stops)}</td><td>{number(row.completed_stops)}</td><td>{number(row.incomplete_stops)}</td><td>{percent(row.completion_percent)}</td></tr> })}</tbody></table></div></section>;
}
