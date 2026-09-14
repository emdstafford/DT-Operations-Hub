"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PeriodAnnotations from "@/components/PeriodAnnotations";
import { supabase } from "@/lib/supabase";

type Row = { period_start?: string; contract_number?: string; supervisor?: string; load_count: number; total_stops: number; completed_stops: number; incomplete_stops: number; completion_percent: number };
type SupervisorContractRow = Row & { supervisor: string; contract_number: string };
type HubData = { totals: Row; trend: Row[]; contracts: Row[]; supervisors: Row[]; supervisor_contracts: SupervisorContractRow[] };
type LocationRow = { key: string; occurrences: number };
const empty: HubData = { totals: { load_count: 0, total_stops: 0, completed_stops: 0, incomplete_stops: 0, completion_percent: 0 }, trend: [], contracts: [], supervisors: [], supervisor_contracts: [] };
const number = (value: number) => Number(value || 0).toLocaleString("en-US");
const percent = (value: number) => `${(Number(value || 0) * 100).toFixed(2)}%`;
const displayDate = (value: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);

function filteredEmail(data: HubData, start: string, end: string, supervisors: string[], contracts: string[]) {
  const header = "background:#123b61;color:#fff;padding:8px;border:1px solid #d6dde3;text-align:left";
  const cell = "padding:7px 9px;border:1px solid #d6dde3;text-align:right";
  const nameCell = `${cell};text-align:left;font-weight:600`;
  const bottomContracts = new Set(data.contracts.slice(0, 10).map((row) => row.contract_number || "Unmapped"));
  const supervisorRows = data.supervisors.map((row, index) => `<tr style="${index < 5 ? "background:#c9e7cf;color:#174e27" : ""}"><td style="${nameCell}">${escapeHtml(row.supervisor || "Unassigned")}</td><td style="${cell}">${number(row.total_stops)}</td><td style="${cell}">${number(row.incomplete_stops)}</td><td style="${cell}">${percent(row.completion_percent)}</td></tr>`).join("");
  const contractRows = data.contracts.map((row, index) => `<tr style="${index < 10 ? "background:#f0c8cd;color:#742430" : ""}"><td style="${nameCell}">${escapeHtml(row.contract_number || "Unmapped")}</td><td style="${cell}">${number(row.total_stops)}</td><td style="${cell}">${number(row.completed_stops)}</td><td style="${cell}">${number(row.incomplete_stops)}</td><td style="${cell}">${percent(row.completion_percent)}</td></tr>`).join("");
  const supervisorDetail = data.supervisors.map((supervisor, supervisorIndex) => {
    const rows = data.supervisor_contracts.filter((row) => row.supervisor === supervisor.supervisor).map((row) => `<tr style="${bottomContracts.has(row.contract_number) ? "background:#f0c8cd;color:#742430" : ""}"><td style="${nameCell}">${escapeHtml(row.contract_number)}</td><td style="${cell}">${number(row.total_stops)}</td><td style="${cell}">${number(row.completed_stops)}</td><td style="${cell}">${number(row.incomplete_stops)}</td><td style="${cell}">${percent(row.completion_percent)}</td></tr>`).join("");
    return `<section style="break-inside:avoid;page-break-inside:avoid;margin-top:22px"><h3 style="margin:0;padding:10px 12px;color:${supervisorIndex < 5 ? "#174e27" : "#123b61"};background:${supervisorIndex < 5 ? "#c9e7cf" : "#eef2f5"};border:1px solid #d6dde3">${escapeHtml(supervisor.supervisor || "Unassigned")} — ${percent(supervisor.completion_percent)}</h3><table style="width:100%;border-collapse:collapse"><thead><tr><th style="${header}">Contract</th><th style="${header}">Total Stops</th><th style="${header}">Completed</th><th style="${header}">Missed Stops</th><th style="${header}">% Complete</th></tr></thead><tbody>${rows}<tr style="font-weight:bold;background:#eef2f5"><td style="${nameCell}">Supervisor Total</td><td style="${cell}">${number(supervisor.total_stops)}</td><td style="${cell}">${number(supervisor.completed_stops)}</td><td style="${cell}">${number(supervisor.incomplete_stops)}</td><td style="${cell}">${percent(supervisor.completion_percent)}</td></tr></tbody></table></section>`;
  }).join("");
  const filterNote = [supervisors.length ? `Supervisors: ${supervisors.join(", ")}` : "All supervisors", contracts.length ? `Contracts: ${contracts.join(", ")}` : "All contracts"].join(" &nbsp;•&nbsp; ");
  const html = `<div style="max-width:900px;margin:0 auto;background:#fff;font-family:Arial,sans-serif;color:#243746"><div style="background:#123b61;color:#fff;padding:24px 28px"><div style="font-size:12px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:#d7e2ec">Davenport Transportation</div><h2 style="margin:7px 0 5px;color:#fff">USPS Completion Report</h2><div>${displayDate(start)} - ${displayDate(end)}</div></div><div style="padding:24px 28px"><p style="margin:0 0 18px;color:#5b6b79;font-size:13px">${filterNote}</p><div style="display:inline-block;background:#eef2f5;border-left:5px solid #123b61;padding:12px 18px"><span style="font-size:13px;color:#5b6b79">Total Overall</span><br><strong style="font-size:26px;color:#123b61">${percent(data.totals.completion_percent)}</strong></div><h3 style="margin:24px 0 8px;color:#123b61">Supervisor Performance</h3><table style="width:100%;border-collapse:collapse"><thead><tr><th style="${header}">Supervisor</th><th style="${header}">Total Stops</th><th style="${header}">Missed Stops</th><th style="${header}">% Complete</th></tr></thead><tbody>${supervisorRows}</tbody></table><h2 style="margin:30px 0 8px;color:#123b61">Supervisors and Their Contracts</h2>${supervisorDetail}<h3 style="margin:30px 0 8px;color:#123b61;break-before:page">All Contract Performance</h3><table style="width:100%;border-collapse:collapse"><thead><tr><th style="${header}">Contract</th><th style="${header}">Total Stops</th><th style="${header}">Completed</th><th style="${header}">Missed Stops</th><th style="${header}">% Complete</th></tr></thead><tbody>${contractRows}</tbody></table><p style="margin-top:22px;color:#6b7c8c;font-size:12px">Prepared in DT Intelligence Hub</p></div></div>`;
  const text = [`USPS Completion Report: ${displayDate(start)} - ${displayDate(end)}`, supervisors.length ? `Supervisors: ${supervisors.join(", ")}` : "All supervisors", contracts.length ? `Contracts: ${contracts.join(", ")}` : "All contracts", `Overall Completion: ${percent(data.totals.completion_percent)}`, "", "Supervisor\tTotal Stops\tIncomplete\t% Complete", ...data.supervisors.map((row) => `${row.supervisor}\t${row.total_stops}\t${row.incomplete_stops}\t${percent(row.completion_percent)}`), "", "Contract\tTotal Stops\tCompleted\tIncomplete\t% Complete", ...data.contracts.map((row) => `${row.contract_number}\t${row.total_stops}\t${row.completed_stops}\t${row.incomplete_stops}\t${percent(row.completion_percent)}`)].join("\n");
  return { html, text };
}

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
  const [maxCompletion, setMaxCompletion] = useState("");
  const [minMissedStops, setMinMissedStops] = useState("");
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [missedReportCount, setMissedReportCount] = useState(0);
  const [data, setData] = useState<HubData>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { void (async () => {
    const [latest, contracts, supervisors] = await Promise.all([
      supabase.from("report_history").select("period_start,period_end").eq("report_type","usps_loads").order("period_end",{ascending:false}).limit(1).maybeSingle(),
      supabase.rpc("contract_options"), supabase.rpc("supervisor_options"),
    ]);
    if (latest.data) { setStart(latest.data.period_start); setEnd(latest.data.period_end); }
    setContractOptions((contracts.data ?? []).map((row: { contract_number: string }) => row.contract_number));
    setSupervisorOptions(["Unassigned", ...(supervisors.data ?? []).map((row: { supervisor: string }) => row.supervisor).filter((name: string) => name && name !== "Unassigned")]);
  })(); }, []);

  useEffect(() => { void (async () => {
    setLoading(true); setError("");
    const result = await supabase.rpc("dashboard_hub_filtered", {
      p_start: start, p_end: end, p_grain: grain,
      p_contracts: selectedContracts.length ? selectedContracts : null,
      p_supervisors: selectedSupervisors.length ? selectedSupervisors : null,
      p_exclude_august_2026: excludeAugust,
      p_max_completion: maxCompletion === "" ? null : Number(maxCompletion) / 100,
      p_min_missed_stops: minMissedStops === "" ? null : Number(minMissedStops),
    });
    if (result.error) { setError(result.error.message); setData(empty); }
    else setData((result.data ?? empty) as HubData);
    setLoading(false);
  })(); }, [start, end, grain, selectedContracts, selectedSupervisors, excludeAugust, maxCompletion, minMissedStops]);

  useEffect(() => { void (async () => {
    const result = await supabase.from("report_history").select("data,period_start,period_end")
      .eq("report_type", "missed_stops").lte("period_start", end).gte("period_end", start);
    if (result.error) return;
    const grouped = new Map<string, number>();
    (result.data ?? []).forEach((record) => {
      const rows = ((record.data as { byLocation?: LocationRow[] })?.byLocation ?? []);
      rows.forEach((row) => grouped.set(row.key, (grouped.get(row.key) ?? 0) + Number(row.occurrences || 0)));
    });
    setMissedReportCount(result.data?.length ?? 0);
    setLocations(Array.from(grouped, ([key, occurrences]) => ({ key, occurrences })).sort((a,b) => b.occurrences-a.occurrences).slice(0,25));
  })(); }, [start, end]);

  const maxIncomplete = useMemo(() => Math.max(1, ...data.trend.map((row) => Number(row.incomplete_stops))), [data.trend]);
  const bottomContractNames = useMemo(() => new Set(data.contracts.slice(0, 10).map((row) => row.contract_number)), [data.contracts]);

  async function copyEmail() {
    const email = filteredEmail(data, start, end, selectedSupervisors, selectedContracts);
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([email.text], { type: "text/plain" }), "text/html": new Blob([email.html], { type: "text/html" }) })]);
    } else await navigator.clipboard.writeText(email.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function printGaryReport() {
    const report = filteredEmail(data, start, end, selectedSupervisors, selectedContracts);
    const printWindow = window.open("", "_blank");
    if (!printWindow) { setError("Allow pop-ups for DT Intelligence Hub to print the report."); return; }
    printWindow.document.write(`<!doctype html><html><head><title>Gary Report ${start} to ${end}</title><style>@page{size:portrait;margin:.4in}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{margin:0;background:white}table{font-size:9px}th,td{padding:5px 6px!important}h2,h3{break-after:avoid}thead{display:table-header-group}section{break-inside:avoid;page-break-inside:avoid}</style></head><body>${report.html}<script>window.onload=()=>{window.print()}<\/script></body></html>`);
    printWindow.document.close();
  }
  return <div className="report-stack">
    <section className="panel hub-filters">
      <label>Start date<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label>End date<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      <label>View by<select value={grain} onChange={(event) => setGrain(event.target.value)}><option value="day">Day</option><option value="week">Week (Sat–Fri)</option><option value="month">Month</option><option value="year">Year</option></select></label>
      <MultiSelect label="Supervisors" options={supervisorOptions} selected={selectedSupervisors} setSelected={setSelectedSupervisors} />
      <MultiSelect label="Contracts" options={contractOptions} selected={selectedContracts} setSelected={setSelectedContracts} />
      <label>Contract completion at or below (%)<input type="number" min="0" max="100" step="0.01" value={maxCompletion} onChange={(event) => setMaxCompletion(event.target.value)} placeholder="Example: 95" /></label>
      <label>Contract missed stops at least<input type="number" min="0" step="1" value={minMissedStops} onChange={(event) => setMinMissedStops(event.target.value)} placeholder="Example: 25" /></label>
      <label className="filter-checkbox"><input type="checkbox" checked={excludeAugust} onChange={(event) => setExcludeAugust(event.target.checked)} />Exclude Aug 13–20</label>
      {(selectedContracts.length > 0 || selectedSupervisors.length > 0 || maxCompletion || minMissedStops) && <button className="clear-filters" onClick={() => { setSelectedContracts([]); setSelectedSupervisors([]); setMaxCompletion(""); setMinMissedStops(""); }}>Clear selections</button>}
    </section>
    <PeriodAnnotations start={start} end={end} />
    {error && <div className="alert alert-error">{error.includes("dashboard_hub_filtered") ? "The dashboard database update still needs to be installed in Supabase." : error}</div>}
    {loading ? <section className="hub-loading">Loading your operations picture…</section> : <>
      <section className="dashboard-email-bar"><div><strong>Gary’s supervisor and contract report</strong><span>{displayDate(start)} – {displayDate(end)}{selectedSupervisors.length || selectedContracts.length ? " with selected filters" : " · Company-wide"}</span></div><div className="dashboard-report-buttons"><button className="hub-secondary-link" onClick={printGaryReport}>Print Gary’s Report</button><button className="primary-link" onClick={copyEmail}>{copied ? "Email report copied!" : "Copy email report"}</button></div></section>
      <section className="metric-grid">
        <article className="metric-card metric-primary"><span>Completion</span><strong>{percent(data.totals.completion_percent)}</strong></article>
        <article className="metric-card"><span>Unique loads</span><strong>{number(data.totals.load_count)}</strong></article>
        <article className="metric-card"><span>Total stops</span><strong>{number(data.totals.total_stops)}</strong></article>
        <article className="metric-card"><span>Incomplete stops</span><strong>{number(data.totals.incomplete_stops)}</strong></article>
      </section>
      {selectedSupervisors.length > 0 && <section className="supervisor-focus-stack">
        {selectedSupervisors.map((name) => {
          const supervisor = data.supervisors.find((row) => row.supervisor === name);
          const contracts = data.supervisor_contracts.filter((row) => row.supervisor === name).sort((a,b) => Number(b.incomplete_stops)-Number(a.incomplete_stops));
          return <section className="panel supervisor-focus" key={name}>
            <div className="supervisor-focus-heading"><div><p className="eyebrow">Supervisor focus</p><h2>{name}</h2><span>{supervisor ? `${number(supervisor.total_stops)} total stops · ${number(supervisor.incomplete_stops)} missed · ${percent(supervisor.completion_percent)}` : "No loads in this period"}</span></div><div><button className="hub-secondary-link" onClick={() => setGrain("day")}>Show daily results</button><button className="clear-filters" onClick={() => setSelectedSupervisors(selectedSupervisors.filter((value) => value !== name))}>Close</button></div></div>
            <div className="panel-heading"><h2>Contracts with the most missed stops</h2><span>Click a contract to focus the entire Dashboard</span></div>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>Total Stops</th><th>Completed</th><th>Missed Stops</th><th>Completion</th></tr></thead><tbody>{contracts.map((row) => <tr key={row.contract_number} className={bottomContractNames.has(row.contract_number) ? "bottom-contract-row" : ""}><td><button className="day-button" onClick={() => setSelectedContracts([row.contract_number])}>{row.contract_number}</button></td><td>{number(row.total_stops)}</td><td>{number(row.completed_stops)}</td><td>{number(row.incomplete_stops)}</td><td>{percent(row.completion_percent)}</td></tr>)}</tbody></table></div>
          </section>;
        })}
      </section>}
      <section className="hub-grid">
        <section className="panel hub-trend"><div className="panel-heading"><h2>Performance trend</h2><span>{data.trend.length} periods</span></div><div className="trend-list">{data.trend.map((row) => <div className="trend-row" key={row.period_start}><div><strong>{row.period_start}</strong><span>{percent(row.completion_percent)}</span></div><div className="trend-track"><i style={{width:`${Math.max(2, Number(row.incomplete_stops) / maxIncomplete * 100)}%`}} /></div><small>{number(row.incomplete_stops)} incomplete</small></div>)}</div></section>
        <section className="panel attention-panel"><div className="panel-heading"><h2>Needs attention</h2><span>Lowest contracts</span></div><div className="attention-list">{data.contracts.slice(0,10).map((row,index) => <Link href={`/contracts/${encodeURIComponent(row.contract_number || "Unmapped")}`} key={row.contract_number}><span>{index+1}</span><strong>{row.contract_number}</strong><em>{percent(row.completion_percent)}</em><small>{number(row.incomplete_stops)} incomplete</small></Link>)}</div></section>
      </section>
      <section className="hub-grid">
        <HubTable title="Supervisors" rows={data.supervisors} kind="supervisor" onSupervisorSelect={(name) => setSelectedSupervisors([name])} />
        <HubTable title="Contracts" rows={data.contracts} kind="contract" />
      </section>
      <section className="panel overflow-hidden"><div className="panel-heading"><h2>Sunday missed-stop locations</h2><span>{missedReportCount ? `${missedReportCount} overlapping report${missedReportCount === 1 ? "" : "s"}` : "No Sunday report for these dates"}</span></div>{locations.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Location</th><th>Occurrences</th></tr></thead><tbody>{locations.map((row) => <tr key={row.key}><td className="font-semibold text-navy">{row.key}</td><td>{number(row.occurrences)}</td></tr>)}</tbody></table></div> : <div className="location-empty">Upload the Sunday missed-stops report to add location details for this period.</div>}</section>
    </>}
  </div>;
}

function MultiSelect({ label, options, selected, setSelected }: { label: string; options: string[]; selected: string[]; setSelected: (values: string[]) => void }) {
  return <div className="multi-filter"><span>{label}</span><details><summary>{selected.length ? `${selected.length} selected` : `All ${label.toLowerCase()}`}</summary><div className="multi-menu"><button type="button" onClick={() => setSelected(selected.length === options.length ? [] : options)}>{selected.length === options.length ? "Clear all" : "Select all"}</button>{options.map((option) => <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={() => setSelected(selected.includes(option) ? selected.filter((value) => value !== option) : [...selected, option])} />{option}</label>)}</div></details></div>;
}

function HubTable({ title, rows, kind, onSupervisorSelect }: { title: string; rows: Row[]; kind: "contract" | "supervisor"; onSupervisorSelect?: (name: string) => void }) {
  return <section className="panel overflow-hidden"><div className="panel-heading"><h2>{title}</h2><span>{kind === "supervisor" ? "Click a name to filter" : `${rows.length} results`}</span></div><div className="table-scroll hub-table-scroll"><table className="data-table"><thead><tr><th>{title.slice(0,-1)}</th><th>Stops</th><th>Incomplete</th><th>Completion</th></tr></thead><tbody>{rows.map((row,index) => { const name = kind === "contract" ? row.contract_number : row.supervisor; return <tr key={name} className={name === "Unassigned" ? "attention-row" : kind === "supervisor" && index < 5 ? "top-performer-row" : kind === "contract" && index < 10 ? "bottom-contract-row" : ""}><td className="font-semibold text-navy">{kind === "contract" ? <Link className="day-button" href={`/contracts/${encodeURIComponent(name || "Unmapped")}`}>{name}</Link> : <button className="day-button" onClick={() => name && onSupervisorSelect?.(name)}>{name}</button>}</td><td>{number(row.total_stops)}</td><td>{number(row.incomplete_stops)}</td><td>{percent(row.completion_percent)}</td></tr>; })}</tbody></table></div></section>;
}
