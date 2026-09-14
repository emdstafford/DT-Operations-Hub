"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { parseUspsSchedule, type ScheduleAnalysis } from "@/lib/parseUspsSchedule";

type IntakeKind = "source" | "simplified" | "driver" | "rates";
type Intake = { name: string; size: number; file: File; sheets?: string[]; truckSheets?: number; tripRows?: number; parkingLocations?: string[] };

const slots: Array<{ kind: IntakeKind; title: string; help: string; accept: string; sensitive?: boolean }> = [
  { kind: "source", title: "Official USPS schedule", help: "Trip, stop, frequency, mileage, hours, and effective-date source", accept: ".pdf" },
  { kind: "simplified", title: "Existing simplified schedule", help: "Optional comparison file used to validate the current approved layout", accept: ".xlsx,.xlsm,.xls" },
  { kind: "driver", title: "Driver schedule", help: "Optional driver letters, colors, truck assignments, and parking groups", accept: ".xlsx,.xlsm,.xls" },
  { kind: "rates", title: "Signature and rate page", help: "Restricted financial source—visible only to authorized rate users", accept: ".pdf", sensitive: true },
];

function fileSize(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function ScheduleBuilder() {
  const [files, setFiles] = useState<Partial<Record<IntakeKind, Intake>>>({});
  const [contract, setContract] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [analysis, setAnalysis] = useState<ScheduleAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const ready = Boolean(files.source && contract && effectiveDate);
  const workbookSheets = useMemo(() => Object.values(files).flatMap((file) => file?.sheets || []), [files]);

  async function choose(kind: IntakeKind, file?: File) {
    if (!file) return;
    let sheets: string[] | undefined;
    let truckSheets: number | undefined;
    let tripRows: number | undefined;
    let parkingLocations: string[] | undefined;
    if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      sheets = workbook.SheetNames;
      truckSheets = sheets.filter((name) => /^TRUCK\s+\d+/i.test(name.trim())).length;
      if (kind === "driver") {
        const sheet = workbook.Sheets[sheets[0]];
        const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: false });
        tripRows = rows.filter((row) => /^\d+$/.test(String(row[1] || "").trim())).length;
        parkingLocations = [...new Set(rows.map((row) => String(row[0] || "").trim()).filter((value) => /parking/i.test(value)))];
      }
    }
    setFiles((current) => ({ ...current, [kind]: { name: file.name, size: file.size, file, sheets, truckSheets, tripRows, parkingLocations } }));
    setAnalysis(null);
    if (kind === "source") {
      const match = file.name.match(/\b(\d{4}[A-Z])\b/i);
      if (match) setContract(match[1].toUpperCase());
      const date = file.name.match(/(?:eff(?:ective)?\s*)?(\d{1,2})[\s/_-]+([A-Za-z]{3}|\d{1,2})[\s/_-]+(20\d{2})/i);
      if (date && /^\d+$/.test(date[2])) setEffectiveDate(`${date[3]}-${date[1].padStart(2, "0")}-${date[2].padStart(2, "0")}`);
    }
  }

  async function analyze() {
    const source = files.source?.file;
    if (!source) return;
    setAnalyzing(true);
    setAnalysisError("");
    try {
      const result = await parseUspsSchedule(source);
      setAnalysis(result);
      if (result.contractNumber) setContract(result.contractNumber);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "The PDF could not be analyzed.");
    } finally {
      setAnalyzing(false);
    }
  }

  return <div className="schedule-builder-grid">
    <section className="panel schedule-intake">
      <div className="section-heading"><div><p className="eyebrow">Step 1</p><h2>Collect the schedule sources</h2></div><span className="local-only-badge">Private review</span></div>
      <p className="security-note"><strong>Files remain on this device in this version.</strong> Nothing is uploaded or stored until DT’s private document storage and employee permissions are installed.</p>
      <div className="schedule-upload-grid">
        {slots.map((slot) => <label className={`schedule-upload-card ${slot.sensitive ? "restricted" : ""}`} key={slot.kind}>
          <input type="file" accept={slot.accept} onChange={(event) => void choose(slot.kind, event.target.files?.[0])} />
          <span className="upload-card-title">{slot.title}</span>
          <span>{slot.help}</span>
          {slot.sensitive && <em>Restricted access</em>}
          {files[slot.kind] ? <strong className="selected-file">✓ {files[slot.kind]?.name} · {fileSize(files[slot.kind]?.size || 0)}</strong> : <strong>Choose file</strong>}
        </label>)}
      </div>
    </section>

    <section className="panel schedule-version">
      <div className="section-heading"><div><p className="eyebrow">Step 2</p><h2>Identify this version</h2></div></div>
      <div className="schedule-fields">
        <label>Contract<input value={contract} onChange={(event) => setContract(event.target.value.toUpperCase())} placeholder="Contract number" /></label>
        <label>Effective date<input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></label>
        <label>Change type<select defaultValue="service-change"><option value="base">Base schedule</option><option value="service-change">SV / service change</option><option value="correction">Correction</option></select></label>
      </div>
      <p className="version-rule">A new effective date creates a new schedule version. It never overwrites the trips that were active before that date.</p>
    </section>

    <section className="panel schedule-validation">
      <div className="section-heading"><div><p className="eyebrow">Step 3</p><h2>Accuracy review</h2></div><span className={ready ? "review-ready" : "review-waiting"}>{ready ? "Ready to analyze" : "Needs source details"}</span></div>
      <div className="validation-list">
        <div><strong>Frequency expansion</strong><span>Use the contract’s reference definitions to map each frequency to actual service days. Unknown codes stop the review.</span></div>
        <div><strong>Effective-date comparison</strong><span>Show added, removed, and changed stops, miles, hours, and operating days against the prior version.</span></div>
        <div><strong>Parking and driver keys</strong><span>Keep parking location with each driver letter because letters may restart at different parking groups.</span></div>
        <div><strong>Human approval</strong><span>An authorized schedule reviewer checks the generated truck sheets before a schedule can become Approved or be used for dispatch-system entry.</span></div>
      </div>
      {workbookSheets.length > 0 && <div className="detected-sheets"><strong>Workbook tabs detected</strong><span>{workbookSheets.join(" · ")}</span></div>}
      <button className="primary-link schedule-action" type="button" disabled={!ready || analyzing} onClick={() => void analyze()}>{analyzing ? "Analyzing on this device…" : "Analyze schedule for review"}</button>
      {analysisError && <p className="analysis-error">{analysisError}</p>}
      {analysis && <div className="analysis-results">
        <div className="analysis-result-heading"><div><p className="eyebrow">Initial reconciliation</p><h3>{analysis.warnings.length ? "Review required" : "Source recognized"}</h3></div><span className={analysis.warnings.length ? "review-waiting" : "review-ready"}>{analysis.warnings.length ? `${analysis.warnings.length} warning${analysis.warnings.length === 1 ? "" : "s"}` : "Checks passed"}</span></div>
        <div className="analysis-metrics"><div><span>PDF pages</span><strong>{analysis.pageCount}</strong></div><div><span>Trips found</span><strong>{analysis.tripIds.length}</strong></div><div><span>Frequency codes</span><strong>{analysis.frequencyCodes.length}</strong></div><div><span>Effective dates</span><strong>{analysis.effectiveDates.length}</strong></div></div>
        <dl className="analysis-details"><div><dt>Contract</dt><dd>{analysis.contractNumber || "Not confirmed"}</dd></div><div><dt>Trips</dt><dd>{analysis.tripIds.join(", ") || "None confirmed"}</dd></div><div><dt>Frequencies</dt><dd>{analysis.frequencyCodes.map((item) => `${item.code} (${item.description})`).join(" · ") || "None confirmed"}</dd></div><div><dt>Dates found</dt><dd>{analysis.effectiveDates.join(" · ") || "None confirmed"}</dd></div><div><dt>Annual schedule</dt><dd>{analysis.annualMiles == null ? "Miles not confirmed" : `${analysis.annualMiles.toLocaleString()} miles`} · {analysis.annualHours == null ? "Hours not confirmed" : `${analysis.annualHours.toLocaleString()} hours`}</dd></div><div><dt>Change summary</dt><dd>{analysis.changeSummaryFound ? "Found" : "Not found"}</dd></div></dl>
        {(files.simplified || files.driver) && <div className="comparison-summary"><strong>Comparison files</strong><span>{files.simplified?.truckSheets ?? 0} simplified truck tabs · {files.driver?.tripRows ?? 0} driver-schedule trip rows · {files.driver?.parkingLocations?.length ?? 0} named parking groups</span></div>}
        {analysis.warnings.map((warning) => <p className="analysis-warning" key={warning}>⚠ {warning}</p>)}
        <p className="coming-note">This is an intake check, not an approved schedule. Full stop-by-stop and cost reconciliation is required before approval.</p>
      </div>}
    </section>

    <aside className="panel schedule-output">
      <p className="eyebrow">Planned output</p><h2>One approved schedule, several views</h2>
      <ul><li>Simplified truck sheets</li><li>Day-by-day driver grid</li><li>Parking-location and equipment plan</li><li>SV impact on annual miles, hours, and cost</li><li>Version history with reviewer and approval date</li></ul>
      <div className="schedule-status"><span>Draft</span><span>Reviewed</span><span>Approved</span></div>
    </aside>
  </div>;
}
