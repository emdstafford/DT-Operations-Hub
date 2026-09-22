"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { holidaySourceFingerprint, type HolidayHoursImportResult } from "@/lib/holidayHoursImport";

export type HolidayDraft = { name: string; date: string };

export default function HolidayHoursHistory({
  result,
  holidayCount,
  sourceFile,
  sourceContents,
  holidays,
}: {
  result: HolidayHoursImportResult | null;
  holidayCount: 1 | 2;
  sourceFile: string;
  sourceContents: string;
  holidays: HolidayDraft[];
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setMessage("");
    setError("");
  }, [holidayCount, sourceFile]);

  async function saveSummary() {
    if (!result || !sourceContents) return;
    if (holidays.some((draft) => !draft.name.trim() || !draft.date)) {
      setError("Enter the name and date for every holiday before saving.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setError("Your session expired. Sign in again before saving.");
      setSaving(false);
      return;
    }

    const sourceFingerprint = await holidaySourceFingerprint(sourceContents);
    const { data: duplicates, error: duplicateError } = await supabase
      .from("holiday_import_history")
      .select("holiday_name, holiday_date, processed_by_email, created_at")
      .eq("source_fingerprint", sourceFingerprint)
      .is("archived_at", null);

    if (duplicateError) {
      setError(duplicateError.code === "42703"
        ? "Run the updated holiday-history SQL once to enable duplicate protection."
        : duplicateError.message);
      setSaving(false);
      return;
    }
    if (duplicates?.length) {
      const savedAs = duplicates.map((row) => `${row.holiday_name} (${row.holiday_date})`).join(", ");
      setError(`Duplicate not saved. This exact source file is already in history as ${savedAs}.`);
      setSaving(false);
      return;
    }

    const perHolidayHours = result.totalHolidayHours / holidayCount;
    const { error: saveError } = await supabase.from("holiday_import_history").insert(holidays.map((draft) => ({
      holiday_name: draft.name.trim(),
      holiday_date: draft.date,
      source_file: sourceFile,
      source_fingerprint: sourceFingerprint,
      source_rows: result.sourceRowCount,
      unique_employees: result.rows.length,
      combined_source_hours: result.totalSourceHours,
      capped_at_eight: result.cappedEmployeeCount,
      total_holiday_hours: perHolidayHours,
      processed_by: userData.user.id,
      processed_by_email: userData.user.email?.toLowerCase(),
    })));

    if (saveError) {
      setError(saveError.code === "42P01"
        ? "Holiday history needs its one-time database setup before summaries can be saved."
        : saveError.message);
    } else {
      setMessage(`${holidays.length === 1 ? "Holiday summary" : "Both holiday summaries"} saved. Open Payroll Trends to review the shared history.`);
    }
    setSaving(false);
  }

  if (!result) return null;

  return <>
    <section className="panel holiday-history-save">
      <div className="panel-heading">
        <div><p className="eyebrow">Shared history</p><h2>Label and save this import</h2><span>The Hub checks the source-file contents for duplicates before saving. Employee rows remain private in this browser.</span></div>
      </div>
      <div className="holiday-save-labels">{holidays.map((holiday) => <span key={`${holiday.name}-${holiday.date}`}><strong>{holiday.name}</strong> · {holiday.date}</span>)}</div>
      <button type="button" className="upload-button holiday-save-button" disabled={saving} onClick={() => void saveSummary()}>{saving ? "Checking and saving…" : `Save ${holidayCount === 1 ? "holiday" : "both holidays"} to history`}</button>
    </section>
    {(message || error) && <section className={`panel ${error ? "payroll-error" : "holiday-history-success"}`}><strong>{error ? "History not saved" : "History updated"}</strong><span>{error || message}</span></section>}
  </>;
}
