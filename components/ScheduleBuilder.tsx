"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { parseUspsSchedule, type ScheduleAnalysis } from "@/lib/parseUspsSchedule";
import { parseScannedUspsSchedule, type OcrProgress, type OcrScheduleAnalysis } from "@/lib/parseScannedUspsSchedule";

type IntakeKind = "source" | "simplified" | "driver" | "rates";
type Intake = { name: string; size: number; file: File; sheets?: string[]; truckSheets?: number; tripRows?: number; parkingLocations?: string[] };

const slots: Array<{ kind: IntakeKind; title: string; help: string; accept: string; sensitive?: boolean }> = [
  { kind: "source", title: "Official revised USPS schedule", help: "The current searchable PDF used for trips, stops, frequencies, mileage, hours, and effective dates", accept: ".pdf" },
  { kind: "simplified", title: "Existing simplified schedule", help: "Optional comparison file used to validate the current approved layout", accept: ".xlsx,.xlsm,.xls" },
  { kind: "driver", title: "Driver schedule", help: "Optional driver letters, colors, truck assignments, and parking groups", accept: ".xlsx,.xlsm,.xls" },
  { kind: "rates", title: "Original signed schedule packet", help: "Restricted scanned packet containing the original schedule and rate/signature pages", accept: ".pdf", sensitive: true },
];

function fileSize(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function listDifference(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

export default function ScheduleBuilder() {
  const [files, setFiles] = useState<Partial<Record<IntakeKind, Intake>>>({});
  const [contract, setContract] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [analysis, setAnalysis] = useState<ScheduleAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [firstOriginalPage, setFirstOriginalPage] = useState(5);
  const [lastOriginalPage, setLastOriginalPage] = useState(27);
  const [originalRotation, setOriginalRotation] = useState(90);
  const [pageRangeConfirmed, setPageRangeConfirmed] = useState(false);
  const [originalAnalysis, setOriginalAnalysis] = useState<OcrScheduleAnalysis | null>(null);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [readingOriginal, setReadingOriginal] = useState(false);
  const [originalError, setOriginalError] = useState("");
  const ready = Boolean(files.source && contract && effectiveDate);
  const workbookSheets = useMemo(() => Object.values(files).flatMap((file) => file?.sheets || []), [files]);

  const comparison = useMemo(() => {
    if (!analysis || !originalAnalysis) return null;
    const originalFrequencyCodes = originalAnalysis.frequencyCodes.map((item) => item.code);
    const revisedFrequencyCodes = analysis.frequencyCodes.map((item) => item.code);
    return {
      addedTrips: listDifference(analysis.tripIds, originalAnalysis.tripIds),
      removedTrips: listDifference(originalAnalysis.tripIds, analysis.tripIds),
      addedFrequencies: listDifference(revisedFrequencyCodes, originalFrequencyCodes),
      removedFrequencies: listDifference(originalFrequencyCodes, revisedFrequencyCodes),
      milesDelta: analysis.annualMiles != null && originalAnalysis.annualMiles != null ? analysis.annualMiles - originalAnalysis.annualMiles : null,
      hoursDelta: analysis.annualHours != null && originalAnalysis.annualHours != null ? analysis.annualHours - originalAnalysis.annualHours : null,
      contractMismatch: Boolean(analysis.contractNumber && originalAnalysis.contractNumber && analysis.contractNumber !== originalAnalysis.contractNumber),
    };
  }, [analysis, originalAnalysis]);

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
    setFiles((currentFiles) => ({ ...currentFiles, [kind]: { name: file.name, size: file.size, file, sheets, truckSheets, tripRows, parkingLocations } }));
    if (kind === "source") setAnalysis(null);
    if (kind === "rates") {
      setOriginalAnalysis(null);
      setPageRangeConfirmed(false);
    }
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

  async function analyzeOriginal() {
    const source = files.rates?.file;
    if (!source || !pageRangeConfirmed) return;
    setReadingOriginal(true);
    setOriginalError("");
    setOriginalAnalysis(null);
    try {
      const result = await parseScannedUspsSchedule(source, firstOriginalPage, lastOriginalPage, originalRotation, setOcrProgress);
      setOriginalAnalysis(result);
    } catch (error) {
      setOriginalError(error instanceof Error ? error.message : "The original schedule pages could not be read.");
    } finally {
      setReadingOriginal(false);
      setOcrProgress(null);
    }
  }

  return <div className="schedule-builder-grid">
    <section className="panel schedule-intake">
      <div className="section-heading"><div><p className="eyebrow">Step 1</p><h2>Collect the schedule sources</h2></div><span className="local-only-badge">Private review</span></div>
      <p className="security-note"><strong>Files remain on this device.</strong> Schedule and rate documents are read in your browser. They are not uploaded to GitHub, Supabase, or an OCR service.</p>
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
      <div className="section-heading"><div><p className="eyebrow">Step 3</p><h2>Revised schedule intake</h2></div><span className={ready ? "review-ready" : "review-waiting"}>{ready ? "Ready to analyze" : "Needs source details"}</span></div>
      <div className="validation-list">
        <div><strong>Frequency expansion</strong><span>Use the contract’s definitions to map each frequency to actual service days. Unknown codes stop the review.</span></div>
        <div><strong>Effective-date comparison</strong><span>Show added, removed, and changed stops, miles, hours, and operating days against the prior version.</span></div>
        <div><strong>Parking and driver keys</strong><span>Keep parking location with each driver letter because letters may restart at different parking groups.</span></div>
        <div><strong>Human approval</strong><span>An authorized reviewer checks every generated truck sheet before the schedule becomes Approved.</span></div>
      </div>
      {workbookSheets.length > 0 && <div className="detected-sheets"><strong>Workbook tabs detected</strong><span>{workbookSheets.join(" · ")}</span></div>}
      <button className="primary-link schedule-action" type="button" disabled={!ready || analyzing} onClick={() => void analyze()}>{analyzing ? "Analyzing on this device…" : "Analyze revised schedule"}</button>
      {analysisError && <p className="analysis-error">{analysisError}</p>}
      {analysis && <div className="analysis-results">
        <div className="analysis-result-heading"><div><p className="eyebrow">Initial reconciliation</p><h3>{analysis.warnings.length ? "Review required" : "Source recognized"}</h3></div><span className={analysis.warnings.length ? "review-waiting" : "review-ready"}>{analysis.warnings.length ? `${analysis.warnings.length} warning${analysis.warnings.length === 1 ? "" : "s"}` : "Checks passed"}</span></div>
        <div className="analysis-metrics"><div><span>PDF pages</span><strong>{analysis.pageCount}</strong></div><div><span>Trips found</span><strong>{analysis.tripIds.length}</strong></div><div><span>Frequency codes</span><strong>{analysis.frequencyCodes.length}</strong></div><div><span>Effective dates</span><strong>{analysis.effectiveDates.length}</strong></div></div>
        <dl className="analysis-details"><div><dt>Contract</dt><dd>{analysis.contractNumber || "Not confirmed"}</dd></div><div><dt>Trips</dt><dd>{analysis.tripIds.join(", ") || "None confirmed"}</dd></div><div><dt>Frequencies</dt><dd>{analysis.frequencyCodes.map((item) => `${item.code} (${item.description})`).join(" · ") || "None confirmed"}</dd></div><div><dt>Dates found</dt><dd>{analysis.effectiveDates.join(" · ") || "None confirmed"}</dd></div><div><dt>Annual schedule</dt><dd>{analysis.annualMiles == null ? "Miles not confirmed" : `${analysis.annualMiles.toLocaleString()} miles`} · {analysis.annualHours == null ? "Hours not confirmed" : `${analysis.annualHours.toLocaleString()} hours`}</dd></div><div><dt>Change summary</dt><dd>{analysis.changeSummaryFound ? "Found" : "Not found"}</dd></div></dl>
        {(files.simplified || files.driver) && <div className="comparison-summary"><strong>Comparison files</strong><span>{files.simplified?.truckSheets ?? 0} simplified truck tabs · {files.driver?.tripRows ?? 0} driver-schedule trip rows · {files.driver?.parkingLocations?.length ?? 0} named parking groups</span></div>}
        {analysis.warnings.map((warning) => <p className="analysis-warning" key={warning}>⚠ {warning}</p>)}
      </div>}
    </section>

    <section className="panel original-reconciliation">
      <div className="section-heading"><div><p className="eyebrow">Step 4</p><h2>Read the original schedule pages</h2></div><span className="restricted-badge">Restricted document</span></div>
      <p className="security-note"><strong>Select only the original schedule pages.</strong> Do not include cover, signature, banking, or rate-only pages. The page range and rotation must be checked against this exact PDF before running OCR.</p>
      <div className="page-range-fields">
        <label>First schedule page<input type="number" min="1" value={firstOriginalPage} onChange={(event) => { setFirstOriginalPage(Number(event.target.value)); setPageRangeConfirmed(false); }} /></label>
        <label>Last schedule page<input type="number" min="1" value={lastOriginalPage} onChange={(event) => { setLastOriginalPage(Number(event.target.value)); setPageRangeConfirmed(false); }} /></label>
        <label>Turn scanned pages<select value={originalRotation} onChange={(event) => { setOriginalRotation(Number(event.target.value)); setPageRangeConfirmed(false); }}><option value={90}>90° clockwise</option><option value={270}>90° counterclockwise</option><option value={180}>180°</option><option value={0}>No rotation</option></select></label>
      </div>
      <label className="range-confirmation"><input type="checkbox" checked={pageRangeConfirmed} onChange={(event) => setPageRangeConfirmed(event.target.checked)} /><span>I checked the PDF and confirm pages 5–27 contain schedule/location information only, with no signature or rate-only pages, and the selected rotation makes them readable.</span></label>
      <button className="primary-link schedule-action" type="button" disabled={!files.rates || !analysis || !pageRangeConfirmed || readingOriginal} onClick={() => void analyzeOriginal()}>{readingOriginal ? "Reading original schedule locally…" : "Compare original to revised schedule"}</button>
      {!analysis && files.rates && <p className="coming-note">Analyze the revised USPS schedule in Step 3 first.</p>}
      {ocrProgress && <div className="ocr-progress"><div><strong>PDF page {ocrProgress.page}</strong><span>{ocrProgress.status}</span></div><progress max="1" value={ocrProgress.progress} /></div>}
      {originalError && <p className="analysis-error">{originalError}</p>}
      {originalAnalysis && <div className="analysis-results">
        <div className="analysis-result-heading"><div><p className="eyebrow">Original schedule OCR</p><h3>{originalAnalysis.lowConfidence ? "Manual verification required" : "Pages recognized"}</h3></div><span className={originalAnalysis.lowConfidence ? "review-waiting" : "review-ready"}>{originalAnalysis.averageConfidence.toFixed(1)}% OCR confidence</span></div>
        <div className="analysis-metrics"><div><span>Pages read</span><strong>{originalAnalysis.pagesProcessed.length}</strong></div><div><span>Trip candidates</span><strong>{originalAnalysis.tripIds.length}</strong></div><div><span>Frequency codes</span><strong>{originalAnalysis.frequencyCodes.length}</strong></div><div><span>Contract</span><strong>{originalAnalysis.contractNumber || "?"}</strong></div></div>
        {comparison && !originalAnalysis.lowConfidence && <div className="schedule-difference-grid">
          <div className={comparison.contractMismatch ? "difference-alert" : ""}><span>Contract check</span><strong>{comparison.contractMismatch ? `Mismatch: ${originalAnalysis.contractNumber} / ${analysis?.contractNumber}` : "Matches"}</strong></div>
          <div className="difference-alert"><span>Trip comparison</span><strong>Withheld pending row-by-row validation</strong><small>{originalAnalysis.tripIds.length} OCR candidates{files.driver?.tripRows ? ` · ${files.driver.tripRows} driver-schedule rows` : ""}. Values such as vehicle code 200 are not accepted as trips.</small></div>
          <div><span>Frequency changes</span><strong>{[...comparison.addedFrequencies.map((code) => `+${code}`), ...comparison.removedFrequencies.map((code) => `−${code}`)].join(", ") || "None detected"}</strong></div>
          <div><span>Original annual miles</span><strong>{originalAnalysis.annualMiles == null ? "Not confirmed" : originalAnalysis.annualMiles.toLocaleString()}</strong></div>
          <div><span>Revised annual miles</span><strong>{analysis?.annualMiles == null ? "Not confirmed" : analysis.annualMiles.toLocaleString()}</strong></div>
          <div><span>Annual miles change</span><strong>{comparison.milesDelta == null ? "Not confirmed" : comparison.milesDelta.toLocaleString(undefined, { maximumFractionDigits: 2, signDisplay: "always" })}</strong></div>
          <div><span>Original annual hours</span><strong>{originalAnalysis.annualHours == null ? "Not confirmed" : originalAnalysis.annualHours.toLocaleString()}</strong></div>
          <div><span>Revised annual hours</span><strong>{analysis?.annualHours == null ? "Not confirmed" : analysis.annualHours.toLocaleString()}</strong></div>
          <div><span>Annual hours change</span><strong>{comparison.hoursDelta == null ? "Not confirmed" : comparison.hoursDelta.toLocaleString(undefined, { maximumFractionDigits: 2, signDisplay: "always" })}</strong></div>
        </div>}
        {originalAnalysis.lowConfidence && <p className="analysis-error"><strong>No trip, frequency, mileage, or hour differences are accepted from this run.</strong> Numeric OCR candidates may be miles, times, or NASS values rather than trip numbers.</p>}
        {originalAnalysis.warnings.map((warning) => <p className="analysis-warning" key={warning}>⚠ {warning}</p>)}
        <p className="approval-blocker"><strong>Approval remains blocked.</strong> The next reconciliation stage must verify each stop’s name, address, NASS code, arrival/departure time, frequency, mileage, and vehicle requirement.</p>
      </div>}
    </section>

    <aside className="panel schedule-output">
      <p className="eyebrow">Planned output</p><h2>One approved schedule, several views</h2>
      <ul><li>Simplified truck sheets</li><li>Day-by-day driver grid</li><li>Parking-location and equipment plan</li><li>SV impact on annual miles, hours, and cost</li><li>Version history with reviewer and approval date</li></ul>
      <div className="schedule-status"><span>Draft</span><span>Reviewed</span><span>Approved</span></div>
    </aside>
  </div>;
}
