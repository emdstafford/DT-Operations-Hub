"use client";

import { useMemo, useRef, useState } from "react";
import {
  createHolidayHoursImport,
  holidaySourceFingerprint,
  holidayHoursImportCsv,
  type HolidayHoursImportResult,
} from "@/lib/holidayHoursImport";
import { supabase } from "@/lib/supabase";

type HolidayDraft = { name: string; date: string };

function number(value: number, digits = 2) {
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function HolidayHoursImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sourceCsv, setSourceCsv] = useState("");
  const [holidayCount, setHolidayCount] = useState<1 | 2>(1);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [historyMessage, setHistoryMessage] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [holidays, setHolidays] = useState<HolidayDraft[]>([{ name: "", date: "" }]);
  const result = useMemo<HolidayHoursImportResult | null>(() => sourceCsv ? createHolidayHoursImport(sourceCsv, holidayCount) : null, [sourceCsv, holidayCount]);
  const previewRows = useMemo(() => result?.rows.slice(0, 50) ?? [], [result]);

  async function processFile(file: File) {
    setError("");
    setHistoryMessage("");
    setHistoryError("");
    setSourceCsv("");
    setFileName(file.name);
    try {
      if (holidays.some((holiday) => !holiday.name.trim() || !holiday.date)) {
        throw new Error("Enter the holiday name and date before choosing the source CSV.");
      }
      if (!file.name.toLowerCase().endsWith(".csv")) {
        throw new Error("Select the source report saved as a CSV file.");
      }
      const csv = await file.text();
      const processed = createHolidayHoursImport(csv, holidayCount);
      const sourceFingerprint = await holidaySourceFingerprint(csv);
      const { data: duplicates, error: duplicateError } = await supabase
        .from("holiday_import_history")
        .select("holiday_name, holiday_date")
        .eq("source_fingerprint", sourceFingerprint)
        .is("archived_at", null);
      if (duplicateError) {
        setSourceCsv(csv);
        setHistoryError("The payroll file was calculated, but its history could not be checked or saved. Try again or contact an administrator.");
        return;
      }
      if (duplicates?.length) {
        const savedAs = duplicates.map((row) => `${row.holiday_name} (${row.holiday_date})`).join(", ");
        throw new Error(`Duplicate source file: it is already saved as ${savedAs}.`);
      }
      setSourceCsv(csv);
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setHistoryError("The payroll file was calculated, but your session expired before its history could be saved.");
        return;
      }
      const perHolidayHours = processed.totalHolidayHours / holidayCount;
      const { error: saveError } = await supabase.from("holiday_import_history").insert(holidays.map((holiday) => ({
        holiday_name: holiday.name.trim(),
        holiday_date: holiday.date,
        source_file: file.name,
        source_fingerprint: sourceFingerprint,
        source_rows: processed.sourceRowCount,
        unique_employees: processed.rows.length,
        combined_source_hours: processed.totalSourceHours,
        capped_at_eight: processed.cappedEmployeeCount,
        total_holiday_hours: perHolidayHours,
        processed_by: userData.user.id,
        processed_by_email: userData.user.email?.toLowerCase(),
      })));
      if (saveError) {
        setHistoryError("The payroll file was calculated, but its summary could not be saved to shared history.");
      } else {
        setHistoryMessage(`${holidays.length === 1 ? holidays[0].name : "Both holidays"} automatically saved to Holiday Hours History.`);
      }
    } catch (caught) {
      setFileName("");
      if (inputRef.current) inputRef.current.value = "";
      setError(caught instanceof Error ? caught.message : "The file could not be processed.");
    }
  }

  function changeHolidayCount(count: 1 | 2) {
    setHolidayCount(count);
    setHolidays(Array.from({ length: count }, () => ({ name: "", date: "" })));
    setSourceCsv("");
    setFileName("");
    setError("");
    setHistoryMessage("");
    setHistoryError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function updateHoliday(index: number, field: keyof HolidayDraft, value: string) {
    setHolidays((current) => current.map((holiday, holidayIndex) => holidayIndex === index
      ? { ...holiday, [field]: value }
      : holiday));
  }

  function downloadImport() {
    if (!result) return;
    const blob = new Blob([holidayHoursImportCsv(result.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "epihne23.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setSourceCsv("");
    setFileName("");
    setError("");
    setHistoryMessage("");
    setHistoryError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return <div className="payroll-tool-stack">
    <section className="panel payroll-upload-panel">
      <div>
        <h2>Upload employee hours</h2>
        <p>Select the unmodified CSV exported from the employee-hours report.</p>
      </div>
      <div className="payroll-upload-actions">
        <fieldset className="holiday-count-selector">
          <legend>Number of holidays</legend>
          <div>
            <button type="button" className={holidayCount === 1 ? "active" : ""} onClick={() => changeHolidayCount(1)}>1 Holiday</button>
            <button type="button" className={holidayCount === 2 ? "active" : ""} onClick={() => changeHolidayCount(2)}>2 Holidays</button>
          </div>
        </fieldset>
        <div className="holiday-preupload-fields">{holidays.map((holiday, index) => <div key={index}>
          <label>{holidayCount === 1 ? "Holiday name" : `Holiday ${index + 1} name`}<input type="text" value={holiday.name} placeholder={index === 0 ? "Christmas" : "New Year’s Day"} onChange={(event) => updateHoliday(index, "name", event.target.value)} /></label>
          <label>Date<input type="date" value={holiday.date} onChange={(event) => updateHoliday(index, "date", event.target.value)} /></label>
        </div>)}</div>
        <label className={`upload-button payroll-file-button ${holidays.some((holiday) => !holiday.name.trim() || !holiday.date) ? "disabled" : ""}`}>
          {fileName ? "Choose a different file" : "Choose source CSV"}
          <input ref={inputRef} type="file" accept=".csv,text/csv" disabled={holidays.some((holiday) => !holiday.name.trim() || !holiday.date)} onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void processFile(file);
          }} />
        </label>
      </div>
    </section>

    <details key={result ? "processed" : "preparing"} className="panel payroll-instructions" open={!result}>
      <summary>Written instructions</summary>
      <ol>
        <li><strong>Go to Reports &amp; Analytics.</strong></li>
        <li><strong>Open All Standard Reports.</strong></li>
        <li><strong>Select Employee Hours for Holiday Import File.</strong></li>
        <li><strong>Set Employee Information Effective Date As of.</strong> Choose the specific date needed for this holiday-hours calculation.</li>
        <li><strong>Select Run and download the report as a CSV.</strong> Do not rename or remove the Company Code, File Number, or Hours columns.</li>
        <li><strong>Select whether this import covers one or two holidays, then enter each holiday name and date.</strong> The file chooser becomes available after these details are complete. Two holidays doubles each employee’s calculated amount.</li>
        <li><strong>Upload the downloaded CSV above.</strong> The Hub adds every Hours row for the same employee, checks for duplicates, and automatically saves the summary to Holiday Hours History.</li>
        <li><strong>Review the results.</strong> Check the employee count, combined source hours, employees capped at 8.00, and several individual employees.</li>
        <li><strong>Download the import CSV.</strong> The file is named epihne23.csv and contains Co Code, Batch ID, File #, Hours 3 Code, and Hours 3 Amount.</li>
        <li><strong>In ADP, go to Payroll Dashboard.</strong> Select Manage Payroll, then go to Worksheets.</li>
        <li><strong>Select Import File and choose the downloaded CSV.</strong> Review the ADP import preview and any warnings before completing the import.</li>
      </ol>
      <div className="calculation-note">
        <strong>Calculation used</strong>
        <span>Total employee hours ÷ 2 ÷ 40 × 8, rounded to two decimals. Each holiday is capped at 8.00 hours. A two-holiday import doubles the result and has a 16.00-hour maximum.</span>
      </div>
      <p className="privacy-note"><strong>Private processing:</strong> The source file, employee rows, and calculated CSV remain in this browser. Only summary totals, holiday names, dates, and audit information are saved automatically.</p>
    </details>

    {error && <section className="panel payroll-error"><strong>File not processed</strong><span>{error}</span></section>}
    {(historyMessage || historyError) && <section className={`panel ${historyError ? "payroll-error" : "holiday-history-success"}`}><strong>{historyError ? "History not saved" : "History saved"}</strong><span>{historyError || historyMessage}</span></section>}

    {result && <>
      <section className="payroll-summary-grid" aria-label="Import summary">
        <article><span>Source rows</span><strong>{result.sourceRowCount.toLocaleString()}</strong></article>
        <article><span>Unique employees</span><strong>{result.rows.length.toLocaleString()}</strong></article>
        <article><span>Combined source hours</span><strong>{number(result.totalSourceHours)}</strong></article>
        <article><span>Capped at {holidayCount === 2 ? "16.00" : "8.00"}</span><strong>{result.cappedEmployeeCount.toLocaleString()}</strong></article>
        <article><span>Total holiday hours</span><strong>{number(result.totalHolidayHours)}</strong></article>
      </section>

      <section className="panel payroll-results">
        <div className="panel-heading payroll-result-heading">
          <div><p className="eyebrow">Step 2</p><h2>Review calculated hours</h2><span>{fileName} · {holidayCount} {holidayCount === 1 ? "holiday" : "holidays"}</span></div>
          <div className="payroll-result-actions"><button type="button" className="secondary-button" onClick={reset}>Start over</button><button type="button" className="upload-button" onClick={downloadImport}>Download import CSV</button></div>
        </div>
        <div className="table-scroll">
          <table className="data-table payroll-preview-table">
            <thead><tr><th>Co Code</th><th>Batch ID</th><th>File #</th><th>Hours 3 Code</th><th>Combined source hours</th><th>Source rows</th><th>Hours 3 Amount</th></tr></thead>
            <tbody>{previewRows.map((row) => <tr key={`${row.companyCode}-${row.fileNumber}`}>
              <td>HNE</td><td>Holiday</td><td>{row.fileNumber}</td><td>HOL</td><td>{number(row.totalHours)}</td><td>{row.sourceRows}</td><td><strong>{number(row.holidayHours)}</strong></td>
            </tr>)}</tbody>
          </table>
        </div>
        {result.rows.length > previewRows.length && <p className="payroll-preview-note">Showing the first {previewRows.length} employees. The downloaded CSV includes all {result.rows.length.toLocaleString()} employees.</p>}
      </section>
    </>}
  </div>;
}
