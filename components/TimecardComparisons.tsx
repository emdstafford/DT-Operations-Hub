"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

export type TimecardSummaryEntry = { contract: string; employeeId: string; name: string; hundredths: number };
export type SavedReport = {
  id: string; payroll_name: string; pay_date: string; period_start: string; period_end: string; source_file: string; saved_at: string;
  summary: TimecardSummaryEntry[];
};
export type Comparison = { key: string; label: string; previous: number; current: number; delta: number; kind: "changed" | "new" | "missing" };
const fmt = (hundredths: number) => (hundredths / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export function compare(before: Map<string, { label: string; hours: number }>, after: Map<string, { label: string; hours: number }>): Comparison[] {
  return [...new Set([...before.keys(), ...after.keys()])].map((key) => {
    const old = before.get(key), now = after.get(key);
    const previous = old?.hours ?? 0, current = now?.hours ?? 0;
    return { key, label: now?.label || old?.label || key, previous, current, delta: current - previous, kind: !old ? "new" as const : !now ? "missing" as const : "changed" as const };
  }).filter((row) => row.kind !== "changed" || row.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label));
}
export function totals(rows: TimecardSummaryEntry[], kind: "driver" | "contract") {
  const map = new Map<string, { label: string; hours: number }>();
  for (const row of rows) {
    const key = kind === "contract" ? row.contract : row.employeeId;
    const current = map.get(key);
    map.set(key, { label: kind === "contract" ? row.contract : row.name, hours: (current?.hours || 0) + row.hundredths });
  }
  return map;
}

export default function TimecardComparisons({ entries, start, end, sourceName, payrollName }: { entries: TimecardSummaryEntry[]; start: string; end: string; sourceName: string; payrollName: string }) {
  const [previous, setPrevious] = useState<SavedReport | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const signature = useMemo(() => JSON.stringify({ start, end, entries: [...entries].sort((a, b) => `${a.contract}|${a.employeeId}`.localeCompare(`${b.contract}|${b.employeeId}`)) }), [start, end, entries]);
  const current = useMemo(() => JSON.parse(signature).entries as TimecardSummaryEntry[], [signature]);

  useEffect(() => {
    if (!start || !end || !current.length) return;
    let active = true;
    void (async () => {
      setStatus("Saving this report’s hour totals…"); setError(""); setPrevious(null);
      try {
        const bytes = new TextEncoder().encode(signature);
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
        if (!active) return;
        setSaving(true);
        const { data: user } = await supabase.auth.getUser();
        if (!user.user) throw new Error("Sign in again to save this timecard summary.");
        const { data: existing, error: existingError } = await supabase.from("timecard_summary_history").select("id,payroll_name,pay_date").eq("summary_hash", hash).maybeSingle();
        if (existingError) throw existingError;
        if (!existing) {
          const { error: insertError } = await supabase.from("timecard_summary_history").insert({
            payroll_name: payrollName, pay_date: end, period_start: start, period_end: end, source_file: sourceName, summary_hash: hash,
            employee_count: new Set(current.map((entry) => entry.employeeId)).size,
            contract_count: new Set(current.map((entry) => entry.contract)).size,
            total_hundredths: current.reduce((sum, row) => sum + row.hundredths, 0),
            summary: current, saved_by: user.user.id,
          });
          // Concurrent uploads may save the identical summary at the same instant.
          if (insertError && insertError.code !== "23505") throw insertError;
        }
        const { data, error: historyError } = await supabase.from("timecard_summary_history")
          .select("id,payroll_name,pay_date,period_start,period_end,source_file,saved_at,summary")
          .lt("period_end", start).order("period_end", { ascending: false }).order("saved_at", { ascending: false }).limit(1).maybeSingle();
        if (historyError) throw historyError;
        if (!active) return;
        setPrevious((data as SavedReport | null) ?? null);
        setStatus(existing ? `Duplicate upload skipped. These totals are already saved as ${existing.payroll_name}.` : "Hour totals saved for future comparisons.");
      } catch (cause) {
        if (active) { setError(cause instanceof Error && cause.message.includes("timecard_summary_history") ? "History setup needed: run timecard_summary_history.sql in Supabase. Printing still works." : cause instanceof Error ? cause.message : "Could not save timecard totals."); setStatus(""); }
      } finally { if (active) setSaving(false); }
    })();
    return () => { active = false; };
  }, [signature, start, end, sourceName, payrollName, current]);

  const drivers = useMemo(() => compare(totals(previous?.summary ?? [], "driver"), totals(current, "driver")), [previous, current]);
  const contracts = useMemo(() => compare(totals(previous?.summary ?? [], "contract"), totals(current, "contract")), [previous, current]);
  return <section className="panel timecard-comparisons no-print">
    <div className="panel-heading"><div><h2>Compare with previous pay period</h2><span>{previous ? `${previous.payroll_name} (${day(previous.period_start)}–${day(previous.period_end)}) → ${payrollName} (${day(start)}–${day(end)})` : `${payrollName} · Timecards ${day(start)}–${day(end)}`}</span></div></div>
    {saving && <p role="status">Saving totals…</p>}{status && <p className="fuel-success timecard-history-message" role="status">{status}</p>}{error && <p className="alert alert-error" role="alert">{error}</p>}
    {!previous && !saving && !error && <p>No earlier, non-overlapping timecard report is saved yet. The next upload will show changes here.</p>}
    {previous && <><p className="timecard-comparison-note">Hours can change because assignments or schedules change. “New” and “missing” mean a person or contract appears in only one of these two reports; check the source before treating a difference as an error.</p>
      <ComparisonTable title="Driver hours" rows={drivers} showAll={showAll} />
      <ComparisonTable title="Contract hours" rows={contracts} showAll={showAll} />
      {(drivers.length > 25 || contracts.length > 25) && <button type="button" className="hub-secondary-link" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show largest changes only" : "Show all changes"}</button>}
    </>}
  </section>;
}
export function ComparisonTable({ title, rows, showAll }: { title: string; rows: Comparison[]; showAll: boolean }) {
  return <div className="timecard-comparison-table"><h3>{title} · {rows.length} changed</h3>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>{title.startsWith("Driver") ? "Driver" : "Contract"}</th><th>Previous hours</th><th>Current hours</th><th>Change</th><th>Status</th></tr></thead><tbody>{(showAll ? rows : rows.slice(0, 25)).map((row) => <tr key={row.key}><td>{row.label}</td><td>{fmt(row.previous)}</td><td>{fmt(row.current)}</td><td className={row.delta < 0 ? "timecard-hours-down" : "timecard-hours-up"}>{row.delta > 0 ? "+" : ""}{fmt(row.delta)}</td><td>{row.kind === "new" ? "New" : row.kind === "missing" ? "Missing" : row.delta < 0 ? "Down" : "Up"}</td></tr>)}</tbody></table></div>
    {!rows.length && <p>No hours changed between these reports.</p>}
  </div>;
}
