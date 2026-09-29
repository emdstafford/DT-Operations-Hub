"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Entry = { contract: string; employeeId: string; name: string; hundredths: number };
type Saved = { payroll_name: string; period_start: string; period_end: string; saved_at: string; summary: Entry[] };
type Assignment = { contract_number: string; supervisor: string; start_date: string; end_date: string | null };
type Accumulated = { driver: string; employeeId: string; contract: string; lastSeen: string };
type Row = Accumulated & { supervisor: string };

const cleanContract = (value: string) => value === "UNASSIGNED_DEPARTMENT" ? "Unassigned" : value;
const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

function supervisorFor(contract: string, date: string, assignments: Assignment[]) {
  const exact = assignments
    .filter((item) => item.contract_number === contract && date >= item.start_date && (!item.end_date || date <= item.end_date))
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  if (exact.length) return [...new Set(exact.map((item) => item.supervisor))].join(" / ");

  // If a historical driver record predates the assignment table, use the latest known supervisor
  // for that contract rather than creating a separate supervisor mapping for this report.
  const latest = assignments
    .filter((item) => item.contract_number === contract)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  return latest[0]?.supervisor ?? "Unassigned";
}

export default function DriverContractSupervisorReport() {
  const [history, setHistory] = useState<Saved[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [search, setSearch] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [contract, setContract] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void (async () => {
    setLoading(true); setError("");
    const [historyRows, assignmentRows] = await Promise.all([
      supabase.from("timecard_summary_history").select("payroll_name,period_start,period_end,saved_at,summary").is("archived_at", null).order("period_end", { ascending: false }).order("saved_at", { ascending: false }),
      supabase.from("contract_assignment_periods").select("contract_number,supervisor,start_date,end_date"),
    ]);
    if (historyRows.error) setError(`Could not load saved timecard history: ${historyRows.error.message}`);
    else setHistory((historyRows.data ?? []) as Saved[]);
    if (assignmentRows.error) setError((current) => current || `Could not load contract supervisors: ${assignmentRows.error.message}`);
    else setAssignments((assignmentRows.data ?? []) as Assignment[]);
    setLoading(false);
  })(); }, []);

  const rows = useMemo<Row[]>(() => {
    const accumulated = new Map<string, Accumulated>();
    // History is newest first. Keep the newest occurrence of each driver/contract pair while
    // accumulating every distinct assignment we have ever loaded into timecard history.
    for (const report of history) {
      for (const entry of report.summary ?? []) {
        if (!entry.name?.trim() || !entry.contract?.trim()) continue;
        const key = `${entry.employeeId || entry.name.toLowerCase()}|${entry.contract}`;
        if (!accumulated.has(key)) accumulated.set(key, {
          driver: entry.name.trim(), employeeId: entry.employeeId, contract: entry.contract, lastSeen: report.period_end,
        });
      }
    }
    return [...accumulated.values()].map((item) => ({
      ...item,
      contract: cleanContract(item.contract),
      supervisor: item.contract === "UNASSIGNED_DEPARTMENT" ? "Unassigned" : supervisorFor(item.contract, item.lastSeen, assignments),
    })).sort((a,b) => a.driver.localeCompare(b.driver) || a.contract.localeCompare(b.contract));
  }, [history, assignments]);

  const supervisors = useMemo(() => [...new Set(rows.map((row) => row.supervisor))].sort(), [rows]);
  const contracts = useMemo(() => [...new Set(rows.map((row) => row.contract))].sort(), [rows]);
  const visible = useMemo(() => rows.filter((row) => {
    const q = search.trim().toLowerCase();
    return (!q || `${row.driver} ${row.contract} ${row.supervisor}`.toLowerCase().includes(q)) && (!supervisor || row.supervisor === supervisor) && (!contract || row.contract === contract);
  }), [rows, search, supervisor, contract]);

  const firstPeriod = history.length ? [...history].sort((a,b) => a.period_start.localeCompare(b.period_start))[0].period_start : "";
  const latestPeriod = history[0]?.period_end ?? "";

  function exportCsv() {
    const csv = ["Driver,Contract,Supervisor", ...visible.map((row) => [row.driver,row.contract,row.supervisor].map(csvCell).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `driver-contract-supervisor-${latestPeriod || "report"}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  return <section className="panel driver-assignment-report">
    <div className="panel-heading"><div><h2>Driver / Contract / Supervisor Report</h2><span>{history.length ? `All saved timecard data · ${firstPeriod} through ${latestPeriod} · supervisors from contract assignments` : "Accumulated driver assignment list"}</span></div><strong>{visible.length} assignments</strong></div>
    {loading && <p>Loading report…</p>}{error && <p className="alert alert-error">{error}</p>}
    {!loading && !error && !history.length && <div className="location-empty">No saved timecard summaries are available yet.</div>}
    {!!history.length && <>
      <div className="driver-report-filters no-print"><label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Driver, contract, or supervisor" /></label><label>Contract<select value={contract} onChange={(event) => setContract(event.target.value)}><option value="">All contracts</option>{contracts.map((item) => <option key={item}>{item}</option>)}</select></label><label>Supervisor<select value={supervisor} onChange={(event) => setSupervisor(event.target.value)}><option value="">All supervisors</option>{supervisors.map((item) => <option key={item}>{item}</option>)}</select></label><div className="hub-actions"><button type="button" className="hub-secondary-link" onClick={() => { setSearch(""); setContract(""); setSupervisor(""); }}>Clear</button><button type="button" className="hub-secondary-link" onClick={exportCsv}>Export CSV</button><button type="button" className="primary-link" onClick={() => window.print()}>Print</button></div></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Driver</th><th>Contract</th><th>Supervisor</th></tr></thead><tbody>{visible.map((row,index) => <tr key={`${row.employeeId}-${row.contract}-${index}`}><td className="font-semibold text-navy">{row.driver}</td><td>{row.contract}</td><td>{row.supervisor}</td></tr>)}</tbody></table></div>
      {!visible.length && <div className="location-empty">No driver assignments match those filters.</div>}
    </>}
  </section>;
}
