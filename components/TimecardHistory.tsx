"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { compare, totals, type SavedReport, type TimecardSummaryEntry } from "@/components/TimecardComparisons";

type HistoryRow = SavedReport & { employee_count: number; contract_count: number; total_hundredths: number; archived_at: string | null };
const hour = (hundredths: number) => (hundredths / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatDate = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const version = (row: HistoryRow) => `${row.payroll_name} · ${formatDate(row.period_start)}–${formatDate(row.period_end)} · saved ${new Date(row.saved_at).toLocaleDateString("en-US")}`;

function ChangeTable({ title, rows }: { title: string; rows: ReturnType<typeof compare> }) {
  return <div className="timecard-comparison-table timecard-change-table">
    <h3>{title} · {rows.length}</h3>
    <div className="table-scroll"><table className="data-table">
      <thead><tr><th>{title === "Driver hours" ? "Driver" : "Contract"}</th><th>Earlier</th><th>Later</th><th>Change</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}><td>{row.label}</td><td>{hour(row.previous)}</td><td>{hour(row.current)}</td><td className={row.delta < 0 ? "timecard-hours-down" : "timecard-hours-up"}>{row.delta > 0 ? "+" : ""}{hour(row.delta)}</td></tr>)}</tbody>
    </table></div>
    {!rows.length && <p>No changes for the selected {title === "Driver hours" ? "drivers" : "contracts"}.</p>}
  </div>;
}

export default function TimecardHistory() {
  const [reports, setReports] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [beforeId, setBeforeId] = useState("");
  const [afterId, setAfterId] = useState("");
  const [selectedContracts, setSelectedContracts] = useState<string[] | null>(null);
  const [userId, setUserId] = useState("");
  const [canDelete, setCanDelete] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [printMode, setPrintMode] = useState(false);

  useEffect(() => { let active = true; void (async () => {
    const [history, auth] = await Promise.all([
      supabase.from("timecard_summary_history").select("id,payroll_name,pay_date,period_start,period_end,source_file,saved_at,employee_count,contract_count,total_hundredths,summary,archived_at").order("pay_date", { ascending: false }).order("saved_at", { ascending: false }).limit(250),
      supabase.auth.getUser(),
    ]);
    if (!active) return;
    setUserId(auth.data.user?.id ?? "");
    setCanDelete(auth.data.user?.email?.trim().toLowerCase() === "estafford@dtexpress.net");
    if (history.error) setError(history.error.message.includes("timecard_summary_history") ? "Run timecard_summary_history.sql in Supabase to enable private payroll comparisons." : history.error.message);
    else {
      const allItems = (history.data ?? []) as HistoryRow[];
      const items = allItems.filter((item) => !item.archived_at);
      setReports(allItems);
      if (items.length) {
        setAfterId(items[0].id);
        setBeforeId(items.find((item) => item.period_end < items[0].period_start)?.id ?? items[1]?.id ?? "");
      }
    }
    setLoading(false);
  })(); return () => { active = false; }; }, []);

  const activeReports = reports.filter((item) => !item.archived_at);
  const archivedReports = reports.filter((item) => !!item.archived_at);
  const before = activeReports.find((item) => item.id === beforeId);
  const after = activeReports.find((item) => item.id === afterId);
  const availableContracts = useMemo(() => [...new Set([...(before?.summary ?? []), ...(after?.summary ?? [])].map((entry) => entry.contract))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [before, after]);
  const includedContracts = selectedContracts === null ? availableContracts : selectedContracts.filter((contract) => availableContracts.includes(contract));
  const beforeEntries = (before?.summary ?? []).filter((entry) => includedContracts.includes(entry.contract));
  const afterEntries = (after?.summary ?? []).filter((entry) => includedContracts.includes(entry.contract));
  const driverChanges = useMemo(() => before && after ? compare(totals(beforeEntries, "driver"), totals(afterEntries, "driver")) : [], [before, after, selectedContracts]);
  const contractChanges = useMemo(() => before && after ? compare(totals(beforeEntries, "contract"), totals(afterEntries, "contract")) : [], [before, after, selectedContracts]);
  const beforeTotal = beforeEntries.reduce((sum, entry) => sum + entry.hundredths, 0);
  const afterTotal = afterEntries.reduce((sum, entry) => sum + entry.hundredths, 0);
  const allSelected = includedContracts.length === availableContracts.length;
  const validComparison = !!before && !!after && beforeId !== afterId && includedContracts.length > 0;

  function toggleContract(contract: string, checked: boolean) {
    const current = new Set(includedContracts);
    if (checked) current.add(contract); else current.delete(contract);
    setSelectedContracts([...current]);
  }
  function printComparison() {
    if (!validComparison) return;
    setPrintMode(true);
    const reset = () => { setPrintMode(false); window.removeEventListener("afterprint", reset); };
    window.addEventListener("afterprint", reset);
    window.setTimeout(() => window.print(), 150);
  }
  async function changeArchive(row: HistoryRow, restore: boolean) {
    if (!userId || busyId) return;
    setBusyId(row.id); setActionMessage("");
    const archived_at = restore ? null : new Date().toISOString();
    const { error: updateError } = await supabase.from("timecard_summary_history").update({ archived_at, archived_by: restore ? null : userId }).eq("id", row.id);
    if (updateError) setActionMessage(updateError.message);
    else {
      setReports((current) => current.map((item) => item.id === row.id ? { ...item, archived_at } : item));
      if (!restore && beforeId === row.id) setBeforeId("");
      if (!restore && afterId === row.id) setAfterId("");
      setActionMessage(restore ? `${row.payroll_name} restored.` : `${row.payroll_name} archived and removed from comparisons.`);
    }
    setBusyId("");
  }
  async function deleteReport(row: HistoryRow) {
    if (!canDelete || busyId) return;
    if (!window.confirm(`Permanently delete ${version(row)}? This cannot be undone.`)) return;
    setBusyId(row.id); setActionMessage("");
    const { error: deleteError } = await supabase.from("timecard_summary_history").delete().eq("id", row.id);
    if (deleteError) setActionMessage(deleteError.message);
    else {
      setReports((current) => current.filter((item) => item.id !== row.id));
      if (beforeId === row.id) setBeforeId("");
      if (afterId === row.id) setAfterId("");
      setActionMessage(`${row.payroll_name} deleted.`);
    }
    setBusyId("");
  }

  return <div className={`report-stack timecard-history ${printMode ? "timecard-print-compare-mode" : ""}`}>
    {loading && <section className="panel"><p>Loading saved payrolls…</p></section>}
    {error && <section className="alert alert-error">{error}</section>}
    {!loading && !error && !reports.length && <section className="panel"><p>No payrolls saved yet. Open Timecard Report and upload a file to start.</p></section>}
    {!!reports.length && <>
      <section className="panel timecard-history-summary">
        <div className="panel-heading"><div><h2>Saved payrolls</h2><span>{activeReports.length} available · raw time punches stay in the browser</span></div></div>
        {actionMessage && <p className="timecard-action-status" role="status">{actionMessage}</p>}
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Payroll</th><th>Timecard dates</th><th>Drivers</th><th>Contracts</th><th>Total hours</th><th>Manage</th></tr></thead><tbody>
          {activeReports.map((row) => <tr key={row.id}><td>{version(row)}</td><td>{formatDate(row.period_start)}–{formatDate(row.period_end)}</td><td>{row.employee_count}</td><td>{row.contract_count}</td><td>{hour(Number(row.total_hundredths))}</td><td><button type="button" className="hub-secondary-link" disabled={!!busyId} onClick={() => void changeArchive(row, false)}>Archive</button>{canDelete && <button type="button" className="timecard-delete" disabled={!!busyId} onClick={() => void deleteReport(row)}>Delete</button>}</td></tr>)}
        </tbody></table></div>
        {!!archivedReports.length && <details className="timecard-history-pick"><summary>Archived payrolls ({archivedReports.length})</summary><div className="timecard-versions">{archivedReports.map((row) => <div className="timecard-version-row" key={row.id}><span>{version(row)} · {hour(Number(row.total_hundredths))} hours</span><div><button type="button" disabled={!!busyId} onClick={() => void changeArchive(row, true)}>Restore</button>{canDelete && <button type="button" className="timecard-delete" disabled={!!busyId} onClick={() => void deleteReport(row)}>Delete</button>}</div></div>)}</div></details>}
      </section>

      {!!activeReports.length && <section className="panel timecard-comparisons timecard-print-comparison">
        <div className="panel-heading"><div><h2>Compare two payrolls</h2><span>Choose the two uploads, then select the contracts to include.</span></div><button type="button" className="primary-link" disabled={!validComparison} onClick={printComparison}>Print comparison</button></div>
        <div className="timecard-print-title print-only"><p>Davenport Transportation · Payroll comparison</p><h1>{before?.payroll_name} → {after?.payroll_name}</h1><span>{before && after ? `${formatDate(before.period_start)}–${formatDate(before.period_end)} compared with ${formatDate(after.period_start)}–${formatDate(after.period_end)}` : ""}</span><span> · ${includedContracts.length} selected contracts</span></div>
        <div className="timecard-payroll-fields">
          <label>Earlier payroll<select value={beforeId} onChange={(event) => { setBeforeId(event.target.value); setSelectedContracts(null); }}><option value="">Choose payroll</option>{activeReports.map((row) => <option key={row.id} value={row.id}>{version(row)}</option>)}</select></label>
          <label>Later payroll<select value={afterId} onChange={(event) => { setAfterId(event.target.value); setSelectedContracts(null); }}><option value="">Choose payroll</option>{activeReports.map((row) => <option key={row.id} value={row.id}>{version(row)}</option>)}</select></label>
        </div>
        {!!before && !!after && beforeId !== afterId && <>
          <section className="timecard-contract-picker">
            <div className="timecard-contract-picker-heading"><div><h3>Contracts to compare</h3><span>{allSelected ? `All ${availableContracts.length} contracts selected` : `${includedContracts.length} of ${availableContracts.length} selected`}</span></div>
              <div className="timecard-history-picker-actions"><button type="button" onClick={() => setSelectedContracts(null)}>Select all</button><button type="button" onClick={() => setSelectedContracts([])}>Clear selection</button></div>
            </div>
            <div className="timecard-contract-picker-grid">{availableContracts.map((contract) => <label key={contract}><input type="checkbox" checked={includedContracts.includes(contract)} onChange={(event) => toggleContract(contract, event.target.checked)} /><strong>{contract}</strong></label>)}</div>
          </section>
          {includedContracts.length === 0 ? <p>Select at least one contract to compare.</p> : <>
            <p className="timecard-comparison-note">PTO-coded rows were excluded when each file was uploaded. Holiday-coded hours are included. Select contracts above to limit the comparison.</p>
            <div className="timecard-report-summary print-only"><span><strong>{hour(beforeTotal)}</strong> earlier hours</span><span><strong>{hour(afterTotal)}</strong> later hours</span><span><strong>{afterTotal - beforeTotal > 0 ? "+" : ""}{hour(afterTotal - beforeTotal)}</strong> change</span></div>
            <ChangeTable title="Contract hours" rows={contractChanges} />
            <ChangeTable title="Driver hours" rows={driverChanges} />
          </>}
        </>}
        {!before || !after || beforeId === afterId ? <p>Choose two different payrolls to see the comparison.</p> : null}
      </section>}
    </>}
  </div>;
}
