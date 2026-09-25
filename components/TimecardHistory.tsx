"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ComparisonTable, compare, totals, type SavedReport } from "@/components/TimecardComparisons";

type HistoryRow = SavedReport & { employee_count: number; contract_count: number; total_hundredths: number };
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [baselineId, setBaselineId] = useState("");
  const [baselineChoice, setBaselineChoice] = useState("");
  const [baselineMessage, setBaselineMessage] = useState("");

  useEffect(() => { let active = true; void (async () => {
    const [history, baseline] = await Promise.all([supabase.from("timecard_summary_history")
      .select("id,payroll_name,pay_date,period_start,period_end,source_file,saved_at,employee_count,contract_count,total_hundredths,summary")
      .order("pay_date", { ascending: false }).order("saved_at", { ascending: false }).limit(250),
      supabase.from("timecard_comparison_baseline").select("report_id").eq("id", true).maybeSingle()]);
    const { data, error: historyError } = history;
    if (!active) return;
    if (historyError) setError(historyError.message.includes("timecard_summary_history") ? "Run timecard_summary_history.sql in Supabase to enable private payroll comparisons." : historyError.message);
    else { const items = (data ?? []) as HistoryRow[]; setReports(items); const seenPayrolls = new Set<string>(); setSelectedIds(items.filter((item) => { const key = item.payroll_name.trim().toLowerCase(); if (seenPayrolls.has(key)) return false; seenPayrolls.add(key); return true; }).map((item) => item.id)); if (items.length) {
      const savedBaseline = items.find((item) => item.id === baseline.data?.report_id);
      setBaselineId(savedBaseline?.id || ""); setBaselineChoice(savedBaseline?.id || items[items.length - 1].id);
      setAfterId(items[0].id);
      setBeforeId(savedBaseline?.id ?? items.find((item) => item.period_end < items[0].period_start)?.id ?? items[1]?.id ?? "");
    } if (baseline.error) setBaselineMessage("Baseline setting unavailable. Run the updated timecard_summary_history.sql in Supabase."); }
    setLoading(false);
  })(); return () => { active = false; }; }, []);

  const before = reports.find((item) => item.id === beforeId);
  const after = reports.find((item) => item.id === afterId);
  const drivers = useMemo(() => before && after ? compare(totals(before.summary, "driver"), totals(after.summary, "driver")) : [], [before, after]);
  const contracts = useMemo(() => before && after ? compare(totals(before.summary, "contract"), totals(after.summary, "contract")) : [], [before, after]);
  const driverRows = drivers.filter((row) => row.label.toLowerCase().includes(search.trim().toLowerCase()));
  const contractRows = contracts.filter((row) => row.label.toLowerCase().includes(search.trim().toLowerCase()));
  const sequence = [...reports].filter((item) => selectedIds.includes(item.id)).sort((a, b) => a.period_end.localeCompare(b.period_end) || a.saved_at.localeCompare(b.saved_at));
  const baseline = reports.find((item) => item.id === baselineId);
  const selectedEntries = sequence.flatMap((item) => item.summary);
  const combinedDriver = totals(selectedEntries, "driver");
  const combinedContract = totals(selectedEntries, "contract");
  const baselineDriver = totals(baseline?.summary ?? [], "driver");
  const baselineContract = totals(baseline?.summary ?? [], "contract");
  const averageRows = (combined: ReturnType<typeof totals>, initial: ReturnType<typeof totals>) => [...combined].map(([key, value]) => ({
    key, label: value.label, total: value.hours, average: sequence.length ? value.hours / sequence.length : 0,
    baseline: initial.get(key)?.hours ?? 0,
  })).filter((row) => !search.trim() || row.label.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  async function setBaseline() {
    if (!baselineChoice) return;
    setBaselineMessage("");
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) { setBaselineMessage("Please sign in again to update the baseline."); return; }
    const { error: updateError } = await supabase.from("timecard_comparison_baseline").upsert({ id: true, report_id: baselineChoice, updated_by: user.user.id, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (updateError) setBaselineMessage(updateError.message);
    else { setBaselineId(baselineChoice); setBeforeId(baselineChoice); setBaselineMessage("Shared payroll baseline saved."); }
  }
  return <div className="report-stack timecard-history">
    {loading && <section className="panel"><p>Loading saved payroll summaries…</p></section>}
    {error && <section className="alert alert-error">{error}</section>}
    {!loading && !error && !reports.length && <section className="panel"><p>No payroll summaries saved yet. Open Timecard Report and upload a file to start.</p></section>}
    {!!reports.length && <>
      <section className="panel timecard-history-summary"><div className="panel-heading"><div><h2>Saved payrolls</h2><span>{reports.length} saved versions · {sequence.length} selected · Raw time punches stay in the browser.</span></div></div>
        <details className="timecard-history-pick"><summary>Choose payrolls to show ({sequence.length} selected)</summary><div className="timecard-history-picker-actions"><button type="button" onClick={() => setSelectedIds(reports.map((item) => item.id))}>Select every saved version</button><button type="button" onClick={() => setSelectedIds([])}>Clear selection</button></div><div className="timecard-history-options">{reports.map((item) => <label key={item.id}><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds(selectedIds.includes(item.id) ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id])} />{version(item)}</label>)}</div></details>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Payroll</th><th>Timecard dates</th><th>Drivers</th><th>Contracts</th><th>Total hours</th><th>Change vs prior saved payroll</th></tr></thead><tbody>{sequence.map((row, index) => { const previous = [...sequence.slice(0, index)].reverse().find((item) => item.period_end < row.period_start); const delta = previous ? Number(row.total_hundredths) - Number(previous.total_hundredths) : null; return <tr key={row.id}><td>{row.payroll_name}</td><td>{formatDate(row.period_start)}–{formatDate(row.period_end)}</td><td>{row.employee_count}</td><td>{row.contract_count}</td><td>{hour(Number(row.total_hundredths))}</td><td>{delta === null ? "First saved period" : `${delta > 0 ? "+" : ""}${hour(delta)}`}</td></tr>; })}</tbody></table></div>
      </section>
      <section className="panel timecard-comparisons"><div className="panel-heading"><div><h2>Compare two payrolls</h2><span>Select any saved payrolls, including corrected versions of the same period.</span></div></div>
        <div className="timecard-baseline"><label>First payroll in the new system<select value={baselineChoice} onChange={(event) => setBaselineChoice(event.target.value)}>{reports.map((row) => <option key={row.id} value={row.id}>{version(row)}</option>)}</select></label><button type="button" className="hub-secondary-link" onClick={() => void setBaseline()}>Save shared baseline</button></div>
        {baselineMessage && <p role="status">{baselineMessage}</p>}
        <div className="timecard-payroll-fields"><label>Earlier payroll<select value={beforeId} onChange={(event) => setBeforeId(event.target.value)}>{reports.map((row) => <option key={row.id} value={row.id}>{version(row)}</option>)}</select></label><label>Later payroll<select value={afterId} onChange={(event) => setAfterId(event.target.value)}>{reports.map((row) => <option key={row.id} value={row.id}>{version(row)}</option>)}</select></label></div>
        <label className="timecard-history-search">Find driver or contract<input type="search" value={search} placeholder="Name or contract number" onChange={(event) => setSearch(event.target.value)} /></label>
        {beforeId === afterId ? <p>Choose two different saved versions to see changes.</p> : <>
          <p className="timecard-comparison-note">{before && after ? `${before.payroll_name} → ${after.payroll_name}. Hour differences may reflect schedules, staffing, or corrections; review the source before treating a change as an error.` : ""}</p>
          <ComparisonTable title="Driver hours" rows={driverRows} showAll={showAll} />
          <ComparisonTable title="Contract hours" rows={contractRows} showAll={showAll} />
          {(driverRows.length > 25 || contractRows.length > 25) && <button type="button" className="hub-secondary-link" onClick={() => setShowAll(!showAll)}>{showAll ? "Show largest changes only" : "Show all changes"}</button>}
        </>}
      </section>
      {!!sequence.length && <section className="panel timecard-comparisons"><div className="panel-heading"><div><h2>Totals across selected payrolls</h2><span>{sequence.length} saved payroll{sequence.length === 1 ? "" : "s"} · {hour(sequence.reduce((sum, item) => sum + Number(item.total_hundredths), 0))} combined hours</span></div></div><p className="timecard-comparison-note">Average is the selected total divided by the number of payrolls. Baseline shows one pay period, so compare it with the average when several payrolls are selected.</p>
        <AverageTable title="Drivers" rows={averageRows(combinedDriver, baselineDriver)} baseline={!!baseline} showAll={showAll} />
        <AverageTable title="Contracts" rows={averageRows(combinedContract, baselineContract)} baseline={!!baseline} showAll={showAll} />
      </section>}
    </>}
  </div>;
}

function AverageTable({ title, rows, baseline, showAll }: { title: string; rows: Array<{ key: string; label: string; total: number; average: number; baseline: number }>; baseline: boolean; showAll: boolean }) {
  return <div className="timecard-comparison-table"><h3>{title} · {rows.length}</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>{title === "Drivers" ? "Driver" : "Contract"}</th><th>Selected total</th><th>Average / payroll</th>{baseline && <><th>First payroll</th><th>Average change</th></>}</tr></thead><tbody>{(showAll ? rows : rows.slice(0, 25)).map((row) => <tr key={row.key}><td>{row.label}</td><td>{hour(row.total)}</td><td>{hour(row.average)}</td>{baseline && <><td>{hour(row.baseline)}</td><td>{row.average - row.baseline > 0 ? "+" : ""}{hour(row.average - row.baseline)}</td></>}</tr>)}</tbody></table></div></div>;
}
