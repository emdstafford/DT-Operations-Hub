"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ComparisonTable, compare, totals, type SavedReport } from "@/components/TimecardComparisons";

type HistoryRow = SavedReport & { employee_count: number; contract_count: number; total_hundredths: number; archived_at: string | null };
type Assignment = { contract_number: string; supervisor: string; start_date: string; end_date: string | null };
type CurrentAssignment = { contract_number: string; supervisor: string };
const hour = (hundredths: number) => (hundredths / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatDate = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const version = (row: HistoryRow) => `${row.payroll_name} · ${formatDate(row.period_start)}–${formatDate(row.period_end)} · saved ${new Date(row.saved_at).toLocaleDateString("en-US")}`;

export default function TimecardHistory() {
  const [reports, setReports] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [beforeId, setBeforeId] = useState("");
  const [afterId, setAfterId] = useState("");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [printAll, setPrintAll] = useState(false);
  const [printMode, setPrintMode] = useState<"comparison" | "saved" | null>(null);
  const [savedPrintId, setSavedPrintId] = useState("");
  const [savedCompareId, setSavedCompareId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [baselineId, setBaselineId] = useState("");
  const [baselineChoice, setBaselineChoice] = useState("");
  const [baselineMessage, setBaselineMessage] = useState("");
  const [userId, setUserId] = useState("");
  const [canDelete, setCanDelete] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [currentAssignments, setCurrentAssignments] = useState<CurrentAssignment[]>([]);
  const [assignmentError, setAssignmentError] = useState(false);

  useEffect(() => { let active = true; void (async () => {
    const [dated, current] = await Promise.all([
      supabase.from("contract_assignment_periods").select("contract_number,supervisor,start_date,end_date"),
      supabase.from("contract_supervisors").select("contract_number,supervisor"),
    ]);
    if (!active) return;
    setAssignmentError(!!dated.error || !!current.error);
    setAssignments((dated.data ?? []) as Assignment[]);
    setCurrentAssignments((current.data ?? []) as CurrentAssignment[]);
  })(); return () => { active = false; }; }, []);

  useEffect(() => { let active = true; void (async () => {
    const [history, baseline, auth] = await Promise.all([supabase.from("timecard_summary_history")
      .select("id,payroll_name,pay_date,period_start,period_end,source_file,saved_at,employee_count,contract_count,total_hundredths,summary,archived_at")
      .order("pay_date", { ascending: false }).order("saved_at", { ascending: false }).limit(250),
      supabase.from("timecard_comparison_baseline").select("report_id").eq("id", true).maybeSingle(), supabase.auth.getUser()]);
    const { data, error: historyError } = history;
    if (!active) return;
    setUserId(auth.data.user?.id ?? "");
    setCanDelete(auth.data.user?.email?.trim().toLowerCase() === "estafford@dtexpress.net");
    if (historyError) setError(historyError.message.includes("timecard_summary_history") ? "Run timecard_summary_history.sql in Supabase to enable private payroll comparisons." : historyError.message);
    else { const allItems = (data ?? []) as HistoryRow[]; const items = allItems.filter((item) => !item.archived_at); setReports(allItems); const seenPayrolls = new Set<string>(); setSelectedIds(items.filter((item) => { const key = item.payroll_name.trim().toLowerCase(); if (seenPayrolls.has(key)) return false; seenPayrolls.add(key); return true; }).map((item) => item.id)); if (items.length) {
      const savedBaseline = items.find((item) => item.id === baseline.data?.report_id);
      setBaselineId(savedBaseline?.id || ""); setBaselineChoice(savedBaseline?.id || items[items.length - 1].id);
      setAfterId(items[0].id);
      setSavedPrintId(items[0].id);
      setBeforeId(savedBaseline?.id ?? items.find((item) => item.period_end < items[0].period_start)?.id ?? items[1]?.id ?? "");
    } if (baseline.error) setBaselineMessage("Baseline setting unavailable. Run the updated timecard_summary_history.sql in Supabase."); }
    setLoading(false);
  })(); return () => { active = false; }; }, []);

  const activeReports = reports.filter((item) => !item.archived_at);
  const archivedReports = reports.filter((item) => !!item.archived_at);
  const before = activeReports.find((item) => item.id === beforeId);
  const after = activeReports.find((item) => item.id === afterId);
  const savedPrint = activeReports.find((item) => item.id === savedPrintId) ?? activeReports[0];
  const earlierSaved = savedPrint ? activeReports.filter((item) => item.period_end < savedPrint.period_start).sort((a, b) => b.period_end.localeCompare(a.period_end) || b.saved_at.localeCompare(a.saved_at)) : [];
  const savedCompare = savedCompareId ? earlierSaved.find((item) => item.id === savedCompareId) : earlierSaved[0];
  const drivers = useMemo(() => before && after ? compare(totals(before.summary, "driver"), totals(after.summary, "driver")) : [], [before, after]);
  const contracts = useMemo(() => before && after ? compare(totals(before.summary, "contract"), totals(after.summary, "contract")) : [], [before, after]);
  const driverRows = drivers.filter((row) => row.label.toLowerCase().includes(search.trim().toLowerCase()));
  const contractRows = contracts.filter((row) => row.label.toLowerCase().includes(search.trim().toLowerCase()));
  const sequence = [...activeReports].filter((item) => selectedIds.includes(item.id)).sort((a, b) => a.period_end.localeCompare(b.period_end) || a.saved_at.localeCompare(b.saved_at));
  const baseline = activeReports.find((item) => item.id === baselineId);
  const selectedEntries = sequence.flatMap((item) => item.summary);
  const combinedDriver = totals(selectedEntries, "driver");
  const combinedContract = totals(selectedEntries, "contract");
  const baselineDriver = totals(baseline?.summary ?? [], "driver");
  const baselineContract = totals(baseline?.summary ?? [], "contract");
  const averageRows = (combined: ReturnType<typeof totals>, initial: ReturnType<typeof totals>) => [...combined].map(([key, value]) => ({
    key, label: value.label, total: value.hours, average: sequence.length ? value.hours / sequence.length : 0,
    baseline: initial.get(key)?.hours ?? 0,
  })).filter((row) => printAll || !search.trim() || row.label.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const byContract = useMemo(() => {
    const old = before?.summary ?? [], next = after?.summary ?? [];
    return [...new Set([...old, ...next].map((entry) => entry.contract))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((contract) => {
      const earlier = old.filter((entry) => entry.contract === contract);
      const later = next.filter((entry) => entry.contract === contract);
      const oldDrivers = totals(earlier, "driver"), newDrivers = totals(later, "driver");
      const drivers = [...new Set([...oldDrivers.keys(), ...newDrivers.keys()])].map((key) => ({
        key, name: newDrivers.get(key)?.label ?? oldDrivers.get(key)?.label ?? key,
        earlier: oldDrivers.get(key)?.hours ?? 0, later: newDrivers.get(key)?.hours ?? 0,
      })).sort((a, b) => a.name.localeCompare(b.name));
      return { contract, drivers, earlier: earlier.reduce((sum, entry) => sum + entry.hundredths, 0), later: later.reduce((sum, entry) => sum + entry.hundredths, 0) };
    });
  }, [before, after]);
  const savedContractGroups = useMemo(() => {
    const current = savedPrint?.summary ?? [], previous = savedCompare?.summary ?? [];
    return [...new Set([...current, ...previous].map((entry) => entry.contract))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((contract) => {
      const rows = current.filter((entry) => entry.contract === contract);
      const prior = previous.filter((entry) => entry.contract === contract);
      const currentDrivers = totals(rows, "driver"), previousDrivers = totals(prior, "driver");
      const drivers = [...new Set([...currentDrivers.keys(), ...previousDrivers.keys()])].map((id) => ({ id, name: currentDrivers.get(id)?.label ?? previousDrivers.get(id)?.label ?? id,
        hours: currentDrivers.get(id)?.hours ?? 0, prior: previousDrivers.get(id)?.hours ?? 0,
      })).sort((a, b) => a.name.localeCompare(b.name));
      return { contract, drivers, total: rows.reduce((sum, entry) => sum + entry.hundredths, 0), priorTotal: prior.reduce((sum, entry) => sum + entry.hundredths, 0) };
    });
  }, [savedPrint, savedCompare]);
  function supervisorFor(contract: string, report: HistoryRow | undefined) {
    if (assignmentError) return "Supervisor unavailable";
    if (!report) return "—";
    const key = contract.trim().toUpperCase();
    if (["01SHDR", "011VAN"].includes(key)) return "No supervisor required";
    const variants = [key, key.replace(/^0+(?=\d)/, "")];
    const dated = assignments.filter((item) => variants.includes(item.contract_number.trim().toUpperCase()));
    const effective = dated.filter((item) => item.start_date <= report.period_end && (!item.end_date || item.end_date >= report.period_start));
    const names = effective.length ? effective.map((item) => item.supervisor) : dated.length ? [] : currentAssignments.filter((item) => variants.includes(item.contract_number.trim().toUpperCase())).map((item) => item.supervisor);
    return [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort().join(", ") || "Not assigned for these dates";
  }
  async function setBaseline() {
    if (!baselineChoice || !activeReports.some((item) => item.id === baselineChoice)) return;
    setBaselineMessage("");
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) { setBaselineMessage("Please sign in again to update the baseline."); return; }
    const { error: updateError } = await supabase.from("timecard_comparison_baseline").upsert({ id: true, report_id: baselineChoice, updated_by: user.user.id, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (updateError) setBaselineMessage(updateError.message);
    else { setBaselineId(baselineChoice); setBeforeId(baselineChoice); setBaselineMessage("Shared payroll baseline saved."); }
  }
  async function changeArchive(row: HistoryRow, restore: boolean) {
    if (row.id === baselineId) { setActionMessage("Choose another first payroll baseline before archiving this one."); return; }
    if (!userId || busyId) return;
    setBusyId(row.id); setActionMessage("");
    const archived_at = restore ? null : new Date().toISOString();
    const { error: updateError } = await supabase.from("timecard_summary_history").update({ archived_at, archived_by: restore ? null : userId }).eq("id", row.id);
    if (updateError) setActionMessage(updateError.message);
    else {
      setReports((current) => current.map((item) => item.id === row.id ? { ...item, archived_at } : item));
      if (!restore) {
        setSelectedIds((ids) => ids.filter((id) => id !== row.id));
        if (beforeId === row.id) setBeforeId("");
        if (afterId === row.id) setAfterId("");
        if (baselineChoice === row.id) setBaselineChoice(baselineId);
      }
      setActionMessage(restore ? `${row.payroll_name} restored.` : `${row.payroll_name} archived. It is excluded from totals.`);
    }
    setBusyId("");
  }
  async function deleteReport(row: HistoryRow) {
    if (!canDelete || busyId) return;
    if (row.id === baselineId) { setActionMessage("Choose another first payroll baseline before deleting this one."); return; }
    if (!window.confirm(`Permanently delete ${version(row)}? This cannot be undone.`)) return;
    setBusyId(row.id); setActionMessage("");
    const { error: deleteError } = await supabase.from("timecard_summary_history").delete().eq("id", row.id);
    if (deleteError) setActionMessage(deleteError.message);
    else {
      setReports((current) => current.filter((item) => item.id !== row.id));
      setSelectedIds((ids) => ids.filter((id) => id !== row.id));
      if (beforeId === row.id) setBeforeId("");
      if (afterId === row.id) setAfterId("");
      if (baselineChoice === row.id) setBaselineChoice(baselineId);
      setActionMessage(`${row.payroll_name} deleted.`);
    }
    setBusyId("");
  }
  function startPrint(mode: "comparison" | "saved") {
    if (mode === "saved" && !savedPrint) return;
    if (mode === "comparison" && (!before || !after || beforeId === afterId)) return;
    setPrintMode(mode);
    setPrintAll(true);
    const reset = () => { setPrintAll(false); setPrintMode(null); window.removeEventListener("afterprint", reset); };
    window.addEventListener("afterprint", reset);
    window.setTimeout(() => window.print(), 150);
  }
  function printComparison() {
    if (!before || !after || beforeId === afterId) return;
    startPrint("comparison");
  }
  return <div className={`report-stack timecard-history ${printMode === "saved" ? "timecard-print-saved-mode" : "timecard-print-compare-mode"}`}>
    {loading && <section className="panel"><p>Loading saved payroll summaries…</p></section>}
    {error && <section className="alert alert-error">{error}</section>}
    {!loading && !error && !reports.length && <section className="panel"><p>No payroll summaries saved yet. Open Timecard Report and upload a file to start.</p></section>}
    {!!reports.length && <>
      <section className="panel timecard-history-summary"><div className="panel-heading"><div><h2>Saved payrolls</h2><span>{activeReports.length} active versions · {sequence.length} selected · Raw time punches stay in the browser.</span></div><button type="button" className="primary-link" disabled={!before || !after || beforeId === afterId} onClick={printComparison}>Print full payroll report</button></div>
        <div className="timecard-saved-print-controls"><label>Print a saved payroll by contract<select value={savedPrint?.id ?? ""} onChange={(event) => { setSavedPrintId(event.target.value); setSavedCompareId(""); }}>{activeReports.map((row) => <option key={row.id} value={row.id}>{version(row)}</option>)}</select></label><label>Compare with earlier payroll<select value={savedCompare?.id ?? ""} onChange={(event) => setSavedCompareId(event.target.value)}><option value="">{earlierSaved.length ? "Choose earlier payroll" : "No earlier payroll saved"}</option>{earlierSaved.map((row) => <option key={row.id} value={row.id}>{version(row)}</option>)}</select></label><button type="button" className="hub-secondary-link" disabled={!savedPrint} onClick={() => startPrint("saved")}>Print saved payroll by contract</button><p>This saved summary contains driver and contract hours. For individual time-in and time-out rows, reopen the original file in Timecard Report.</p></div>
        {actionMessage && <p className="timecard-action-status" role="status">{actionMessage}</p>}
        <details className="timecard-history-pick"><summary>Choose payrolls to show ({sequence.length} selected)</summary><div className="timecard-history-picker-actions"><button type="button" onClick={() => setSelectedIds(activeReports.map((item) => item.id))}>Select every active version</button><button type="button" onClick={() => setSelectedIds([])}>Clear selection</button></div><div className="timecard-history-options">{activeReports.map((item) => <label key={item.id}><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds(selectedIds.includes(item.id) ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id])} />{version(item)}</label>)}</div></details>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Payroll</th><th>Timecard dates</th><th>Drivers</th><th>Contracts</th><th>Total hours</th><th>Change vs prior saved payroll</th></tr></thead><tbody>{sequence.map((row, index) => { const previous = [...sequence.slice(0, index)].reverse().find((item) => item.period_end < row.period_start); const delta = previous ? Number(row.total_hundredths) - Number(previous.total_hundredths) : null; return <tr key={row.id}><td>{row.payroll_name}</td><td>{formatDate(row.period_start)}–{formatDate(row.period_end)}</td><td>{row.employee_count}</td><td>{row.contract_count}</td><td>{hour(Number(row.total_hundredths))}</td><td>{delta === null ? "First saved period" : `${delta > 0 ? "+" : ""}${hour(delta)}`}</td></tr>; })}</tbody></table></div>
        <div className="timecard-versions"><h3>Manage saved versions</h3><p>Archive an upload entered by mistake. Archived versions stay available to restore; they do not count toward reports. Only Emily can permanently delete one.</p>{activeReports.map((row) => <div className="timecard-version-row" key={row.id}><span>{version(row)} · {hour(Number(row.total_hundredths))} hours {row.id === baselineId ? "· First payroll baseline" : ""}</span><div><button type="button" disabled={!!busyId || row.id === baselineId} onClick={() => void changeArchive(row, false)}>Archive</button>{canDelete && <button type="button" className="timecard-delete" disabled={!!busyId || row.id === baselineId} onClick={() => void deleteReport(row)}>Delete</button>}</div></div>)}</div>
        {!!archivedReports.length && <details className="timecard-history-pick"><summary>Archived payroll uploads ({archivedReports.length})</summary><div className="timecard-history-options">{archivedReports.map((row) => <div className="timecard-version-row" key={row.id}><span>{version(row)} · {hour(Number(row.total_hundredths))} hours</span><div><button type="button" disabled={!!busyId} onClick={() => void changeArchive(row, true)}>Restore</button>{canDelete && <button type="button" className="timecard-delete" disabled={!!busyId} onClick={() => void deleteReport(row)}>Delete</button>}</div></div>)}</div></details>}
      </section>
      {!!activeReports.length && <section className="panel timecard-comparisons timecard-print-comparison"><div className="panel-heading"><div><h2>Compare two payrolls</h2><span>Select any active payrolls, including corrected versions of the same period.</span></div><button type="button" className="hub-secondary-link" disabled={!before || !after || beforeId === afterId} onClick={printComparison}>Print full payroll report</button></div>
        <div className="timecard-print-title print-only"><p>Davenport Transportation · Payroll hour comparison</p><h1>{before?.payroll_name} → {after?.payroll_name}</h1><span>{before && after ? `${formatDate(before.period_start)}–${formatDate(before.period_end)} compared with ${formatDate(after.period_start)}–${formatDate(after.period_end)}` : ""}</span></div>
        <div className="timecard-baseline"><label>First payroll in the new system<select value={baselineChoice} onChange={(event) => setBaselineChoice(event.target.value)}>{activeReports.map((row) => <option key={row.id} value={row.id}>{version(row)}</option>)}</select></label><button type="button" className="hub-secondary-link" onClick={() => void setBaseline()}>Save shared baseline</button></div>
        {baselineMessage && <p role="status">{baselineMessage}</p>}
        <div className="timecard-payroll-fields"><label>Earlier payroll<select value={beforeId} onChange={(event) => setBeforeId(event.target.value)}><option value="">Choose payroll</option>{activeReports.map((row) => <option key={row.id} value={row.id}>{version(row)}</option>)}</select></label><label>Later payroll<select value={afterId} onChange={(event) => setAfterId(event.target.value)}><option value="">Choose payroll</option>{activeReports.map((row) => <option key={row.id} value={row.id}>{version(row)}</option>)}</select></label></div>
        <label className="timecard-history-search">Find driver or contract<input type="search" value={search} placeholder="Name or contract number" onChange={(event) => setSearch(event.target.value)} /></label>
        {!before || !after || beforeId === afterId ? <p>Choose two different active versions to see changes.</p> : <>
          <p className="timecard-comparison-note">{before && after ? `${before.payroll_name} → ${after.payroll_name}. Hour differences may reflect schedules, staffing, or corrections; review the source before treating a change as an error.` : ""}</p>
          <div className="timecard-report-summary print-only"><span><strong>{hour(Number(before.total_hundredths))}</strong> earlier hours</span><span><strong>{hour(Number(after.total_hundredths))}</strong> later hours</span><span><strong>{Number(after.total_hundredths) - Number(before.total_hundredths) > 0 ? "+" : ""}{hour(Number(after.total_hundredths) - Number(before.total_hundredths))}</strong> hours difference</span><span><strong>{drivers.length}</strong> drivers with changed hours</span><span><strong>{contracts.length}</strong> contracts with changed hours</span></div>
          <ComparisonTable title="Driver hours" rows={printAll ? drivers : driverRows} showAll={showAll || printAll} />
          <ComparisonTable title="Contract hours" rows={printAll ? contracts : contractRows} showAll={showAll || printAll} />
          {(driverRows.length > 25 || contractRows.length > 25) && <button type="button" className="hub-secondary-link" onClick={() => setShowAll(!showAll)}>{showAll ? "Show largest changes only" : "Show all changes"}</button>}
        </>}
      </section>}
      {!!sequence.length && <section className="panel timecard-comparisons timecard-print-totals"><div className="panel-heading"><div><h2>Totals across selected payrolls</h2><span>{sequence.length} saved payroll{sequence.length === 1 ? "" : "s"} · {hour(sequence.reduce((sum, item) => sum + Number(item.total_hundredths), 0))} combined hours</span></div></div><p className="timecard-comparison-note">Average is the selected total divided by the number of payrolls. Baseline shows one pay period, so compare it with the average when several payrolls are selected.</p>
        <div className="timecard-print-selected print-only"><strong>Payrolls included in totals:</strong> {sequence.map((row) => `${row.payroll_name} (${formatDate(row.period_start)}–${formatDate(row.period_end)})`).join(" · ")}</div>
        <AverageTable title="Drivers" rows={averageRows(combinedDriver, baselineDriver)} baseline={!!baseline} showAll={showAll || printAll} />
        <AverageTable title="Contracts" rows={averageRows(combinedContract, baselineContract)} baseline={!!baseline} showAll={showAll || printAll} />
      </section>}
      {before && after && beforeId !== afterId && <section className="panel timecard-comparisons timecard-print-contract-drivers"><div className="panel-heading"><div><h2>Driver hours by contract</h2><span>{before.payroll_name} compared with {after.payroll_name} · {byContract.length} contracts</span></div></div>
        <p className="timecard-comparison-note">Supervisor names reflect assignments for each payroll’s timecard dates. The same driver may work on more than one contract; hours appear under the contract where they were worked.</p>
        {byContract.map(({ contract, drivers: contractDrivers, earlier, later }) => <div className="timecard-contract-breakdown" key={contract}>
          <div className="timecard-contract-breakdown-heading"><h3>Contract {contract}</h3><div><span>{before.payroll_name}: {supervisorFor(contract, before)}</span><span>{after.payroll_name}: {supervisorFor(contract, after)}</span></div></div>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Driver</th><th>{before.payroll_name} hours</th><th>{after.payroll_name} hours</th><th>Up / down</th></tr></thead><tbody>{contractDrivers.map((driver) => <tr key={driver.key}><td>{driver.name}</td><td>{hour(driver.earlier)}</td><td>{hour(driver.later)}</td><td className={driver.later < driver.earlier ? "timecard-hours-down" : driver.later > driver.earlier ? "timecard-hours-up" : ""}>{driver.later - driver.earlier > 0 ? "+" : ""}{hour(driver.later - driver.earlier)}</td></tr>)}</tbody><tfoot><tr><th>Contract total</th><th>{hour(earlier)}</th><th>{hour(later)}</th><th>{later - earlier > 0 ? "+" : ""}{hour(later - earlier)}</th></tr></tfoot></table></div>
        </div>)}
      </section>}
      {savedPrint && <section className="panel timecard-comparisons timecard-saved-packet"><div className="timecard-print-title"><p>Davenport Transportation · Saved timecard hours</p><h1>{savedPrint.payroll_name} · Contract hours</h1><span>{formatDate(savedPrint.period_start)}–{formatDate(savedPrint.period_end)} · {savedContractGroups.length} contracts · {hour(Number(savedPrint.total_hundredths))} total hours</span>{savedCompare && <span> · Compared with {savedCompare.payroll_name} ({formatDate(savedCompare.period_start)}–{formatDate(savedCompare.period_end)}); total change {Number(savedPrint.total_hundredths) - Number(savedCompare.total_hundredths) > 0 ? "+" : ""}{hour(Number(savedPrint.total_hundredths) - Number(savedCompare.total_hundredths))} hours</span>}</div>
        {savedContractGroups.map(({ contract, drivers: contractDrivers, total, priorTotal }) => <div className="timecard-contract-breakdown" key={contract}><div className="timecard-contract-breakdown-heading"><h3>Contract {contract}</h3><div>{savedCompare && <span>{savedCompare.payroll_name} supervisor: {supervisorFor(contract, savedCompare)}</span>}<span>{savedPrint.payroll_name} supervisor: {supervisorFor(contract, savedPrint)}</span><span>{contractDrivers.length} drivers</span></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Driver</th>{savedCompare && <th>{savedCompare.payroll_name} hours</th>}<th>{savedPrint.payroll_name} hours</th>{savedCompare && <th>Up / down</th>}</tr></thead><tbody>{contractDrivers.map((driver) => <tr key={driver.id}><td>{driver.name}</td>{savedCompare && <td>{hour(driver.prior)}</td>}<td>{hour(driver.hours)}</td>{savedCompare && <td className={driver.hours < driver.prior ? "timecard-hours-down" : driver.hours > driver.prior ? "timecard-hours-up" : ""}>{driver.hours - driver.prior > 0 ? "+" : ""}{hour(driver.hours - driver.prior)}</td>}</tr>)}</tbody><tfoot><tr><th>Contract total</th>{savedCompare && <th>{hour(priorTotal)}</th>}<th>{hour(total)}</th>{savedCompare && <th>{total - priorTotal > 0 ? "+" : ""}{hour(total - priorTotal)}</th>}</tr></tfoot></table></div></div>)}
        <p className="timecard-comparison-note">Saved hour totals only. Individual punch dates and times are available when the original file is opened in Timecard Report.</p>
      </section>}
    </>}
  </div>;
}

function AverageTable({ title, rows, baseline, showAll }: { title: string; rows: Array<{ key: string; label: string; total: number; average: number; baseline: number }>; baseline: boolean; showAll: boolean }) {
  return <div className="timecard-comparison-table"><h3>{title} · {rows.length}</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>{title === "Drivers" ? "Driver" : "Contract"}</th><th>Selected total</th><th>Average / payroll</th>{baseline && <><th>First payroll</th><th>Average change</th></>}</tr></thead><tbody>{(showAll ? rows : rows.slice(0, 25)).map((row) => <tr key={row.key}><td>{row.label}</td><td>{hour(row.total)}</td><td>{hour(row.average)}</td>{baseline && <><td>{hour(row.baseline)}</td><td>{row.average - row.baseline > 0 ? "+" : ""}{hour(row.average - row.baseline)}</td></>}</tr>)}</tbody></table></div></div>;
}
