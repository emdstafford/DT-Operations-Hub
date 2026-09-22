"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { HolidayHoursImportResult } from "@/lib/holidayHoursImport";

type HolidayDraft = { name: string; date: string };

type HistoryRow = {
  id: string;
  holiday_name: string;
  holiday_date: string;
  source_file: string;
  source_rows: number;
  unique_employees: number;
  combined_source_hours: number;
  capped_at_eight: number;
  total_holiday_hours: number;
  processed_by_email: string;
  created_at: string;
  updated_at: string;
};

function decimal(value: number) {
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function average(total: number, count: number) {
  return count ? total / count : 0;
}

export default function HolidayHoursHistory({
  result,
  holidayCount,
  sourceFile,
}: {
  result: HolidayHoursImportResult | null;
  holidayCount: 1 | 2;
  sourceFile: string;
}) {
  const [drafts, setDrafts] = useState<HolidayDraft[]>([{ name: "", date: "" }]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setDrafts(Array.from({ length: holidayCount }, () => ({ name: "", date: "" })));
    setMessage("");
  }, [holidayCount, sourceFile]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const { data, error: historyError } = await supabase
        .from("holiday_import_history")
        .select("id, holiday_name, holiday_date, source_file, source_rows, unique_employees, combined_source_hours, capped_at_eight, total_holiday_hours, processed_by_email, created_at, updated_at")
        .order("holiday_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (!active) return;
      if (historyError) {
        setError(historyError.code === "42P01"
          ? "Holiday history needs its one-time database setup before summaries can be saved."
          : historyError.message);
        setHistory([]);
      } else {
        setError("");
        setHistory((data ?? []).map((row) => ({
          ...row,
          combined_source_hours: Number(row.combined_source_hours),
          total_holiday_hours: Number(row.total_holiday_hours),
        })) as HistoryRow[]);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [reload]);

  const yearly = useMemo(() => {
    const groups = new Map<string, HistoryRow[]>();
    history.forEach((row) => {
      const year = row.holiday_date.slice(0, 4);
      groups.set(year, [...(groups.get(year) ?? []), row]);
    });
    return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left)).map(([year, rows]) => ({
      year,
      holidays: rows.length,
      totalHours: rows.reduce((sum, row) => sum + row.total_holiday_hours, 0),
      averageEmployees: average(rows.reduce((sum, row) => sum + row.unique_employees, 0), rows.length),
      capped: rows.reduce((sum, row) => sum + row.capped_at_eight, 0),
    }));
  }, [history]);

  const comparisons = useMemo(() => {
    const groups = new Map<string, HistoryRow[]>();
    history.forEach((row) => {
      const key = row.holiday_name.trim().toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), row]);
    });
    return [...groups.values()].map((rows) => ({
      name: rows[0].holiday_name,
      occurrences: rows.length,
      averageEmployees: average(rows.reduce((sum, row) => sum + row.unique_employees, 0), rows.length),
      averageSourceHours: average(rows.reduce((sum, row) => sum + row.combined_source_hours, 0), rows.length),
      averageHolidayHours: average(rows.reduce((sum, row) => sum + row.total_holiday_hours, 0), rows.length),
      latest: rows.map((row) => row.holiday_date).sort().at(-1) ?? "",
    })).sort((left, right) => left.name.localeCompare(right.name));
  }, [history]);

  function updateDraft(index: number, field: keyof HolidayDraft, value: string) {
    setDrafts((current) => current.map((draft, draftIndex) => draftIndex === index
      ? { ...draft, [field]: value }
      : draft));
  }

  async function saveSummary() {
    if (!result) return;
    if (drafts.some((draft) => !draft.name.trim() || !draft.date)) {
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
    const perHolidayHours = result.totalHolidayHours / holidayCount;
    const { error: saveError } = await supabase.from("holiday_import_history").insert(drafts.map((draft) => ({
      holiday_name: draft.name.trim(),
      holiday_date: draft.date,
      source_file: sourceFile,
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
      setMessage(`${drafts.length === 1 ? "Holiday summary" : "Both holiday summaries"} saved to shared history.`);
      setReload((value) => value + 1);
    }
    setSaving(false);
  }

  function updateHistoryRow(id: string, field: "holiday_name" | "holiday_date", value: string) {
    setHistory((current) => current.map((row) => row.id === id ? { ...row, [field]: value } : row));
  }

  async function saveHistoryRow(row: HistoryRow) {
    if (!row.holiday_name.trim() || !row.holiday_date) {
      setError("Holiday name and date are required.");
      return;
    }
    setError("");
    setMessage("");
    const { error: updateError } = await supabase
      .from("holiday_import_history")
      .update({
        holiday_name: row.holiday_name.trim(),
        holiday_date: row.holiday_date,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateError) setError(updateError.message);
    else {
      setMessage(`${row.holiday_name.trim()} updated.`);
      setReload((value) => value + 1);
    }
  }

  return <>
    {result && <section className="panel holiday-history-save">
      <div className="panel-heading">
        <div><p className="eyebrow">Shared history</p><h2>Label and save this import</h2><span>Only summary totals are saved. Employee rows and the payroll CSV remain private in this browser.</span></div>
      </div>
      <div className="holiday-detail-grid">
        {drafts.map((draft, index) => <div className="holiday-detail-card" key={index}>
          <strong>{holidayCount === 1 ? "Holiday" : `Holiday ${index + 1}`}</strong>
          <label>Holiday name<input type="text" value={draft.name} placeholder={index === 0 ? "Christmas" : "New Year’s Day"} onChange={(event) => updateDraft(index, "name", event.target.value)} /></label>
          <label>Holiday date<input type="date" value={draft.date} onChange={(event) => updateDraft(index, "date", event.target.value)} /></label>
        </div>)}
      </div>
      <button type="button" className="upload-button holiday-save-button" disabled={saving} onClick={() => void saveSummary()}>{saving ? "Saving…" : `Save ${holidayCount === 1 ? "holiday" : "both holidays"} to history`}</button>
    </section>}

    {(message || error) && <section className={`panel ${error ? "payroll-error" : "holiday-history-success"}`}><strong>{error ? "History not saved" : "History updated"}</strong><span>{error || message}</span></section>}

    <section className="panel holiday-history-panel">
      <div className="panel-heading"><div><p className="eyebrow">Payroll trends</p><h2>Holiday import history</h2><span>Compare yearly totals and recurring holidays. Names and dates can be corrected at any time.</span></div></div>
      {loading ? <p className="holiday-history-empty">Loading holiday history…</p> : history.length === 0
        ? <p className="holiday-history-empty">No holiday summaries have been saved yet.</p>
        : <>
          <div className="holiday-trend-grid">
            <div><h3>Yearly summary</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Year</th><th>Holidays</th><th>Avg. employees</th><th>Capped at 8</th><th>Total holiday hours</th></tr></thead><tbody>{yearly.map((row) => <tr key={row.year}><td><strong>{row.year}</strong></td><td>{row.holidays}</td><td>{decimal(row.averageEmployees)}</td><td>{row.capped}</td><td>{decimal(row.totalHours)}</td></tr>)}</tbody></table></div></div>
            <div><h3>Holiday comparison</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Holiday</th><th>Years</th><th>Avg. employees</th><th>Avg. source hours</th><th>Avg. holiday hours</th><th>Latest</th></tr></thead><tbody>{comparisons.map((row) => <tr key={row.name.toLowerCase()}><td><strong>{row.name}</strong></td><td>{row.occurrences}</td><td>{decimal(row.averageEmployees)}</td><td>{decimal(row.averageSourceHours)}</td><td>{decimal(row.averageHolidayHours)}</td><td>{row.latest}</td></tr>)}</tbody></table></div></div>
          </div>
          <h3 className="holiday-history-title">Saved imports</h3>
          <div className="table-scroll"><table className="data-table holiday-history-table"><thead><tr><th>Holiday name</th><th>Date</th><th>Source rows</th><th>Employees</th><th>Source hours</th><th>Capped at 8</th><th>Holiday hours</th><th>Processed by</th><th></th></tr></thead><tbody>{history.map((row) => <tr key={row.id}>
            <td><input aria-label="Holiday name" value={row.holiday_name} onChange={(event) => updateHistoryRow(row.id, "holiday_name", event.target.value)} /></td>
            <td><input aria-label="Holiday date" type="date" value={row.holiday_date.slice(0, 10)} onChange={(event) => updateHistoryRow(row.id, "holiday_date", event.target.value)} /></td>
            <td>{row.source_rows.toLocaleString()}</td><td>{row.unique_employees.toLocaleString()}</td><td>{decimal(row.combined_source_hours)}</td><td>{row.capped_at_eight.toLocaleString()}</td><td>{decimal(row.total_holiday_hours)}</td><td><span>{row.processed_by_email}</span><small>{new Date(row.created_at).toLocaleString()}</small></td>
            <td><button type="button" className="secondary-button" onClick={() => void saveHistoryRow(row)}>Save changes</button></td>
          </tr>)}</tbody></table></div>
        </>}
    </section>
  </>;
}

