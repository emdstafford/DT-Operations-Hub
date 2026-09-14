"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PeriodAnnotations from "@/components/PeriodAnnotations";
import { supabase } from "@/lib/supabase";

type Row = { period_start?: string; contract_number?: string; supervisor?: string; load_count: number; total_stops: number; completed_stops: number; incomplete_stops: number; completion_percent: number };
type SupervisorContractRow = Row & { supervisor: string; contract_number: string };
type HubData = { totals: Row; trend: Row[]; contracts: Row[]; supervisors: Row[]; supervisor_contracts: SupervisorContractRow[] };
type LocationRow = { key: string; occurrences: number };\ntype MissedContractRow = { key: string; loads: number; missingStops: number };\ntype MissedStoredRow = { loadNumber?: string; operatingDate?: string; contract?: string; missingStops?: number; missingLocations?: string };\ntype MissedHistoryData = { rows?: MissedStoredRow[]; byLocation?: LocationRow[]; byContract?: MissedContractRow[]; totalMissingStops?: number };
type LoadDrillRow = { load_number: string; operating_date: string; contract_number: string | null; trip_number: string | null; supervisors: string[]; total_stops: number; completed_stops: number; incomplete_stops: number };
type TripDrillRow = { operatingDate: string; contract: string; trip: string; loads: number; loadNumbers: string[]; totalStops: number; completedStops: number; incompleteStops: number };
const empty: HubData = { totals: { load_count: 0, total_stops: 0, completed_stops: 0, incomplete_stops: 0, completion_percent: 0 }, trend: [], contracts: [], supervisors: [], supervisor_contracts: [] };
const number = (value: number) => Number(value || 0).toLocaleString("en-US");
const percent = (value: number) => `${(Number(value || 0) * 100).toFixed(2)}%`;
const displayDate = (value: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);

function filteredEmail(data: HubData, start: string, end: string, supervisors: string[], contracts: string[], showCompanyRankings: boolean, includeSupervisorDetail = false, includeCongratulations = true) {
  const header = "background:#123b61;color:#fff;padding:8px;border:1px solid #d6dde3;text-align:left";
  const cell = "padding:7px 9px;border:1px solid #d6dde3;text-align:right";
  const nameCell = `${cell};text-align:left;font-weight:600`;
  const bottomContracts = new Set(showCompanyRankings ? data.contracts.slice(0, 10).map((row) => row.contract_number || "Unmapped") : []);
  const supervisorRows = data.supervisors.map((row, index) => `<tr style="${showCompanyRankings && index < 5 ? "background:#c9e7cf;color:#174e27" : ""}"><td style="${nameCell}">${escapeHtml(row.supervisor || "Unassigned")}</td><td style="${cell}">${number(row.total_stops)}</td><td style="${cell}">${number(row.incomplete_stops)}</td><td style="${cell}">${percent(row.completion_percent)}</td></tr>`).join("");
  const contractRows = data.contracts.map((row, index) => `<tr style="${showCompanyRankings && index < 10 ? "background:#f0c8cd;color:#742430" : ""}"><td style="${nameCell}">${escapeHtml(row.contract_number || "Unmapped")}</td><td style="${cell}">${number(row.total_stops)}</td><td style="${cell}">${number(row.completed_stops)}</td><td style="${cell}">${number(row.incomplete_stops)}</td><td style="${cell}">${percent(row.completion_percent)}</td></tr>`).join("");
  const highestSupervisor = data.supervisors.find((row) => row.supervisor && row.supervisor !== "Unassigned");
  const congratulations = includeCongratulations && highestSupervisor ? `Congratulations to ${highestSupervisor.supervisor} for the highest percentage for this reporting period!` : "";
  const supervisorDetail = data.supervisors.map((supervisor, supervisorIndex) => {
    const rows = data.supervisor_contracts.filter((row) => row.supervisor === supervisor.supervisor).map((row) => `<tr style="${bottomContracts.has(row.contract_number) ? "background:#f0c8cd;color:#742430" : ""}"><td style="${nameCell}">${escapeHtml(row.contract_number)}</td><td style="${cell}">${number(row.total_stops)}</td><td style="${cell}">${number(row.completed_stops)}</td><td style="${cell}">${number(row.incomplete_stops)}</td><td style="${cell}">${percent(row.completion_percent)}</td></tr>`).join("");
    return `<section style="break-inside:avoid;page-break-inside:avoid;margin-top:22px"><h3 style="margin:0;padding:10px 12px;color:${showCompanyRankings && supervisorIndex < 5 ? "#174e27" : "#123b61"};background:${showCompanyRankings && supervisorIndex < 5 ? "#c9e7cf" : "#eef2f5"};border:1px solid #d6dde3">${escapeHtml(supervisor.supervisor || "Unassigned")} — ${percent(supervisor.completion_percent)}</h3><table style="width:100%;border-collapse:collapse"><thead><tr><th style="${header}">Contract</th><th style="${header}">Total Stops</th><th style="${header}">Completed</th><th style="${header}">Missed Stops</th><th style="${header}">% Complete</th></tr></thead><tbody>${rows}<tr style="font-weight:bold;background:#eef2f5"><td style="${nameCell}">Supervisor Total</td><td style="${cell}">${number(supervisor.total_stops)}</td><td style="${cell}">${number(supervisor.completed_stops)}</td><td style="${cell}">${number(supervisor.incomplete_stops)}</td><td style="${cell}">${percent(supervisor.completion_percent)}</td></tr></tbody></table></section>`;
  }).join("");
  const filterNote = [supervisors.length ? `Supervisors: ${supervisors.join(", ")}` : "All supervisors", contracts.length ? `Contracts: ${contracts.join(", ")}` : "All contracts"].join(" &nbsp;•&nbsp; ");
  const detailSection = includeSupervisorDetail ? `<h2 style="margin:30px 0 8px;color:#123b61">Supervisors and Their Contracts</h2>${supervisorDetail}` : "";
  const html = `<div style="max-width:900px;margin:0 auto;background:#fff;font-family:Arial,sans-serif;color:#243746"><div style="background:#123b61;color:#fff;padding:24px 28px"><div style="font-size:12px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:#d7e2ec">Davenport Transportation</div><h2 style="margin:7px 0 5px;color:#fff">USPS Completion Report</h2><div>${displayDate(start)} - ${displayDate(end)}</div></div><div style="padding:24px 28px">${congratulations ? `<p style="margin:0 0 18px;color:#123b61;font-size:16px"><strong>${escapeHtml(congratulations)}</strong></p>` : ""}<p style="margin:0 0 18px;color:#5b6b79;font-size:13px">${filterNote}</p><div style="display:inline-block;background:#eef2f5;border-left:5px solid #123b61;padding:12px 18px"><span style="font-size:13px;color:#5b6b79">Total Overall</span><br><strong style="font-size:26px;color:#123b61">${percent(data.totals.completion_percent)}</strong></div><h3 style="margin:24px 0 8px;color:#123b61">Supervisor Performance</h3><table style="width:100%;border-collapse:collapse"><thead><tr><th style="${header}">Supervisor</th><th style="${header}">Total Stops</th><th style="${header}">Missed Stops</th><th style="${header}">% Complete</th></tr></thead><tbody>${supervisorRows}</tbody></table>${detailSection}<h3 style="margin:30px 0 8px;color:#123b61;${includeSupervisorDetail ? "break-before:page" : ""}">All Contract Performance</h3><table style="width:100%;border-collapse:collapse"><thead><tr><th style="${header}">Contract</th><th style="${header}">Total Stops</th><th style="${header}">Completed</th><th style="${header}">Missed Stops</th><th style="${header}">% Complete</th></tr></thead><tbody>${contractRows}</tbody></table><p style="margin-top:22px;color:#6b7c8c;font-size:12px">Prepared in DT Intelligence Hub</p></div></div>`;
  const text = [`USPS Completion Report: ${displayDate(start)} - ${displayDate(end)}`, congratulations, "", supervisors.length ? `Supervisors: ${supervisors.join(", ")}` : "All supervisors", contracts.length ? `Contracts: ${contracts.join(", ")}` : "All contracts", `Overall Completion: ${percent(data.totals.completion_percent)}`, "", "Supervisor\tTotal Stops\tIncomplete\t% Complete", ...data.supervisors.map((row) => `${row.supervisor}\t${row.total_stops}\t${row.incomplete_stops}\t${percent(row.completion_percent)}`), "", "Contract\tTotal Stops\tCompleted\tIncomplete\t% Complete", ...data.contracts.map((row) => `${row.contract_number}\t${row.total_stops}\t${row.completed_stops}\t${row.incomplete_stops}\t${percent(row.completion_percent)}`)].filter((line, index, values) => line || values[index - 1]).join("\n");
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
  const [missedReportCount, setMissedReportCount] = useState(0);\n  const [missedContracts, setMissedContracts] = useState<MissedContractRow[]>([]);\n  const [latestAvailableEnd, setLatestAvailableEnd] = useState(today);\n  const [rangeMode, setRangeMode] = useState<"day" | "week" | "month" | "custom">("week");
  const [data, setData] = useState<HubData>(empty);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [selectedDay, setSelectedDay] = useState("");
  const [tripBreakdown, setTripBreakdown] = useState<TripDrillRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);

  useEffect(() => { void (async () => {
    const [latest, contracts, supervisors] = await Promise.all([
      supabase.from("report_history").select("period_start,period_end").eq("report_type","usps_loads").order("period_end",{ascending:false}).limit(1).maybeSingle(),
      supabase.rpc("contract_options"), supabase.rpc("supervisor_options"),
    ]);
    if (latest.data) { setStart(latest.data.period_start); setEnd(latest.data.period_end); setLatestAvailableEnd(latest.data.period_end); }
    setContractOptions((contracts.data ?? []).map((row: { contract_number: string }) => row.contract_number));
    setSupervisorOptions(["Unassigned", ...(supervisors.data ?? []).map((row: { supervisor: string }) => row.supervisor).filter((name: string) => name && name !== "Unassigned")]);
    setInitialized(true);
  })(); }, []);

  useEffect(() => {
    if (!initialized) return;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    void (async () => {
      setLoading(true); setError("");
      try {
        const result = await supabase.rpc("dashboard_hub_filtered", {
          p_start: start, p_end: end, p_grain: grain,
          p_contracts: selectedContracts.length ? selectedContracts : null,
          p_supervisors: selectedSupervisors.length ? selectedSupervisors : null,
          p_exclude_august_2026: excludeAugust,
          p_max_completion: maxCompletion === "" ? null : Number(maxCompletion) / 100,
          p_min_missed_stops: minMissedStops === "" ? null : Number(minMissedStops),
        }).abortSignal(controller.signal);
        if (!active) return;
        if (result.error) { setError(result.error.message); setData(empty); }
        else setData((result.data ?? empty) as HubData);
      } catch {
        if (active) { setError("The Dashboard took too long to load. Try a shorter date range."); setData(empty); }
      } finally {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [initialized, start, end, grain, selectedContracts, selectedSupervisors, excludeAugust, maxCompletion, minMissedStops]);

  useEffect(() => { void (async () => {
    const result = await supabase.from("report_history").select("data,period_start,period_end")
      .eq("report_type", "missed_stops").lte("period_start", end).gte("period_end", start);
    if (result.error) return;
    const locationGroups = new Map<string, number>();
    const contractGroups = new Map<string, { loads: number; missingStops: number }>();
    const visibleContracts = new Set(data.contracts.map((row) => row.contract_number || "Unmapped"));
    let matchingReports = 0;

    (result.data ?? []).forEach((record) => {
      const report = record.data as MissedHistoryData;
      const rows = report.rows ?? [];
      const datedRows = rows.filter((row) => {
        const date = String(row.operatingDate || "");
        const contract = String(row.contract || "Unmapped");
        const inDateRange = Boolean(date && date >= start && date <= end);
        const inDashboardView = visibleContracts.size === 0 || visibleContracts.has(contract);
        return inDateRange && inDashboardView;
      });
      if (datedRows.length) matchingReports += 1;
      datedRows.forEach((row) => {
        const contract = String(row.contract || "Unmapped");
        const group = contractGroups.get(contract) ?? { loads: 0, missingStops: 0 };
        group.loads += 1;
        group.missingStops += Number(row.missingStops || 0);
        contractGroups.set(contract, group);
        String(row.missingLocations || "").split(",").map((value) => value.trim()).filter(Boolean).forEach((location) => {
          locationGroups.set(location, (locationGroups.get(location) ?? 0) + 1);
        });
      });
    });

    setMissedReportCount(matchingReports);
    setLocations(Array.from(locationGroups, ([key, occurrences]) => ({ key, occurrences })).sort((a,b) => b.occurrences-a.occurrences).slice(0,25));
    setMissedContracts(Array.from(contractGroups, ([key, value]) => ({ key, ...value })).sort((a,b) => b.missingStops-a.missingStops).slice(0,25));
  })(); }, [start, end, data.contracts]);

  const maxIncomplete = useMemo(() => Math.max(1, ...data.trend.map((row) => Number(row.incomplete_stops))), [data.trend]);

  function chooseRange(mode: "day" | "week" | "month") {
    const anchor = new Date(`${latestAvailableEnd}T12:00:00Z`);
    let rangeStart = new Date(anchor);
    let rangeEnd = new Date(anchor);
    if (mode === "week") {
      rangeStart.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 1) % 7));
      rangeEnd = new Date(rangeStart);
      rangeEnd.setUTCDate(rangeStart.getUTCDate() + 6);
    } else if (mode === "month") {
      rangeStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12));
      rangeEnd = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0, 12));
    }
    setStart(rangeStart.toISOString().slice(0, 10));
    setEnd(rangeEnd.toISOString().slice(0, 10));
    setGrain(mode === "month" ? "week" : "day");
    setRangeMode(mode);
    setSelectedDay("");
  }
  const isEntireReport = selectedSupervisors.length === 0 && selectedContracts.length === 0 && maxCompletion === "" && minMissedStops === "";

  async function copyEmail() {
    const email = filteredEmail(data, start, end, selectedSupervisors, selectedContracts, isEntireReport);
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([email.text], { type: "text/plain" }), "text/html": new Blob([email.html], { type: "text/html" }) })]);
    } else await navigator.clipboard.writeText(email.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function printGaryReport() {
    const report = filteredEmail(data, start, end, selectedSupervisors, selectedContracts, isEntireReport, true, false);
    const printWindow = window.open("", "_blank");
    if (!printWindow) { setError("Allow pop-ups for DT Intelligence Hub to print the report."); return; }
    printWindow.document.write(`<!doctype html><html><head><title>Gary Report ${start} to ${end}</title><style>@page{size:portrait;margin:.4in}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{margin:0;background:white}table{font-size:9px}th,td{padding:5px 6px!important}h2,h3{break-after:avoid}thead{display:table-header-group}section{break-inside:avoid;page-break-inside:avoid}</style></head><body>${report.html}<script>window.onload=()=>{window.print()}<\/script></body></html>`);
    printWindow.document.close();
  }

  async function openDay(day: string) {
    if (grain !== "day") { setGrain("day"); return; }
    setSelectedDay(day); setDrillLoading(true); setDrillError(""); setTripBreakdown([]);
    const result = await supabase.from("usps_loads")
      .select("load_number,operating_date,contract_number,trip_number,supervisors,total_stops,completed_stops,incomplete_stops")
      .eq("operating_date", day).gt("incomplete_stops", 0).limit(5000);
    if (result.error) { setDrillError(result.error.message); setDrillLoading(false); return; }
    const visibleContracts = new Set(data.contracts.map((row) => row.contract_number || "Unmapped"));
    const rows = ((result.data ?? []) as LoadDrillRow[]).filter((row) => {
      const contract = row.contract_number || "Unmapped";
      const supervisorMatch = selectedSupervisors.length === 0 || selectedSupervisors.some((name) => name === "Unassigned" ? row.supervisors.length === 0 : row.supervisors.includes(name));
      return visibleContracts.has(contract) && supervisorMatch;
    });
    const groups = new Map<string, TripDrillRow>();
    rows.forEach((row) => {
      const contract = row.contract_number || "Unmapped";
      const trip = row.trip_number || "Unmapped";
      const key = `${row.operating_date}\u0000${contract}\u0000${trip}`;
      const group = groups.get(key) ?? { operatingDate: row.operating_date, contract, trip, loads: 0, loadNumbers: [], totalStops: 0, completedStops: 0, incompleteStops: 0 };
      group.loads += 1; group.loadNumbers.push(row.load_number); group.totalStops += Number(row.total_stops || 0); group.completedStops += Number(row.completed_stops || 0); group.incompleteStops += Number(row.incomplete_stops || 0);
      groups.set(key, group);
    });
    setTripBreakdown([...groups.values()].sort((a, b) => b.incompleteStops - a.incompleteStops || a.contract.localeCompare(b.contract) || a.trip.localeCompare(b.trip, undefined, { numeric: true })));
    setDrillLoading(false);
  }

  async function printPerformanceReview() {
    setReviewLoading(true); setError("");
    try {
      const allRows: LoadDrillRow[] = [];
      for (let from = 0; ; from += 1000) {
        const result = await supabase.from("usps_loads")
          .select("load_number,operating_date,contract_number,trip_number,supervisors,total_stops,completed_stops,incomplete_stops")
          .gte("operating_date", start).lte("operating_date", end).gt("incomplete_stops", 0)
          .order("operating_date").range(from, from + 999);
        if (result.error) throw result.error;
        allRows.push(...((result.data ?? []) as LoadDrillRow[]));
        if ((result.data?.length ?? 0) < 1000) break;
      }
      const visibleContracts = new Set(data.contracts.map((row) => row.contract_number || "Unmapped"));
      const rows = allRows.filter((row) => {
        const supervisorMatch = selectedSupervisors.length === 0 || selectedSupervisors.some((name) => name === "Unassigned" ? row.supervisors.length === 0 : row.supervisors.includes(name));
        return visibleContracts.has(row.contract_number || "Unmapped") && supervisorMatch;
      });
      const groups = new Map<string, TripDrillRow>();
      rows.forEach((row) => {
        const contract = row.contract_number || "Unmapped"; const trip = row.trip_number || "Unmapped"; const key = `${row.operating_date}\u0000${contract}\u0000${trip}`;
        const group = groups.get(key) ?? { operatingDate: row.operating_date, contract, trip, loads: 0, loadNumbers: [], totalStops: 0, completedStops: 0, incompleteStops: 0 };
        group.loads += 1; group.loadNumbers.push(row.load_number); group.totalStops += Number(row.total_stops || 0); group.completedStops += Number(row.completed_stops || 0); group.incompleteStops += Number(row.incomplete_stops || 0); groups.set(key, group);
      });
      const trips = [...groups.values()].sort((a,b) => a.operatingDate.localeCompare(b.operatingDate) || b.incompleteStops-a.incompleteStops || a.contract.localeCompare(b.contract));
      const [missedHistory, annotations] = await Promise.all([
        supabase.from("report_history").select("data").eq("report_type","missed_stops").lte("period_start",end).gte("period_end",start),
        supabase.from("report_annotations").select("title,note,period_start,period_end").lte("period_start",end).gte("period_end",start).order("period_start"),
      ]);
      const sundayMissing = (missedHistory.data ?? []).reduce((sum, item) => sum + Number((item.data as { totalMissingStops?: number })?.totalMissingStops || 0), 0);
      const header = "background:#123b61;color:#fff;padding:7px;border:1px solid #d6dde3;text-align:left";
      const cell = "padding:6px 7px;border:1px solid #d6dde3;text-align:right";
      const nameCell = `${cell};text-align:left`;
      const context = [selectedSupervisors.length ? `Supervisor: ${selectedSupervisors.join(", ")}` : "All supervisors", selectedContracts.length ? `Contract: ${selectedContracts.join(", ")}` : "All contracts"].join(" · ");
      const contractRows = data.contracts.map((row) => `<tr><td style="${nameCell}">${escapeHtml(row.contract_number || "Unmapped")}</td><td style="${cell}">${number(row.total_stops)}</td><td style="${cell}">${number(row.incomplete_stops)}</td><td style="${cell}">${percent(row.completion_percent)}</td></tr>`).join("");
      const tripRows = trips.map((row) => `<tr><td style="${nameCell}">${escapeHtml(row.operatingDate)}</td><td style="${nameCell}">${escapeHtml(row.contract)}</td><td style="${nameCell}">${escapeHtml(row.trip)}</td><td style="${cell}">${number(row.loads)}</td><td style="${cell}">${number(row.incompleteStops)}</td><td style="${nameCell};font-size:9px">${escapeHtml(row.loadNumbers.join(", "))}</td></tr>`).join("");
      const locationRows = locations.map((row) => `<tr><td style="${nameCell}">${escapeHtml(row.key)}</td><td style="${cell}">${number(row.occurrences)}</td></tr>`).join("");
      const noteRows = (annotations.data ?? []).map((row) => `<div style="margin:8px 0;padding:9px 11px;background:#eef2f5;border-left:4px solid #123b61"><strong>${escapeHtml(row.title)}</strong> (${row.period_start}–${row.period_end})<br><span>${escapeHtml(row.note)}</span></div>`).join("");
      const worstTrip = [...trips].sort((a,b) => b.incompleteStops-a.incompleteStops)[0]; const worstContract = data.contracts[0];
      const verified = [worstContract ? `${worstContract.contract_number || "Unmapped"} had the lowest completion at ${percent(worstContract.completion_percent)} with ${number(worstContract.incomplete_stops)} incomplete stops.` : "", worstTrip ? `${worstTrip.contract} trip ${worstTrip.trip} had the most incomplete stops (${number(worstTrip.incompleteStops)}).` : ""].filter(Boolean);
      const html = `<div style="font-family:Arial,sans-serif;color:#243746"><header style="background:#123b61;color:white;padding:20px 24px"><small style="letter-spacing:1px">DT INTELLIGENCE HUB</small><h1 style="margin:5px 0">Performance Review Report</h1><div>${displayDate(start)} – ${displayDate(end)}</div></header><main style="padding:18px 24px"><p><strong>${escapeHtml(context)}</strong></p><div style="display:flex;gap:10px;flex-wrap:wrap"><div style="background:#eef2f5;padding:10px 14px"><small>COMPLETION</small><br><strong style="font-size:22px">${percent(data.totals.completion_percent)}</strong></div><div style="background:#eef2f5;padding:10px 14px"><small>TQ INCOMPLETE</small><br><strong style="font-size:22px">${number(data.totals.incomplete_stops)}</strong></div><div style="background:#eef2f5;padding:10px 14px"><small>SUNDAY GEOFENCE-MISSED</small><br><strong style="font-size:22px">${number(sundayMissing)}</strong></div></div><h2>What the data confirms</h2><ul>${verified.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}<li>TQ incomplete stops and Sunday geofence-missed stops are separate measures and may not match.</li></ul>${noteRows ? `<h2>Saved operational context</h2>${noteRows}` : ""}<h2>Contract performance</h2><table style="width:100%;border-collapse:collapse"><thead><tr><th style="${header}">Contract</th><th style="${header}">Stops</th><th style="${header}">Incomplete</th><th style="${header}">Completion</th></tr></thead><tbody>${contractRows}</tbody></table><h2 style="break-before:page">Incomplete stops by trip</h2><table style="width:100%;border-collapse:collapse"><thead><tr><th style="${header}">Operating Date</th><th style="${header}">Contract</th><th style="${header}">Trip</th><th style="${header}">Loads</th><th style="${header}">Incomplete</th><th style="${header}">Load Numbers</th></tr></thead><tbody>${tripRows}</tbody></table>${locationRows ? `<h2>Missed Geofence Locations</h2><table style="width:100%;border-collapse:collapse"><thead><tr><th style="${header}">Location</th><th style="${header}">Occurrences</th></tr></thead><tbody>${locationRows}</tbody></table>` : ""}<p style="color:#677887;font-size:10px">Facts are drawn from saved TQ and Sunday geofence reports. A cause is shown only when documented in an operational note.</p></main></div>`;
      const printWindow = window.open("", "_blank");
      if (!printWindow) throw new Error("Allow pop-ups for DT Intelligence Hub to print the report.");
      printWindow.document.write(`<!doctype html><html><head><title>Performance Review ${start} to ${end}</title><style>@page{size:portrait;margin:.4in}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{margin:0}h2{color:#123b61;break-after:avoid}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body>${html}<script>window.onload=()=>window.print()<\/script></body></html>`);
      printWindow.document.close();
    } catch (error) { setError(error instanceof Error ? error.message : "The Performance Review Report could not be created."); }
    finally { setReviewLoading(false); }
  }
  return <div className="report-stack">
    <section className="panel executive-period">
      <div className="quick-period-heading"><div><p className="eyebrow">Reporting period</p><h2>{displayDate(start)} – {displayDate(end)}</h2></div><span>Latest saved data through {displayDate(latestAvailableEnd)}</span></div>
      <div className="quick-period-controls">
        <div className="period-buttons" role="group" aria-label="Quick reporting period">
          <button className={rangeMode === "day" ? "active" : ""} onClick={() => chooseRange("day")}>Latest day</button>
          <button className={rangeMode === "week" ? "active" : ""} onClick={() => chooseRange("week")}>Latest week</button>
          <button className={rangeMode === "month" ? "active" : ""} onClick={() => chooseRange("month")}>Latest month</button>
        </div>
        <div className="executive-date-fields">
          <label>From<input type="date" value={start} onChange={(event) => { setStart(event.target.value); setRangeMode("custom"); }} /></label>
          <label>To<input type="date" value={end} onChange={(event) => { setEnd(event.target.value); setRangeMode("custom"); }} /></label>
        </div>
      </div>
      <details className="advanced-dashboard-filters">
        <summary>Filter by supervisor, contract, or performance</summary>
        <div className="hub-filters-clean">
          <label>Trend view<select value={grain} onChange={(event) => setGrain(event.target.value)}><option value="day">Day</option><option value="week">Week (Sat–Fri)</option><option value="month">Month</option><option value="year">Year</option></select></label>
          <MultiSelect label="Supervisors" options={supervisorOptions} selected={selectedSupervisors} setSelected={setSelectedSupervisors} />
          <MultiSelect label="Contracts" options={contractOptions} selected={selectedContracts} setSelected={setSelectedContracts} />
          <label>Completion at or below (%)<input type="number" min="0" max="100" step="0.01" value={maxCompletion} onChange={(event) => setMaxCompletion(event.target.value)} placeholder="Example: 95" /></label>
          <label>Missed stops at least<input type="number" min="0" step="1" value={minMissedStops} onChange={(event) => setMinMissedStops(event.target.value)} placeholder="Example: 25" /></label>
          <label className="filter-checkbox"><input type="checkbox" checked={excludeAugust} onChange={(event) => setExcludeAugust(event.target.checked)} />Exclude Aug 13–20, 2026</label>
          {(selectedContracts.length > 0 || selectedSupervisors.length > 0 || maxCompletion || minMissedStops) && <button className="clear-filters" onClick={() => { setSelectedContracts([]); setSelectedSupervisors([]); setMaxCompletion(""); setMinMissedStops(""); }}>Clear filters</button>}
        </div>
      </details>
    </section>
    <PeriodAnnotations start={start} end={end} />
    {error && <div className="alert alert-error">{error.includes("dashboard_hub_filtered") ? "The dashboard database update still needs to be installed in Supabase." : error}</div>}
    {loading ? <section className="hub-loading">Loading your operations picture…</section> : <>
      <section className="dashboard-email-bar"><div><strong>Reports for the selected view</strong><span>{displayDate(start)} – {displayDate(end)}{selectedSupervisors.length || selectedContracts.length ? " with selected filters" : " · Company-wide"}</span></div><div className="dashboard-report-buttons"><button className="hub-secondary-link" onClick={() => void printPerformanceReview()} disabled={reviewLoading}>{reviewLoading ? "Building review…" : "Print Performance Review"}</button><button className="hub-secondary-link" onClick={printGaryReport}>Print Gary’s Report</button><button className="primary-link" onClick={copyEmail}>{copied ? "Email report copied!" : "Copy email report"}</button></div></section>
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
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>Total Stops</th><th>Completed</th><th>Missed Stops</th><th>Completion</th></tr></thead><tbody>{contracts.map((row) => <tr key={row.contract_number}><td><button className="day-button" onClick={() => setSelectedContracts([row.contract_number])}>{row.contract_number}</button></td><td>{number(row.total_stops)}</td><td>{number(row.completed_stops)}</td><td>{number(row.incomplete_stops)}</td><td>{percent(row.completion_percent)}</td></tr>)}</tbody></table></div>
          </section>;
        })}
      </section>}
      <section className="hub-grid">
        <section className="panel hub-trend"><div className="panel-heading"><h2>Performance trend</h2><span>{grain === "day" ? "Click a day to see trips" : "Select Day view for trip drill-down"}</span></div><div className="trend-list">{data.trend.map((row) => <div className={`trend-row ${grain === "day" ? "trend-row-clickable" : ""}`} key={row.period_start}><div><button className="trend-day-button" onClick={() => void openDay(row.period_start || "")} disabled={!row.period_start}>{row.period_start}</button><span>{percent(row.completion_percent)}</span></div><div className="trend-track"><i style={{width:`${Math.max(2, Number(row.incomplete_stops) / maxIncomplete * 100)}%`}} /></div><button className="trend-missed-button" onClick={() => void openDay(row.period_start || "")} disabled={!row.period_start}>{number(row.incomplete_stops)} incomplete</button></div>)}</div></section>
        <section className="panel attention-panel"><div className="panel-heading"><h2>Needs attention</h2><span>Lowest contracts</span></div><div className="attention-list">{data.contracts.slice(0,10).map((row,index) => <Link href={`/contracts/${encodeURIComponent(row.contract_number || "Unmapped")}`} key={row.contract_number}><span>{index+1}</span><strong>{row.contract_number}</strong><em>{percent(row.completion_percent)}</em><small>{number(row.incomplete_stops)} incomplete</small></Link>)}</div></section>
      </section>
      {selectedDay && grain === "day" && <section className="panel day-drilldown">
        <div className="panel-heading"><div><p className="eyebrow">Daily missed-stop drill-down</p><h2>{displayDate(selectedDay)}</h2></div><button className="clear-filters" onClick={() => { setSelectedDay(""); setTripBreakdown([]); }}>Close</button></div>
        {drillError && <div className="alert alert-error">{drillError}</div>}
        {drillLoading ? <div className="hub-loading">Loading trips for this day…</div> : tripBreakdown.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>Trip</th><th>Affected Loads</th><th>Total Stops</th><th>Completed</th><th>Missed Stops</th><th>Load Numbers</th></tr></thead><tbody>{tripBreakdown.map((row) => <tr key={`${row.operatingDate}-${row.contract}-${row.trip}`}><td className="font-semibold text-navy">{row.contract}</td><td>{row.trip}</td><td>{number(row.loads)}</td><td>{number(row.totalStops)}</td><td>{number(row.completedStops)}</td><td><strong>{number(row.incompleteStops)}</strong></td><td><details><summary>View {row.loadNumbers.length}</summary><div className="load-number-list">{row.loadNumbers.join(", ")}</div></details></td></tr>)}</tbody><tfoot><tr><th colSpan={2}>Day total</th><th>{number(tripBreakdown.reduce((sum,row) => sum + row.loads,0))}</th><th>{number(tripBreakdown.reduce((sum,row) => sum + row.totalStops,0))}</th><th>{number(tripBreakdown.reduce((sum,row) => sum + row.completedStops,0))}</th><th>{number(tripBreakdown.reduce((sum,row) => sum + row.incompleteStops,0))}</th><th /></tr></tfoot></table></div> : !drillError && <div className="location-empty">No incomplete TQ stops match the current filters for this day.</div>}
        <p className="drill-note">These are official TQ incomplete-stop counts. Facility names come from the separate Sunday geofence report and may not match this total.</p>
      </section>}
      <section className="hub-grid">
        <section className="panel overflow-hidden"><div className="panel-heading"><h2>Missed stops by contract</h2><span>{displayDate(start)} – {displayDate(end)}</span></div>{missedContracts.length ? <div className="table-scroll hub-table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>Affected Loads</th><th>Missed Geofence Stops</th></tr></thead><tbody>{missedContracts.map((row) => <tr key={row.key}><td className="font-semibold text-navy">{row.key}</td><td>{number(row.loads)}</td><td>{number(row.missingStops)}</td></tr>)}</tbody></table></div> : <div className="location-empty">No Sunday missed-stop rows fall within the selected dates.</div>}</section>
        <section className="panel overflow-hidden"><div className="panel-heading"><h2>Missed geofence locations</h2><span>{missedReportCount ? `${missedReportCount} report${missedReportCount === 1 ? "" : "s"} with matching dates` : "No matching Sunday report rows"}</span></div>{locations.length ? <div className="table-scroll hub-table-scroll"><table className="data-table"><thead><tr><th>Location</th><th>Occurrences</th></tr></thead><tbody>{locations.map((row) => <tr key={row.key}><td className="font-semibold text-navy">{row.key}</td><td>{number(row.occurrences)}</td></tr>)}</tbody></table></div> : <div className="location-empty">Upload the Sunday missed-stops report to add location details for this period.</div>}</section>
      </section>
      <details className="dashboard-detail-tables panel">
        <summary>View all supervisors and contracts</summary>
        <div className="hub-grid">
          <HubTable title="Supervisors" rows={data.supervisors} kind="supervisor" highlightRankings={isEntireReport} onSupervisorSelect={(name) => setSelectedSupervisors([name])} />
          <HubTable title="Contracts" rows={data.contracts} kind="contract" highlightRankings={isEntireReport} />
        </div>
      </details>
    </>}
  </div>;
}

function MultiSelect({ label, options, selected, setSelected }: { label: string; options: string[]; selected: string[]; setSelected: (values: string[]) => void }) {
  return <div className="multi-filter"><span>{label}</span><details><summary>{selected.length ? `${selected.length} selected` : `All ${label.toLowerCase()}`}</summary><div className="multi-menu"><button type="button" onClick={() => setSelected(selected.length === options.length ? [] : options)}>{selected.length === options.length ? "Clear all" : "Select all"}</button>{options.map((option) => <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={() => setSelected(selected.includes(option) ? selected.filter((value) => value !== option) : [...selected, option])} />{option}</label>)}</div></details></div>;
}

function HubTable({ title, rows, kind, highlightRankings, onSupervisorSelect }: { title: string; rows: Row[]; kind: "contract" | "supervisor"; highlightRankings?: boolean; onSupervisorSelect?: (name: string) => void }) {
  return <section className="panel overflow-hidden"><div className="panel-heading"><h2>{title}</h2><span>{kind === "supervisor" ? "Click a name to filter" : `${rows.length} results`}</span></div><div className="table-scroll hub-table-scroll"><table className="data-table"><thead><tr><th>{title.slice(0,-1)}</th><th>Stops</th><th>Incomplete</th><th>Completion</th></tr></thead><tbody>{rows.map((row,index) => { const name = kind === "contract" ? row.contract_number : row.supervisor; return <tr key={name} className={name === "Unassigned" ? "attention-row" : highlightRankings && kind === "supervisor" && index < 5 ? "top-performer-row" : highlightRankings && kind === "contract" && index < 10 ? "bottom-contract-row" : ""}><td className="font-semibold text-navy">{kind === "contract" ? <Link className="day-button" href={`/contracts/${encodeURIComponent(name || "Unmapped")}`}>{name}</Link> : <button className="day-button" onClick={() => name && onSupervisorSelect?.(name)}>{name}</button>}</td><td>{number(row.total_stops)}</td><td>{number(row.incomplete_stops)}</td><td>{percent(row.completion_percent)}</td></tr>; })}</tbody></table></div></section>;
}
