"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type ContractRow = { contract_number: string; load_count: number; total_stops: number; incomplete_stops: number; completion_percent: number };
type Assignment = { contract_number: string; supervisor: string; start_date: string; end_date: string | null };
type CurrentAssignment = { contract_number: string; supervisor: string };
type Range = "day" | "week" | "month" | "custom";

function date(value: Date) { return value.toISOString().slice(0, 10); }
function preset(mode: Exclude<Range, "custom">, anchor: string) {
  const last = new Date(`${anchor}T12:00:00Z`);
  if (mode === "day") return { start: anchor, end: anchor };
  if (mode === "month") return { start: date(new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1, 12))), end: anchor };
  const first = new Date(last);
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 1) % 7));
  return { start: date(first), end: anchor };
}
function names(values: string[]) {
  return [...new Set(values.flatMap((value) => value.split("/")).map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
const number = (value: number) => Number(value || 0).toLocaleString("en-US");
const percent = (value: number) => `${(Number(value || 0) * 100).toFixed(2)}%`;

export default function ContractSelector() {
  const today = new Date().toISOString().slice(0, 10);
  const [anchor, setAnchor] = useState(today);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [range, setRange] = useState<Range>("week");
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [currentAssignments, setCurrentAssignments] = useState<CurrentAssignment[]>([]);
  const [rows, setRows] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      const [latest, contracts, dated, current] = await Promise.all([
        supabase.from("report_history").select("period_end").eq("report_type", "usps_loads").order("period_end", { ascending: false }).limit(1).maybeSingle(),
        supabase.rpc("contract_options"),
        supabase.from("contract_assignment_periods").select("contract_number,supervisor,start_date,end_date"),
        supabase.from("contract_supervisors").select("contract_number,supervisor"),
      ]);
      if (!active) return;
      const latestDay = latest.data?.period_end || today;
      setAnchor(latestDay);
      const query = new URLSearchParams(window.location.search);
      const queryStart = query.get("start") || "";
      const queryEnd = query.get("end") || "";
      const hasDates = /^\d{4}-\d{2}-\d{2}$/.test(queryStart) && /^\d{4}-\d{2}-\d{2}$/.test(queryEnd);
      const dates = hasDates ? { start: queryStart, end: queryEnd } : preset("week", latestDay);
      setStart(dates.start); setEnd(dates.end);
      if (hasDates) setRange("custom");
      setOptions((contracts.data ?? []).map((row: { contract_number: string }) => row.contract_number));
      setAssignments((dated.data ?? []) as Assignment[]);
      setCurrentAssignments((current.data ?? []) as CurrentAssignment[]);
      if (contracts.error) setError(contracts.error.message);
      setReady(true);
    })();
    return () => { active = false; };
  }, [today]);

  useEffect(() => {
    if (!ready || !start || !end) return;
    if (start > end) { setError("The start date must be on or before the end date."); setRows([]); setLoading(false); return; }
    let active = true;
    setLoading(true); setError("");
    void (async () => {
      const result = await supabase.rpc("contract_performance_filtered", { p_start: start, p_end: end, p_exclude_august_2026: false });
      if (!active) return;
      if (result.error) { setError(result.error.message); setRows([]); }
      else setRows((result.data ?? []) as ContractRow[]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [ready, start, end]);

  const supervisorMap = useMemo(() => {
    const found = new Map<string, string[]>();
    for (const row of assignments) {
      if (row.start_date > end || (row.end_date && row.end_date < start)) continue;
      found.set(row.contract_number, [...(found.get(row.contract_number) ?? []), row.supervisor]);
    }
    for (const row of currentAssignments) {
      if (!found.has(row.contract_number)) found.set(row.contract_number, [row.supervisor]);
    }
    return new Map([...found].map(([contract, values]) => [contract, names(values)]));
  }, [assignments, currentAssignments, start, end]);

  const visible = useMemo(() => {
    const byContract = new Map(rows.map((row) => [row.contract_number, row]));
    return [...new Set([...options, ...rows.map((row) => row.contract_number)])]
      .map((contract) => ({ contract, row: byContract.get(contract), supervisors: supervisorMap.get(contract) ?? [] }))
      .filter((item) => !onlyAttention || (item.row && Number(item.row.completion_percent) < 0.95))
      .filter((item) => `${item.contract} ${item.supervisors.join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => {
        const aNeedsHelp = a.row && Number(a.row.completion_percent) < 0.95 ? 0 : 1;
        const bNeedsHelp = b.row && Number(b.row.completion_percent) < 0.95 ? 0 : 1;
        return aNeedsHelp - bNeedsHelp || Number(a.row?.completion_percent ?? 1) - Number(b.row?.completion_percent ?? 1) || a.contract.localeCompare(b.contract);
      });
  }, [rows, options, supervisorMap, onlyAttention, search]);

  function chooseRange(mode: Exclude<Range, "custom">) {
    const dates = preset(mode, anchor);
    setRange(mode); setStart(dates.start); setEnd(dates.end); setShowAll(false);
  }

  return <section className="panel contract-browser">
    <div className="panel-heading"><div><p className="eyebrow">Find a contract</p><h2>Open a contract</h2><span>Contracts needing help appear first. Tap any contract to see its missed stops and trips.</span></div></div>
    <div className="contract-browser-controls">
      <div className="contract-quick-dates" role="group" aria-label="Contract reporting period">
        <button type="button" className={range === "day" ? "active" : ""} onClick={() => chooseRange("day")}>Latest day</button>
        <button type="button" className={range === "week" ? "active" : ""} onClick={() => chooseRange("week")}>Latest week</button>
        <button type="button" className={range === "month" ? "active" : ""} onClick={() => chooseRange("month")}>Latest month</button>
      </div>
      <div className="contract-browser-dates"><label>From<input type="date" value={start} onChange={(event) => { setStart(event.target.value); setRange("custom"); }} /></label><label>To<input type="date" value={end} onChange={(event) => { setEnd(event.target.value); setRange("custom"); }} /></label></div>
      <label className="contract-search">Search contract or supervisor<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setShowAll(false); }} placeholder="Contract number or supervisor name" /></label>
    </div>
    <div className="contract-browser-tabs" role="group" aria-label="Contract status">
      <button type="button" className={!onlyAttention ? "active" : ""} onClick={() => { setOnlyAttention(false); setShowAll(false); }}>All contracts</button>
      <button type="button" className={onlyAttention ? "active" : ""} onClick={() => { setOnlyAttention(true); setShowAll(false); }}>Below 95% ({rows.filter((row) => Number(row.completion_percent) < 0.95).length})</button>
      <span>{start && end ? `${start} – ${end}` : "Loading dates…"}</span>
    </div>
    {error && <div className="alert alert-error">{error}</div>}
    {loading ? <div className="hub-loading">Finding contracts…</div> : visible.length ? <>
      <div className="contract-browser-list">{(showAll ? visible : visible.slice(0, 24)).map(({ contract, row, supervisors }) => {
        const completion = Number(row?.completion_percent ?? 0);
        const status = !row ? "No loads in these dates" : completion >= 0.95 ? "Doing well" : "Needs attention";
        return <Link className="contract-browser-card" href={`/contracts/${encodeURIComponent(contract)}?start=${start}&end=${end}`} key={contract}>
          <div className="contract-browser-name"><strong>{contract}</strong><span>{supervisors.join(", ") || "Supervisor not assigned"}</span></div>
          <div className="contract-browser-stats"><strong>{row ? percent(completion) : "—"}</strong><span>{row ? `${number(row.incomplete_stops)} incomplete stops` : "No results for this period"}</span></div>
          <span className={`contract-browser-status ${!row ? "status-quiet" : completion >= 0.95 ? "status-good" : "status-attention"}`}>{status}</span>
          <span className="contract-browser-arrow" aria-hidden="true">→</span>
        </Link>;
      })}</div>
      {visible.length > 24 && <button type="button" className="fuel-check-expand" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer contracts ↑" : `Show all ${visible.length} contracts ↓`}</button>}
    </> : <div className="location-empty">No contracts match this search and date range. Try another date or clear the search.</div>}
  </section>;
}
