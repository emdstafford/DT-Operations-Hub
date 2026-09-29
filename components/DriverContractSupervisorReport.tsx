"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Entry = { contract: string; employeeId: string; name: string; hundredths: number };
type Saved = { payroll_name: string; period_end: string; summary: Entry[] };
type Assignment = { contract_number: string; supervisor: string; start_date: string; end_date: string | null };
type Row = { driver: string; contract: string; supervisor: string };
const cleanContract = (value: string) => value === "UNASSIGNED_DEPARTMENT" ? "Unassigned" : value;
const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

export default function DriverContractSupervisorReport() {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [search, setSearch] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [contract, setContract] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void (async () => {
    setLoading(true); setError("");
    const [history, assignmentRows] = await Promise.all([
      supabase.from("timecard_summary_history").select("payroll_name,period_end,summary").is("archived_at", null).order("period_end", { ascending: false }).order("saved_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("contract_assignment_periods").select("contract_number,supervisor,start_date,end_date"),
    ]);
    if (history.error) setError(history.error.message.includes("timecard_summary_history") ? "Run timecard_summary_history.sql in Supabase first. The latest timecard summary supplies the driver list for this report." : history.error.message);
    else {
      setSaved(history.data as Saved | null);
      if (!assignmentRows.error) setAssignments((assignmentRows.data ?? []) as Assignment[]);
    }
    setLoading(false);
  })(); }, []);

  const rows = useMemo<Row[]>(() => {
    if (!saved) return [];
    const date = saved.period_end;
    const unique = new Map<string, Row>();
    for (const entry of saved.summary ?? []) {
      const contractNumber = cleanContract(entry.contract);
      const supervisors = assignments.filter((item) => item.contract_number === entry.contract && date >= item.start_date && (!item.end_date || date <= item.end_date)).map((item) => item.supervisor);
      const row = { driver: entry.name, contract: contractNumber, supervisor: supervisors.length ? [...new Set(supervisors)].join(" / ") : "Unassigned" };
      unique.set(`${entry.employeeId}|${entry.contract}`, row);
    }
    return [...unique.values()].sort((a,b) => a.driver.localeCompare(b.driver) || a.contract.localeCompare(b.contract));
  }, [saved, assignments]);
  const supervisors = useMemo(() => [...new Set(rows.map((row) => row.supervisor))].sort(), [rows]);
  const contracts = useMemo(() => [...new Set(rows.map((row) => row.contract))].sort(), [rows]);
  const visible = useMemo(() => rows.filter((row) => {
    const q = search.trim().toLowerCase();
    return (!q || `${row.driver} ${row.contract} ${row.supervisor}`.toLowerCase().includes(q)) && (!supervisor || row.supervisor === supervisor) && (!contract || row.contract === contract);
  }), [rows, search, supervisor, contract]);

  function exportCsv() {
    const csv = ["Driver,Contract,Supervisor", ...visible.map((row) => [row.driver,row.contract,row.supervisor].map(csvCell).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `driver-contract-supervisor-${saved?.period_end || "report"}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  return <section className="panel driver-assignment-report">
    <div className="panel-heading"><div><h2>Driver / Contract / Supervisor Report</h2><span>{saved ? `Based on ${saved.payroll_name} · through ${saved.period_end}` : "Current driver assignment list"}</span></div><strong>{visible.length} assignments</strong></div>
    {loading && <p>Loading report…</p>}{error && <p className="alert alert-error">{error}</p>}
    {!loading && !error && !saved && <div className="location-empty">No saved timecard summary is available yet. Upload the current timecard report once to create the driver list.</div>}
    {saved && <>
      <div className="driver-report-filters no-print"><label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Driver, contract, or supervisor" /></label><label>Contract<select value={contract} onChange={(event) => setContract(event.target.value)}><option value="">All contracts</option>{contracts.map((item) => <option key={item}>{item}</option>)}</select></label><label>Supervisor<select value={supervisor} onChange={(event) => setSupervisor(event.target.value)}><option value="">All supervisors</option>{supervisors.map((item) => <option key={item}>{item}</option>)}</select></label><div className="hub-actions"><button type="button" className="hub-secondary-link" onClick={() => { setSearch(""); setContract(""); setSupervisor(""); }}>Clear</button><button type="button" className="hub-secondary-link" onClick={exportCsv}>Export CSV</button><button type="button" className="primary-link" onClick={() => window.print()}>Print</button></div></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Driver</th><th>Contract</th><th>Supervisor</th></tr></thead><tbody>{visible.map((row,index) => <tr key={`${row.driver}-${row.contract}-${index}`}><td className="font-semibold text-navy">{row.driver}</td><td>{row.contract}</td><td>{row.supervisor}</td></tr>)}</tbody></table></div>
      {!visible.length && <div className="location-empty">No driver assignments match those filters.</div>}
    </>}
  </section>;
}
