"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

type DailyEntry = { date: string; contract: string; hundredths: number };
type BatchResult = { file: string; status: "updated" | "review" | "error"; message: string };

const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const aliases = {
  last: ["last name", "surname"],
  first: ["first name", "given name"],
  contract: ["worked department", "contract", "contract number"],
  inTime: ["in time", "time in", "in punch"],
  outTime: ["out time", "time out", "out punch"],
  hours: ["hours", "worked hours"],
  payCode: ["pay code", "paycode", "earnings code"],
};
const find = (row: string[], names: string[]) => row.findIndex((value) => names.includes(normalize(value)));
const findDate = (row: string[]) => row.findIndex((value) => ["pay date", "work date", "worked date", "date", "shift date"].includes(normalize(value)));
const findIn = (row: string[]) => find(row, aliases.inTime);
const findCombinedName = (row: string[]) => row.findIndex((value) => ["payroll name", "employee name", "driver name", "full name"].includes(normalize(value)));

function workDate(value: string): string | null {
  const text = value.trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s.*)?$/.exec(text);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (!us && !iso) return null;
  const yearText = iso ? iso[1] : us![3];
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  const month = Number(iso ? iso[2] : us![1]);
  const day = Number(iso ? iso[3] : us![2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function parseFile(file: File) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  let best: { rows: string[][]; header: number; score: number } | null = null;
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false })
      .map((row) => row.map((value) => String(value ?? "")));
    rows.slice(0, 30).forEach((row, header) => {
      const score =
        Number(find(row, aliases.last) >= 0) +
        Number(find(row, aliases.first) >= 0) +
        Number(find(row, aliases.contract) >= 0) +
        Number(find(row, aliases.inTime) >= 0) +
        Number(find(row, aliases.outTime) >= 0) +
        Number(find(row, aliases.hours) >= 0) +
        Number(find(row, aliases.payCode) >= 0) +
        (findCombinedName(row) >= 0 ? 2 : 0);
      if (!best || score > best.score) best = { rows, header, score };
    });
  }
  const selected = best as { rows: string[][]; header: number; score: number } | null;
  if (!selected) throw new Error("Could not identify the timecard columns.");

  const heading: string[] = selected.rows[selected.header];
  const contractCol = find(heading, aliases.contract);
  const hoursCol = find(heading, aliases.hours);
  const payCodeCol = find(heading, aliases.payCode);
  const dateCol = findDate(heading);
  const inCol = findIn(heading);
  if (contractCol < 0 || hoursCol < 0 || payCodeCol < 0 || (dateCol < 0 && inCol < 0)) {
    throw new Error("Could not identify the timecard columns.");
  }
  const daily = new Map<string, DailyEntry>();
  let totalHundredths = 0;
  let readableRows = 0;
  let unreadableRows = 0;
  const dates: string[] = [];

  for (const cells of selected.rows.slice(selected.header + 1)) {
    if (!cells.some((cell) => cell.trim())) continue;
    const payCode = (cells[payCodeCol] ?? "").trim().toUpperCase();
    if (payCode === "PTO") continue;
    const rawContract = (cells[contractCol] ?? "").trim();
    const hourText = (cells[hoursCol] ?? "").trim().replaceAll(",", "");
    // Historical ADP exports include contract/employee label rows with no hours.
    // They are not work entries and should not block a backfill.
    if (!hourText) continue;
    const date = workDate(cells[inCol] ?? "") ??
      (dateCol >= 0 ? workDate(cells[dateCol] ?? "") : null);
    const hours = Number(hourText);
    if (!date || !/^[-+]?\\d+(?:\\.\\d{1,2})?$/.test(hourText) || !Number.isFinite(hours)) {
      unreadableRows++;
      continue;
    }
    const contract = rawContract || "UNASSIGNED_DEPARTMENT";
    const hundredths = Math.round(hours * 100);
    readableRows++;
    totalHundredths += hundredths;
    dates.push(date);
    const key = `${date}\u0000${contract}`;
    const current = daily.get(key);
    daily.set(key, { date, contract, hundredths: (current?.hundredths ?? 0) + hundredths });
  }

  if (!readableRows || !dates.length) throw new Error("No readable worked-hour rows were found.");
  dates.sort();
  return {
    start: dates[0],
    end: dates[dates.length - 1],
    totalHundredths,
    dailyEntries: [...daily.values()].filter((entry) => entry.hundredths > 0),
    unreadableRows,
  };
}

export default function TimecardDailyBackfill() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BatchResult[]>([]);

  async function run(files: FileList | null) {
    if (!files?.length) return;
    setRunning(true);
    setResults([]);
    const output: BatchResult[] = [];

    for (const file of Array.from(files)) {
      try {
        if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw new Error("Not an Excel or CSV timecard report.");
        const parsed = await parseFile(file);
        if (parsed.unreadableRows > 0) {
          output.push({ file: file.name, status: "review", message: `${parsed.unreadableRows} possible work rows could not be read. Nothing changed.` });
          setResults([...output]);
          continue;
        }

        const { data, error } = await supabase.from("timecard_summary_history")
          .select("id,payroll_name,total_hundredths,daily_summary,saved_at")
          .is("archived_at", null)
          .eq("period_start", parsed.start)
          .eq("period_end", parsed.end)
          .order("saved_at", { ascending: false });
        if (error) throw error;

        const candidates = data ?? [];
        if (!candidates.length) {
          output.push({ file: file.name, status: "review", message: `No saved payroll matches ${parsed.start}–${parsed.end}. Nothing changed.` });
          setResults([...output]);
          continue;
        }

        const match = candidates.find((row) => Number(row.total_hundredths) === parsed.totalHundredths);
        if (!match) {
          const savedTotals = [...new Set(candidates.map((row) => (Number(row.total_hundredths) / 100).toFixed(2)))].join(", ");
          output.push({ file: file.name, status: "review", message: `Totals do not match. File: ${(parsed.totalHundredths / 100).toFixed(2)} hours; saved: ${savedTotals} hours. Nothing changed.` });
          setResults([...output]);
          continue;
        }

        if (Array.isArray(match.daily_summary) && match.daily_summary.length > 0) {
          output.push({ file: file.name, status: "updated", message: `${match.payroll_name}: daily contract hours were already saved; no change needed.` });
          setResults([...output]);
          continue;
        }

        const { data: backfillStatus, error: updateError } = await supabase.rpc("backfill_timecard_daily_summary", {
          p_id: match.id,
          p_expected_total_hundredths: parsed.totalHundredths,
          p_daily_summary: parsed.dailyEntries,
        });
        if (updateError) throw updateError;
        if (backfillStatus === "total_mismatch") {
          output.push({ file: file.name, status: "review", message: `${match.payroll_name}: saved total changed before the backfill could finish. Nothing changed.` });
          setResults([...output]);
          continue;
        }
        if (backfillStatus === "already_complete") {
          output.push({ file: file.name, status: "updated", message: `${match.payroll_name}: daily contract hours were already saved; no change needed.` });
          setResults([...output]);
          continue;
        }
        if (backfillStatus !== "updated") throw new Error("The daily-hours backfill did not complete.");

        output.push({ file: file.name, status: "updated", message: `${match.payroll_name}: daily contract hours added. Historical total stayed at ${(parsed.totalHundredths / 100).toFixed(2)} hours.` });
      } catch (reason) {
        output.push({ file: file.name, status: "error", message: reason instanceof Error ? reason.message : "Could not process this file." });
      }
      setResults([...output]);
    }
    setRunning(false);
  }

  const updated = results.filter((row) => row.status === "updated").length;
  const review = results.filter((row) => row.status === "review").length;
  const errors = results.filter((row) => row.status === "error").length;

  return <section className="panel">
    <div className="panel-heading"><div><h2>Historical payroll daily-hours backfill</h2><span>Select several old timecard reports at once.</span></div></div>
    <p>This only adds the dated contract-hour breakdown to an already-saved payroll. It will not change a historical payroll total. The file dates and total hours must match a saved payroll before anything is updated.</p>
    <label className="primary-link timecard-file-button">
      {running ? "Processing…" : "Choose payroll files"}
      <input type="file" accept=".csv,.xlsx,.xls" multiple disabled={running} onChange={(event) => void run(event.target.files)} />
    </label>
    {!!results.length && <div className="timecard-status"><strong>{results.length} processed · {updated} updated/already complete · {review} need review · {errors} errors</strong></div>}
    {!!results.length && <div className="table-scroll"><table className="data-table"><thead><tr><th>File</th><th>Result</th><th>Details</th></tr></thead><tbody>
      {results.map((row, index) => <tr key={`${row.file}-${index}`}><td>{row.file}</td><td>{row.status === "updated" ? "Ready" : row.status === "review" ? "Review" : "Error"}</td><td>{row.message}</td></tr>)}
    </tbody></table></div>}
  </section>;
}
