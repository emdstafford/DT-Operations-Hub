"use client";

import { useMemo, useRef, useState } from "react";
import {
  createHolidayHoursImport,
  holidayHoursImportCsv,
  type HolidayHoursImportResult,
} from "@/lib/holidayHoursImport";

function number(value: number, digits = 2) {
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function HolidayHoursImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sourceCsv, setSourceCsv] = useState("");
  const [holidayCount, setHolidayCount] = useState<1 | 2>(1);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const result = useMemo<HolidayHoursImportResult | null>(() => sourceCsv ? createHolidayHoursImport(sourceCsv, holidayCount) : null, [sourceCsv, holidayCount]);
  const previewRows = useMemo(() => result?.rows.slice(0, 50) ?? [], [result]);

  async function processFile(file: File) {
    setError("");
    setSourceCsv("");
    setFileName(file.name);
    try {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        throw new Error("Select the source report saved as a CSV file.");
      }
      const csv = await file.text();
      createHolidayHoursImport(csv, holidayCount);
      setSourceCsv(csv);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The file could not be processed.");
    }
  }

  function downloadImport() {
    if (!result) return;
    const blob = new Blob([holidayHoursImportCsv(result.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "Employee_Holiday_Hours_Import.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setSourceCsv("");
    setFileName("");
    setError("");
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
            <button type="button" className={holidayCount === 1 ? "active" : ""} onClick={() => setHolidayCount(1)}>1 Holiday</button>
            <button type="button" className={holidayCount === 2 ? "active" : ""} onClick={() => setHolidayCount(2)}>2 Holidays</button>
          </div>
        </fieldset>
        <label className="upload-button payroll-file-button">
          {fileName ? "Choose a different file" : "Choose source CSV"}
          <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void processFile(file);
          }} />
        </label>
      </div>
    </section>

    <section className="panel payroll-instructions">
      <ol>
        <li><strong>Go to Reports &amp; Analytics.</strong></li>
        <li><strong>Open All Standard Reports.</strong></li>
        <li><strong>Select Employee Hours for Holiday Import File.</strong></li>
        <li><strong>Set Employee Information Effective Date As of.</strong> Choose the specific date needed for this holiday-hours calculation.</li>
        <li><strong>Select Run and download the report as a CSV.</strong> Do not rename or remove the Company Code, File Number, or Hours columns.</li>
        <li><strong>Select whether this import covers one or two holidays.</strong> Two holidays doubles each employee’s calculated amount.</li>
        <li><strong>Upload the downloaded CSV above.</strong> The Hub adds every Hours row for the same employee, including rows from different pay codes or departments.</li>
        <li><strong>Review the results.</strong> Check the employee count, combined source hours, employees capped at 8.00, and several individual employees.</li>
        <li><strong>Download the import CSV.</strong> The file contains only Co Code, File #, and Hours 3 Amount.</li>
        <li><strong>In ADP, go to Worksheets.</strong></li>
        <li><strong>Select Import File and choose the downloaded CSV.</strong> Review the ADP import preview and any warnings before completing the import.</li>
      </ol>
      <div className="calculation-note">
        <strong>Calculation used</strong>
        <span>Total employee hours ÷ 2 ÷ 40 × 8, rounded to two decimals. Each holiday is capped at 8.00 hours. A two-holiday import doubles the result and has a 16.00-hour maximum.</span>
      </div>
      <p className="privacy-note"><strong>Private processing:</strong> The source file and calculated file remain in this browser. The Hub does not save payroll contents to shared report history.</p>
    </section>

    {error && <section className="panel payroll-error"><strong>File not processed</strong><span>{error}</span></section>}

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
            <thead><tr><th>Co Code</th><th>File #</th><th>Combined source hours</th><th>Source rows</th><th>Hours 3 Amount</th></tr></thead>
            <tbody>{previewRows.map((row) => <tr key={`${row.companyCode}-${row.fileNumber}`}>
              <td>{row.companyCode}</td><td>{row.fileNumber}</td><td>{number(row.totalHours)}</td><td>{row.sourceRows}</td><td><strong>{number(row.holidayHours)}</strong></td>
            </tr>)}</tbody>
          </table>
        </div>
        {result.rows.length > previewRows.length && <p className="payroll-preview-note">Showing the first {previewRows.length} employees. The downloaded CSV includes all {result.rows.length.toLocaleString()} employees.</p>}
      </section>
    </>}
  </div>;
}
