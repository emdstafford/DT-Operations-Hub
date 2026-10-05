"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Comparison, SavedReport, TimecardDetailEntry } from "@/components/TimecardComparisons";

type ReviewReport = Pick<SavedReport, "id" | "payroll_name"> & { detail_rows?: TimecardDetailEntry[] };
type ReviewDraft = { note: string; approved: boolean; saved: boolean };
type SavedReview = { employee_id: string; driver_name: string; review_note: string; approved: boolean };

const hours = (value: number) => (value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const reportDate = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));

function changeGuidance(change: Comparison) {
  if (change.kind === "new") return "Hours appear only in the later payroll. Check whether this is a new employee or missing time in the earlier report.";
  if (change.kind === "missing") return "No hours appear in the later payroll. Check whether the employee left or time is missing.";
  return "Hours differ between payrolls. Review the daily entries for a missed or changed timecard entry.";
}

function ChangeEntries({ title, rows }: { title: string; rows: TimecardDetailEntry[] }) {
  return <div className="timecard-change-period">
    <h4>{title}</h4>
    {rows.length ? <div className="table-scroll"><table className="data-table">
      <thead><tr><th>Work date</th><th>Contract</th><th>In</th><th>Out</th><th>Hours</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.date}-${row.contract}-${index}`}>
        <td>{reportDate(row.date)}</td><td>{row.contract}</td><td>{row.inTime || "—"}</td><td>{row.outTime || "—"}</td><td>{hours(row.hundredths)}</td>
      </tr>)}</tbody>
    </table></div> : <p>No time entries for this employee in this payroll report.</p>}
  </div>;
}

export default function ChangedDriversReview({
  before, after, drivers, search, userId,
}: {
  before: ReviewReport;
  after: ReviewReport;
  drivers: Comparison[];
  search: string;
  userId: string;
}) {
  const [open, setOpen] = useState(false);
  const [reviews, setReviews] = useState<Record<string, ReviewDraft>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [message, setMessage] = useState("");
  const [savingDriver, setSavingDriver] = useState("");
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    setLimit(50);
    setReviews({});
    setLoadError("");
    setSaveError("");
    setMessage("");
    if (!open) return;
    let active = true;
    setLoading(true);
    void (async () => {
      const { data, error } = await supabase.from("timecard_change_reviews")
        .select("employee_id,driver_name,review_note,approved")
        .eq("earlier_report_id", before.id)
        .eq("current_report_id", after.id);
      if (error) throw error;
      if (!active) return;
      const next: Record<string, ReviewDraft> = {};
      for (const row of (data ?? []) as SavedReview[]) {
        next[row.employee_id] = { note: row.review_note ?? "", approved: Boolean(row.approved), saved: true };
      }
      setReviews(next);
    })().catch(() => {
      if (active) setLoadError("Review-note storage needs setup. Ask the administrator to run supabase/timecard_change_reviews.sql in Supabase.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [before.id, after.id, open]);

  const matchingDrivers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? drivers.filter((driver) => driver.label.toLowerCase().includes(term)) : drivers;
  }, [drivers, search]);
  const visibleDrivers = matchingDrivers.slice(0, limit);

  function reviewFor(key: string): ReviewDraft {
    return reviews[key] ?? { note: "", approved: false, saved: true };
  }

  async function saveReview(driver: Comparison) {
    if (!userId || savingDriver) return;
    const draft = reviewFor(driver.key);
    setSavingDriver(driver.key);
    setSaveError("");
    setMessage("");
    const { error } = await supabase.from("timecard_change_reviews").upsert({
      earlier_report_id: before.id,
      current_report_id: after.id,
      employee_id: driver.key,
      driver_name: driver.label,
      review_note: draft.note.trim(),
      approved: draft.approved,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "earlier_report_id,current_report_id,employee_id" });
    if (error) setSaveError(error.message.includes("timecard_change_reviews")
      ? "Review-note storage needs setup. Ask the administrator to run supabase/timecard_change_reviews.sql in Supabase."
      : error.message);
    else {
      setReviews((current) => ({ ...current, [driver.key]: { ...draft, note: draft.note.trim(), saved: true } }));
      setMessage(`Saved review for ${driver.label}.`);
    }
    setSavingDriver("");
  }

  function edit(key: string, changes: Partial<ReviewDraft>) {
    setReviews((current) => ({ ...current, [key]: { ...reviewFor(key), ...changes, saved: false } }));
    setMessage("");
  }

  return <section className="timecard-changed-driver-review">
    <button type="button" className="primary-link no-print" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? "Hide changed drivers" : `Review ${drivers.length} drivers with changed hours`}
    </button>
    {open && <div className="timecard-changed-driver-panel">
      <p>New or missing hours can mean a staffing change or a missed time entry. Check the daily punches before approving the change.</p>
      {loadError && <p className="alert alert-error" role="alert">{loadError}</p>}
      {saveError && <p className="alert alert-error" role="alert">{saveError}</p>}
      {message && <p className="timecard-action-status" role="status">{message}</p>}
      {loading ? <p role="status">Loading saved review notes…</p> : matchingDrivers.length === 0 ? <p>No changed drivers match this search.</p> : <>
        <p>Showing {visibleDrivers.length} of {matchingDrivers.length} changed drivers for {before.payroll_name} → {after.payroll_name}.</p>
        <div className="timecard-changed-driver-list">{visibleDrivers.map((driver) => {
          const draft = reviewFor(driver.key);
          const earlierRows = (before.detail_rows ?? []).filter((row) => row.employeeId === driver.key).sort((a, b) => a.date.localeCompare(b.date) || a.contract.localeCompare(b.contract));
          const laterRows = (after.detail_rows ?? []).filter((row) => row.employeeId === driver.key).sort((a, b) => a.date.localeCompare(b.date) || a.contract.localeCompare(b.contract));
          const changeLabel = driver.kind === "new" ? "New hours in later payroll" : driver.kind === "missing" ? "No hours in later payroll" : "Hours changed";
          return <article className="timecard-changed-driver-card" key={driver.key}>
            <header><div><h3>{driver.label}</h3><span>{changeLabel}</span></div><strong className={driver.delta < 0 ? "timecard-hours-down" : driver.delta > 0 ? "timecard-hours-up" : ""}>{driver.delta > 0 ? "+" : ""}{hours(driver.delta)} hours</strong></header>
            <p>{changeGuidance(driver)}</p>
            <div className="timecard-change-hour-summary"><span>{before.payroll_name}: <strong>{hours(driver.previous)}</strong></span><span>{after.payroll_name}: <strong>{hours(driver.current)}</strong></span></div>
            <details className="timecard-change-entries"><summary>View daily timecard entries</summary><div className="timecard-change-periods">
              <ChangeEntries title={`${before.payroll_name} · ${reportDate(before.period_start)}–${reportDate(before.period_end)}`} rows={earlierRows}/>
              <ChangeEntries title={`${after.payroll_name} · ${reportDate(after.period_start)}–${reportDate(after.period_end)}`} rows={laterRows}/>
            </div></details>
            <label className="timecard-review-note">Review note<textarea value={draft.note} maxLength={500} rows={2} placeholder="For example: Confirmed new hire; missing Tuesday punch sent for correction." onChange={(event) => edit(driver.key, { note: event.target.value })}/></label>
            <div className="timecard-review-actions">
              <label><input type="checkbox" checked={draft.approved} onChange={(event) => edit(driver.key, { approved: event.target.checked })}/> Reviewed and approved</label>
              <button type="button" className="hub-secondary-link" disabled={!userId || !!savingDriver || (draft.saved && !saveError)} onClick={() => void saveReview(driver)}>{savingDriver === driver.key ? "Saving…" : draft.saved ? "Saved" : "Save review"}</button>
            </div>
          </article>;
        })}</div>
        {matchingDrivers.length > visibleDrivers.length && <button type="button" className="hub-secondary-link no-print" onClick={() => setLimit((value) => value + 50)}>Show 50 more drivers</button>}
      </>}
    </div>}
  </section>;
}
