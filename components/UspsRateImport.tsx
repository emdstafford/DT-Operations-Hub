"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

type PreviewSheet = {
  sheetName: string;
  contractNumber: string;
  rows: number;
  status: "ready" | "review";
  note?: string;
};

const CONTRACT_RE = /^\d{3,6}[A-Z]\d?$/i;

function normalizeContract(sheetName: string) {
  const match = sheetName.toUpperCase().match(/\b\d{3,6}[A-Z]\d?\b/);
  return match?.[0] ?? sheetName.trim().toUpperCase();
}

function nonEmptyRows(sheet: XLSX.WorkSheet) {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  return rows.filter((row) => Array.isArray(row) && row.some((cell) => cell !== null && String(cell).trim() !== ""));
}

export default function UspsRateImport() {
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<PreviewSheet[]>([]);
  const [error, setError] = useState("");
  const totals = useMemo(() => ({
    contracts: sheets.length,
    rows: sheets.reduce((sum, sheet) => sum + sheet.rows, 0),
    review: sheets.filter((sheet) => sheet.status === "review").length,
  }), [sheets]);

  async function preview(file?: File) {
    if (!file) return;
    setError("");
    setFileName(file.name);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const previewSheets = workbook.SheetNames.map((sheetName) => {
        const contractNumber = normalizeContract(sheetName);
        const rows = nonEmptyRows(workbook.Sheets[sheetName]);
        const termination = rows.flat().map(String).find((value) => /TERM|TERMINAT/i.test(value));
        const validContract = CONTRACT_RE.test(contractNumber);
        return {
          sheetName,
          contractNumber,
          rows: Math.max(0, rows.length - 1),
          status: validContract ? "ready" : "review",
          note: termination ? termination.slice(0, 90) : (!validContract ? "Contract number needs review" : undefined),
        } satisfies PreviewSheet;
      });
      setSheets(previewSheets);
    } catch {
      setSheets([]);
      setError("I could not read that workbook. Please use the original USPS Excel file (.xlsx or .xls).");
    }
  }

  return <section className="hub-card no-print" style={{marginTop:24}}>
    <div className="section-heading">
      <div>
        <p className="eyebrow">USPS contract financials</p>
        <h2>Import USPS Rates</h2>
        <p>Preview the workbook first. Nothing is written to the database until the rate structure is validated.</p>
      </div>
    </div>

    <label className="hub-secondary-link" style={{display:"inline-block",cursor:"pointer"}}>
      Choose USPS workbook
      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={(event) => preview(event.target.files?.[0])}
        style={{display:"none"}}
      />
    </label>

    {error && <p role="alert" style={{marginTop:16}}>{error}</p>}

    {sheets.length > 0 && <>
      <div className="summary-grid" style={{marginTop:20}}>
        <div className="summary-card"><span>Workbook</span><strong>{fileName}</strong></div>
        <div className="summary-card"><span>Contract sheets</span><strong>{totals.contracts}</strong></div>
        <div className="summary-card"><span>Rows found</span><strong>{totals.rows.toLocaleString()}</strong></div>
        <div className="summary-card"><span>Needs review</span><strong>{totals.review}</strong></div>
      </div>

      <div style={{overflowX:"auto",marginTop:20}}>
        <table className="data-table">
          <thead><tr><th>Sheet</th><th>Contract</th><th>Rows</th><th>Status</th><th>Note</th></tr></thead>
          <tbody>
            {sheets.map((sheet) => <tr key={sheet.sheetName}>
              <td>{sheet.sheetName}</td>
              <td><strong>{sheet.contractNumber}</strong></td>
              <td>{sheet.rows.toLocaleString()}</td>
              <td>{sheet.status === "ready" ? "Ready" : "Review"}</td>
              <td>{sheet.note ?? "—"}</td>
            </tr>)}
          </tbody>
        </table>
      </div>

      <p style={{marginTop:16}}>
        Preview only for now — the next step maps the USPS column headings into the effective-dated trip-rate records before Save is enabled.
      </p>
    </>}
  </section>;
}
