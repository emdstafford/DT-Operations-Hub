"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { parseUspsSchedule, type ScheduleAnalysis } from "@/lib/parseUspsSchedule";
import { parseScannedUspsSchedule, type OcrProgress, type OcrScheduleAnalysis } from "@/lib/parseScannedUspsSchedule";
import ScheduleTripReconciliation from "@/components/ScheduleTripReconciliation";

type IntakeKind = "source" | "simplified" | "driver" | "rates";
type Intake = { name: string; size: number; file: File; sheets?: string[]; truckSheets?: number; tripRows?: number; parkingLocations?: string[] };
type ServiceChangeDraft = { id: string; name: string; size: number; file: File; effectiveDates: string; affectedTrips: string; newTrips: string; status: "Draft" };

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

const monthNumbers: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

function dateFromParts(day: string, month: string, year: string) {
  const fullYear = year.length === 2 ? `20${year}` : year;
  return `${fullYear}-${monthNumbers[month.slice(0, 3).toLowerCase()]}-${day.padStart(2, "0")}`;
}

function inferChangeDetails(file: File): ServiceChangeDraft {
  const readable = file.name.replaceAll("_", " ").replaceAll("-", " ").replace(/\s+/g, " ");
  const dates = new Set<string>();
  for (const match of readable.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2}|\d{2})\b/g)) {
    if (monthNumbers[match[2].slice(0, 3).toLowerCase()]) dates.add(dateFromParts(match[1], match[2], match[3]));
  }
  for (const match of readable.matchAll(/\b(\d{1,2})\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2}|\d{2})\b/g)) {
    if (monthNumbers[match[3].slice(0, 3).toLowerCase()]) {
      dates.add(dateFromParts(match[1], match[3], match[4]));
      dates.add(dateFromParts(match[2], match[3], match[4]));
    }
  }
  const affectedSection = readable.match(/Trips?\s+(.+?)(?:New\s+Trips?|Eff|Effective|Signed|$)/i)?.[1] || "";
  const newSection = readable.match(/New\s+Trips?\s+(.+?)(?:Eff|Effective|Signed|$)/i)?.[1] || "";
  const numbers = (value: string) => [...value.matchAll(/\b\d{1,3}\b/g)].map((match) => String(Number(match[0]))).join(", ");
  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    size: file.size,
    file,
    effectiveDates: [...dates].sort().join(", "),
    affectedTrips: numbers(affectedSection),
    newTrips: numbers(newSection),
    status: "Draft",
  };
}

export default function ScheduleBuilder() {
  const [files, setFiles] = useState<Partial<Record<IntakeKind, Intake>>>({});
  const [serviceChanges, setServiceChanges] = useState<ServiceChangeDraft[]>([]);
  const [originalEffectiveDate, setOriginalEffectiveDate] = useState("");
  const [contract, setContract] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [analysis, setAnalysis] = useState<ScheduleAnalysis | null>(null);
  const [revisedOcr, setRevisedOcr] = useState<OcrScheduleAnalysis | null>(null);
  const [scannedFirstPage, setScannedFirstPage] = useState(1);
  const [scannedLastPage, setScannedLastPage] = useState(1);
  const [scannedRotation, setScannedRotation] = useState(0);
  const [scannedRangeConfirmed, setScannedRangeConfirmed] = useState(false);
  const [readingRevised, setReadingRevised] = useState(false);
  const [revisedProgress, setRevisedProgress] = useState<OcrProgress | null>(null);
  const [otherSchedules, setOtherSchedules] = useState<File[]>([]);
  const [otherAnalyses, setOtherAnalyses] = useState<Array<{ name: string; result?: ScheduleAnalysis; error?: string }>>([]);
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
  const [verifiedOriginalMiles, setVerifiedOriginalMiles] = useState("");
  const [verifiedOriginalHours, setVerifiedOriginalHours] = useState("");
  const [totalsConfirmed, setTotalsConfirmed] = useState(false);
  const ready = Boolean(files.source && contract && effectiveDate);
  const confirmedOriginalMiles = totalsConfirmed && verifiedOriginalMiles.trim() !== "" && Number.isFinite(Number(verifiedOriginalMiles.replaceAll(",", ""))) ? Number(verifiedOriginalMiles.replaceAll(",", "")) : null;
  const confirmedOriginalHours = totalsConfirmed && verifiedOriginalHours.trim() !== "" && Number.isFinite(Number(verifiedOriginalHours.replaceAll(",", ""))) ? Number(verifiedOriginalHours.replaceAll(",", "")) : null;
  const workbookSheets = useMemo(() => Object.values(files).flatMap((file) => file?.sheets || []), [files]);
  const timelineEvents = useMemo(() => {
    const events = new Map<string, { date: string; affectedTrips: Set<string>; newTrips: Set<string>; exhibits: number }>();
    serviceChanges.forEach((change) => {
      const dates = change.effectiveDates.split(",").map((value) => value.trim()).filter(Boolean);
      (dates.length ? dates : ["Date required"]).forEach((date) => {
        const event = events.get(date) ?? { date, affectedTrips: new Set<string>(), newTrips: new Set<string>(), exhibits: 0 };
        change.affectedTrips.split(",").map((value) => value.trim()).filter(Boolean).forEach((trip) => event.affectedTrips.add(trip));
        change.newTrips.split(",").map((value) => value.trim()).filter(Boolean).forEach((trip) => event.newTrips.add(trip));
        event.exhibits += 1;
        events.set(date, event);
      });
    });
    return [...events.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [serviceChanges]);

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

  function chooseServiceChanges(selected: FileList | null) {
    if (!selected) return;
    const additions = Array.from(selected).filter((file) => /\.pdf$/i.test(file.name)).map(inferChangeDetails);
    setServiceChanges((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      additions.forEach((item) => byId.set(item.id, item));
      return [...byId.values()];
    });
  }

  function updateServiceChange(id: string, field: "effectiveDates" | "affectedTrips" | "newTrips", value: string) {
    setServiceChanges((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));
  }

  async function choose(kind: IntakeKind, file?: File) {
    if (!file) return;
    let sheets: string[] | undefined;
    let truckSheets: number | undefined;
    let tripRows: number | undefined;
    let parkingLocations: string[] | undefined;
    if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      if (kind === "simplified") {
        const baseline = file.name.match(/(?:effective|eff)\s*(\d{1,2})[\s_-]+(\d{1,2})[\s_-]+(\d{2,4})/i);
        if (baseline) setOriginalEffectiveDate(dateFromParts(baseline[2], "Jan", baseline[3]).replace("-01-", `-${baseline[1].padStart(2, "0")}-`));
      }
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
    if (kind === "source") { setAnalysis(null); setRevisedOcr(null); setOtherAnalyses([]); setScannedRangeConfirmed(false); }
    if (kind === "rates") {
      setOriginalAnalysis(null);
      setPageRangeConfirmed(false);
      setVerifiedOriginalMiles("");
      setVerifiedOriginalHours("");
      setTotalsConfirmed(false);
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
      setRevisedOcr(null);
      setScannedLastPage(result.pageCount);
      const references: Array<{ name: string; result?: ScheduleAnalysis; error?: string }> = [];
      for (const file of otherSchedules) {
        try {
          references.push({ name: file.name, result: await parseUspsSchedule(file) });
        } catch (error) {
          references.push({ name: file.name, error: error instanceof Error ? error.message : "This PDF could not be read." });
        }
      }
      setOtherAnalyses(references);
      if (result.contractNumber) setContract(result.contractNumber);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "The PDF could not be analyzed.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function analyzeScannedRevised() {
    const source = files.source?.file;
    if (!source || !scannedRangeConfirmed) return;
    setReadingRevised(true);
    setAnalysisError("");
    try {
      const result = await parseScannedUspsSchedule(source, scannedFirstPage, scannedLastPage, scannedRotation, setRevisedProgress);
      setRevisedOcr(result);
      setAnalysis(result);
      if (result.contractNumber) setContract(result.contractNumber);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "The scanned schedule could not be read.");
    } finally {
      setReadingRevised(false);
      setRevisedProgress(null);
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
      <div className="service-change-intake">
        <div><span className="upload-card-title">Other official schedule versions</span><p>Optional: select multiple searchable USPS schedule PDFs for the same contract. Each file is read separately, with its own stated annual miles and page number. Keep scanned signed/rate packets in the restricted original slot above.</p></div>
        <label className="hub-secondary-link"><input type="file" accept=".pdf" multiple onChange={(event) => {
          const selected = Array.from(event.target.files || []).filter((file) => /\.pdf$/i.test(file.name));
          setOtherSchedules(selected);
          setOtherAnalyses([]);
        }} />Choose other versions</label>
      </div>
      {otherSchedules.length > 0 && <p className="coming-note">Other versions: {otherSchedules.map((file) => file.name).join(" · ")}</p>}
      <div className="service-change-intake">
        <div><span className="upload-card-title">Service-change exhibits</span><p>Add every SV/RTO/change exhibit. Multiple effective dates in one PDF remain separate timeline events.</p></div>
        <label className="hub-secondary-link"><input type="file" accept=".pdf" multiple onChange={(event) => chooseServiceChanges(event.target.files)} />Add change exhibits</label>
      </div>
      {serviceChanges.length > 0 && <div className="service-change-list">{serviceChanges.map((change) => <article key={change.id}>
        <div className="service-change-file"><strong>{change.name}</strong><span>{fileSize(change.size)} · Local only</span><button type="button" onClick={() => setServiceChanges((current) => current.filter((item) => item.id !== change.id))}>Remove</button></div>
        <div className="service-change-fields">
          <label>Effective date(s)<input value={change.effectiveDates} onChange={(event) => updateServiceChange(change.id, "effectiveDates", event.target.value)} placeholder="YYYY-MM-DD, YYYY-MM-DD" /></label>
          <label>Affected trips<input value={change.affectedTrips} onChange={(event) => updateServiceChange(change.id, "affectedTrips", event.target.value)} placeholder="9, 11, 13" /></label>
          <label>New trips<input value={change.newTrips} onChange={(event) => updateServiceChange(change.id, "newTrips", event.target.value)} placeholder="44, 45" /></label>
        </div>
        <p>Filename clues only—confirm every date and trip against the exhibit before review.</p>
      </article>)}</div>}
    </section>

    <section className="panel schedule-version">
      <div className="section-heading"><div><p className="eyebrow">Step 2</p><h2>Identify this version</h2></div></div>
      <div className="schedule-fields">
        <label>Original effective date<input type="date" value={originalEffectiveDate} onChange={(event) => setOriginalEffectiveDate(event.target.value)} /></label>
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
      {analysis && !revisedOcr && analysis.tripIds.length === 0 && analysis.annualMiles == null && <div className="reviewer-totals">
        <div><p className="eyebrow">Scanned PDF</p><h4>Read revised schedule with local OCR</h4><span>No selectable schedule text was found. Choose only the schedule pages and their orientation. OCR stays on this device.</span></div>
        <div className="page-range-fields">
          <label>First schedule page<input type="number" min="1" max={analysis.pageCount} value={scannedFirstPage} onChange={(event) => { setScannedFirstPage(Number(event.target.value)); setScannedRangeConfirmed(false); }} /></label>
          <label>Last schedule page<input type="number" min="1" max={analysis.pageCount} value={scannedLastPage} onChange={(event) => { setScannedLastPage(Number(event.target.value)); setScannedRangeConfirmed(false); }} /></label>
          <label>Turn scanned pages<select value={scannedRotation} onChange={(event) => { setScannedRotation(Number(event.target.value)); setScannedRangeConfirmed(false); }}><option value={0}>No rotation</option><option value={90}>90° clockwise</option><option value={270}>90° counterclockwise</option><option value={180}>180°</option></select></label>
        </div>
        <label className="range-confirmation"><input type="checkbox" checked={scannedRangeConfirmed} onChange={(event) => setScannedRangeConfirmed(event.target.checked)} /><span>I checked this PDF and confirm pages {scannedFirstPage}–{scannedLastPage} contain schedule information only, with no signature or rate-only pages.</span></label>
        <button className="primary-link schedule-action" type="button" disabled={!scannedRangeConfirmed || readingRevised} onClick={() => void analyzeScannedRevised()}>{readingRevised ? "Reading scanned schedule locally…" : "Read scanned revised schedule"}</button>
        {revisedProgress && <div className="ocr-progress"><div><strong>PDF page {revisedProgress.page}</strong><span>{revisedProgress.status}</span></div><progress max="1" value={revisedProgress.progress} /></div>}
      </div>}
      {analysis && <div className="analysis-results">
        <div className="analysis-result-heading"><div><p className="eyebrow">Initial reconciliation</p><h3>{analysis.warnings.length ? "Review required" : "Source recognized"}</h3></div><span className={analysis.warnings.length ? "review-waiting" : "review-ready"}>{analysis.warnings.length ? `${analysis.warnings.length} warning${analysis.warnings.length === 1 ? "" : "s"}` : "Checks passed"}</span></div>
        <div className="analysis-metrics"><div><span>PDF pages</span><strong>{analysis.pageCount}</strong></div><div><span>Trips found</span><strong>{analysis.tripIds.length}</strong></div><div><span>Frequency codes</span><strong>{analysis.frequencyCodes.length}</strong></div><div><span>Effective dates</span><strong>{analysis.effectiveDates.length}</strong></div></div>
        {revisedOcr && <p className="analysis-warning">OCR confidence: {revisedOcr.averageConfidence.toFixed(1)}%. These are draft readings from pages {scannedFirstPage}–{scannedLastPage}; verify every stated total and trip against the PDF.</p>}
        <dl className="analysis-details"><div><dt>Contract</dt><dd>{analysis.contractNumber || "Not confirmed"}</dd></div><div><dt>Trips</dt><dd>{analysis.tripIds.join(", ") || "None confirmed"}</dd></div><div><dt>Frequencies</dt><dd>{analysis.frequencyCodes.map((item) => `${item.code} (${item.description})`).join(" · ") || "None confirmed"}</dd></div><div><dt>Dates found</dt><dd>{analysis.effectiveDates.join(" · ") || "None confirmed"}</dd></div><div><dt>Stated annual schedule</dt><dd>{analysis.annualMiles == null ? "Miles not confirmed" : `${analysis.annualMiles.toLocaleString()} miles (PDF page ${analysis.annualMilesPage})`} · {analysis.annualHours == null ? "Hours not confirmed" : `${analysis.annualHours.toLocaleString()} hours (PDF page ${analysis.annualHoursPage})`}</dd></div><div><dt>Change summary</dt><dd>{analysis.changeSummaryFound ? "Found" : "Not found"}</dd></div></dl>
        {otherAnalyses.length > 0 && <div className="comparison-summary"><strong>Other schedule versions (separate totals)</strong>{otherAnalyses.map(({ name, result, error }) => <p key={name}><strong>{name}</strong>: {error || (result ? `${result.contractNumber || "Contract unconfirmed"} · ${result.annualMiles?.toLocaleString() ?? "Miles unconfirmed"} annual miles${result.annualMilesPage ? ` (page ${result.annualMilesPage})` : ""} · ${result.annualHours?.toLocaleString() ?? "Hours unconfirmed"} annual hours${result.contractNumber && result.contractNumber !== analysis.contractNumber ? " · CONTRACT MISMATCH" : ""}${result.warnings.some((warning) => warning.startsWith("Different annual")) ? " · CONFLICTING TOTALS" : ""}` : "Could not analyze")}</p>)}</div>}
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
      <label className="range-confirmation"><input type="checkbox" checked={pageRangeConfirmed} onChange={(event) => setPageRangeConfirmed(event.target.checked)} /><span>I checked the PDF and confirm pages {firstOriginalPage}–{lastOriginalPage} contain schedule/location information only, with no signature or rate-only pages, and the selected rotation makes them readable.</span></label>
      <button className="primary-link schedule-action" type="button" disabled={!files.rates || !analysis || !pageRangeConfirmed || readingOriginal} onClick={() => void analyzeOriginal()}>{readingOriginal ? "Reading original schedule locally…" : "Compare original to revised schedule"}</button>
      {!analysis && files.rates && <p className="coming-note">Analyze the revised USPS schedule in Step 3 first.</p>}
      {ocrProgress && <div className="ocr-progress"><div><strong>PDF page {ocrProgress.page}</strong><span>{ocrProgress.status}</span></div><progress max="1" value={ocrProgress.progress} /></div>}
      {originalError && <p className="analysis-error">{originalError}</p>}
      {originalAnalysis && <div className="analysis-results">
        <div className="analysis-result-heading"><div><p className="eyebrow">Original schedule OCR</p><h3>{originalAnalysis.lowConfidence ? "Manual verification required" : "Pages recognized"}</h3></div><span className={originalAnalysis.lowConfidence ? "review-waiting" : "review-ready"}>{originalAnalysis.averageConfidence.toFixed(1)}% OCR confidence</span></div>
        <div className="analysis-metrics"><div><span>Pages read</span><strong>{originalAnalysis.pagesProcessed.length}</strong></div><div><span>Trip candidates</span><strong>{originalAnalysis.tripIds.length}</strong></div><div><span>Frequency codes</span><strong>{originalAnalysis.frequencyCodes.length}</strong></div><div><span>Contract</span><strong>{originalAnalysis.contractNumber || "?"}</strong></div></div>
        <div className="reviewer-totals">
          <div><p className="eyebrow">Reviewer-confirmed totals</p><h4>Enter independently summed original values</h4><span>These remain separate from OCR and are used for the verified change calculation only after confirmation.</span></div>
          <div className="reviewer-total-fields">
            <label>Original annual miles<input inputMode="decimal" value={verifiedOriginalMiles} onChange={(event) => { setVerifiedOriginalMiles(event.target.value); setTotalsConfirmed(false); }} placeholder="Example: 602407.2" /></label>
            <label>Original annual hours<input inputMode="decimal" value={verifiedOriginalHours} onChange={(event) => { setVerifiedOriginalHours(event.target.value); setTotalsConfirmed(false); }} placeholder="Example: 21373.84" /></label>
          </div>
          <label className="range-confirmation"><input type="checkbox" checked={totalsConfirmed} disabled={!verifiedOriginalMiles || !verifiedOriginalHours} onChange={(event) => setTotalsConfirmed(event.target.checked)} /><span>I independently added the original schedule miles and hours and confirm these entries match my calculation.</span></label>
          {totalsConfirmed && confirmedOriginalMiles != null && originalAnalysis.annualMiles != null && Math.abs(confirmedOriginalMiles - originalAnalysis.annualMiles) > 0.01 && <p className="analysis-error">The PDF states {originalAnalysis.annualMiles.toLocaleString()} annual miles on page {originalAnalysis.annualMilesPage}, but the independently added trips total {confirmedOriginalMiles.toLocaleString()}. Check the contract and trip rows before using either value for a cost plan.</p>}
          {totalsConfirmed && confirmedOriginalMiles != null && confirmedOriginalHours != null && analysis?.annualMiles != null && analysis?.annualHours != null && <div className="verified-change-grid">
            <div><span>Verified miles change</span><strong>{(analysis.annualMiles - confirmedOriginalMiles).toLocaleString(undefined, { maximumFractionDigits: 2, signDisplay: "always" })}</strong></div>
            <div><span>Verified hours change</span><strong>{(analysis.annualHours - confirmedOriginalHours).toLocaleString(undefined, { maximumFractionDigits: 2, signDisplay: "always" })}</strong></div>
          </div>}
        </div>
        {comparison && !originalAnalysis.lowConfidence && <div className="schedule-difference-grid">
          <div className={comparison.contractMismatch ? "difference-alert" : ""}><span>Contract check</span><strong>{comparison.contractMismatch ? `Mismatch: ${originalAnalysis.contractNumber} / ${analysis?.contractNumber}` : "Matches"}</strong></div>
          <div className="difference-alert"><span>Trip comparison</span><strong>Withheld pending row-by-row validation</strong><small>{originalAnalysis.tripIds.length} OCR candidates{files.driver?.tripRows ? ` · ${files.driver.tripRows} driver-schedule rows` : ""}. Values such as vehicle code 200 are not accepted as trips.</small></div>
          <div><span>Frequency changes</span><strong>{[...comparison.addedFrequencies.map((code) => `+${code}`), ...comparison.removedFrequencies.map((code) => `−${code}`)].join(", ") || "None detected"}</strong></div>
          <div><span>Original stated annual miles</span><strong>{originalAnalysis.annualMiles == null ? "Not confirmed" : `${originalAnalysis.annualMiles.toLocaleString()} (PDF page ${originalAnalysis.annualMilesPage})`}</strong></div>
          <div><span>Revised stated annual miles</span><strong>{analysis?.annualMiles == null ? "Not confirmed" : `${analysis.annualMiles.toLocaleString()} (PDF page ${analysis.annualMilesPage})`}</strong></div>
          <div><span>OCR miles change</span><strong>{comparison.milesDelta == null ? "Not available" : `${comparison.milesDelta.toLocaleString(undefined, { maximumFractionDigits: 2, signDisplay: "always" })} · Draft only`}</strong></div>
          <div><span>Original annual hours</span><strong>{originalAnalysis.annualHours == null ? "Not confirmed" : originalAnalysis.annualHours.toLocaleString()}</strong></div>
          <div><span>Revised annual hours</span><strong>{analysis?.annualHours == null ? "Not confirmed" : analysis.annualHours.toLocaleString()}</strong></div>
          <div><span>OCR hours change</span><strong>{comparison.hoursDelta == null ? "Not available" : `${comparison.hoursDelta.toLocaleString(undefined, { maximumFractionDigits: 2, signDisplay: "always" })} · Draft only`}</strong></div>
        </div>}
        {originalAnalysis.lowConfidence && <p className="analysis-error"><strong>No trip, frequency, mileage, or hour differences are accepted from this run.</strong> Numeric OCR candidates may be miles, times, or NASS values rather than trip numbers.</p>}
        {originalAnalysis.warnings.map((warning) => <p className="analysis-warning" key={warning}>⚠ {warning}</p>)}
        <p className="approval-blocker"><strong>Approval remains blocked.</strong> The next reconciliation stage must verify each stop’s name, address, NASS code, arrival/departure time, frequency, mileage, and vehicle requirement.</p>
      </div>}
    </section>

    {analysis && !revisedOcr?.lowConfidence && <ScheduleTripReconciliation
      contract={contract}
      effectiveDate={effectiveDate}
      officialTrips={analysis.tripIds}
      simplifiedFile={files.simplified?.file}
      driverFile={files.driver?.file}
    />}

    {serviceChanges.length > 0 && <section className="panel schedule-timeline">
      <div className="section-heading"><div><p className="eyebrow">Version timeline</p><h2>{contract || "Contract"} schedule history</h2></div><span className="review-waiting">Draft intake</span></div>
      <div className="timeline-list">
        <article><span>Baseline</span><strong>Original schedule</strong><small>{originalEffectiveDate || "Effective date required"}</small></article>
        {timelineEvents.map((event) => <article key={event.date}><span>Service-change package · {event.exhibits} exhibit{event.exhibits === 1 ? "" : "s"}</span><strong>{event.date}</strong><small>{event.affectedTrips.size ? `Affected trips ${[...event.affectedTrips].join(", ")}` : "Affected trips require confirmation"}{event.newTrips.size ? ` · New trips ${[...event.newTrips].join(", ")}` : ""}</small></article>)}
        <article><span>Consolidated source</span><strong>Newest schedule</strong><small>{effectiveDate || "Effective date required"}</small></article>
      </div>
      <p className="coming-note">This timeline is a local Draft. Saving versions to the shared contract record will be enabled only after secure schedule tables and approval policies are installed.</p>
    </section>}

    <aside className="panel schedule-output">
      <p className="eyebrow">Planned output</p><h2>One approved schedule, several views</h2>
      <ul><li>Simplified truck sheets</li><li>Day-by-day driver grid</li><li>Parking-location and equipment plan</li><li>SV impact on annual miles, hours, and cost</li><li>Version history with reviewer and approval date</li></ul>
      <div className="schedule-status"><span>Draft</span><span>Reviewed</span><span>Approved</span></div>
    </aside>
  </div>;
}
