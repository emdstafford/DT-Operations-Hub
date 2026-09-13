"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  processReport,
  type ProcessedReport,
  type SummaryRow,
} from "@/lib/processors/reportProcessor";
import {
  processOperationalExceptions,
  type MissedStopSummary,
} from "@/lib/processOperationalExceptions";
import { saveReportSnapshot } from "@/lib/reportHistory";

function number(value: number) {
  return value.toLocaleString("en-US");
}

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function displayDate(value: string) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function SummaryTable({
  title,
  rows,
  rank = false,
}: {
  title: string;
  rows: SummaryRow[];
  rank?: boolean;
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-heading">
        <h2>{title}</h2>
        <span>{rows.length} results</span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {rank && <th>Rank</th>}
              <th>{title === "Daily performance" ? "Operating day" : title.includes("Supervisor") ? "Supervisor" : "Contract"}</th>
              <th>Loads</th>
              <th>Total stops</th>
              <th>Completed</th>
              <th>Incomplete</th>
              <th>Completion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key} className={
                row.key === "Unassigned" ? "attention-row"
                  : rank && index < 5 ? "top-performer-row"
                    : (title === "Contract performance" || title.startsWith("Contracts for ")) && index < 10 ? "bottom-contract-row"
                      : ""
              }>
                {rank && <td>#{index + 1}</td>}
                <td className="font-semibold text-navy">{row.label}</td>
                <td>{number(row.loadCount)}</td>
                <td>{number(row.totalStops)}</td>
                <td>{number(row.completedStops)}</td>
                <td>{number(row.incompleteStops)}</td>
                <td className="font-semibold">{percent(row.percentComplete)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function buildEmail(report: ProcessedReport) {
  const supervisors = report.supervisors.filter((row) => row.key !== "Unassigned");
  const lines = [
    `Completion Totals for ${displayDate(report.periodStart)} - ${displayDate(report.periodEnd)}`,
    "",
    `Total Overall: ${percent(report.totals.percentComplete)}`,
    "",
  ];
  if (supervisors[0]) {
    lines.push(`Congratulations to ${supervisors[0].label} for the highest percentage for the week!`, "");
  }
  lines.push("Supervisor\t% Complete");
  supervisors.forEach((row) => lines.push(`${row.label}\t${percent(row.percentComplete)}`));
  lines.push("", "Contract\tTotal Stops\tStops Completed\tStops Incomplete\t% Complete");
  report.contracts.forEach((row) => {
    lines.push(`${row.label}\t${row.totalStops}\t${row.completedStops}\t${row.incompleteStops}\t${percent(row.percentComplete)}`);
  });
  lines.push(
    `Main Total\t${report.totals.totalStops}\t${report.totals.completedStops}\t${report.totals.incompleteStops}\t${percent(report.totals.percentComplete)}`,
  );
  return lines.join("\n");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

function buildEmailHtml(report: ProcessedReport) {
  const supervisors = report.supervisors.filter((row) => row.key !== "Unassigned");
  const header = "background:#123b61;color:#fff;padding:8px;border:1px solid #d6dde3;text-align:left";
  const cell = "padding:7px 9px;border:1px solid #d6dde3;text-align:right";
  const nameCell = `${cell};text-align:left;font-weight:600`;
  const supervisorRows = supervisors.map((row, index) => `<tr style="${index < 5 ? "background:#e8f5ea" : ""}"><td style="${nameCell}">${escapeHtml(row.label)}</td><td style="${cell}">${percent(row.percentComplete)}</td></tr>`).join("");
  const contractRows = report.contracts.map((row, index) => `<tr style="${index < 10 ? "background:#f9e8ea" : ""}"><td style="${nameCell}">${escapeHtml(row.label)}</td><td style="${cell}">${number(row.totalStops)}</td><td style="${cell}">${number(row.completedStops)}</td><td style="${cell}">${number(row.incompleteStops)}</td><td style="${cell}">${percent(row.percentComplete)}</td></tr>`).join("");
  return `<div style="font-family:Arial,sans-serif;color:#243746"><h2 style="color:#123b61">Completion Totals for ${displayDate(report.periodStart)} - ${displayDate(report.periodEnd)}</h2><p><strong>Total Overall: ${percent(report.totals.percentComplete)}</strong></p>${supervisors[0] ? `<p>Congratulations to <strong>${escapeHtml(supervisors[0].label)}</strong> for the highest percentage for the week!</p>` : ""}<h3 style="color:#123b61">Supervisor Performance</h3><table style="border-collapse:collapse"><thead><tr><th style="${header}">Supervisor</th><th style="${header}">% Complete</th></tr></thead><tbody>${supervisorRows}</tbody></table><h3 style="color:#123b61">Contract Performance</h3><table style="border-collapse:collapse"><thead><tr><th style="${header}">Contract</th><th style="${header}">Total Stops</th><th style="${header}">Completed</th><th style="${header}">Incomplete</th><th style="${header}">% Complete</th></tr></thead><tbody>${contractRows}</tbody></table></div>`;
}

export default function UploadPage() {
  const [report, setReport] = useState<ProcessedReport | null>(null);
  const [missedStops, setMissedStops] = useState<MissedStopSummary | null>(null);
  const [reportType, setReportType] = useState<"loads" | "missed" | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [selectedDay, setSelectedDay] = useState("");
  const email = useMemo(() => report ? buildEmail(report) : "", [report]);
  const selectedDayContracts = useMemo(() => {
    if (!report || !selectedDay) return [];
    const groups = new Map<string, typeof report.reportLoads>();
    report.reportLoads.filter((load) => load.operatingDate === selectedDay).forEach((load) => {
      const key = load.contract || "Unmapped";
      groups.set(key, [...(groups.get(key) ?? []), load]);
    });
    return Array.from(groups.entries()).map(([key, loads]) => {
      const totalStops = loads.reduce((sum, load) => sum + load.totalStops, 0);
      const completedStops = loads.reduce((sum, load) => sum + load.completedStops, 0);
      const incompleteStops = loads.reduce((sum, load) => sum + load.incompleteStops, 0);
      return { key, label: key, loadCount: loads.length, totalStops, completedStops, incompleteStops, percentComplete: totalStops ? completedStops / totalStops : 0 };
    }).sort((a, b) => a.percentComplete - b.percentComplete);
  }, [report, selectedDay]);

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    setError("");
    setReport(null);
    setSelectedDay("");
    setMissedStops(null);
    setReportType(null);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { bookSheets: true });
      if (workbook.SheetNames.includes("Non-Compliant Loads")) {
        setMissedStops(await processOperationalExceptions(file));
        setReportType("missed");
      } else if (workbook.SheetNames.includes("Load Details")) {
        const processed = await processReport(file);
        setReport(processed);
        saveReportSnapshot(processed);
        window.localStorage.setItem("dt-latest-supervisor-report", JSON.stringify({
          fileName: processed.fileName,
          periodStart: processed.periodStart,
          periodEnd: processed.periodEnd,
          supervisors: processed.supervisors,
        }));
        setReportType("loads");
      } else {
        throw new Error("This does not look like a USPS load-details file or a missed-stops file.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The report could not be processed.");
    } finally {
      setLoading(false);
    }
  }

  async function copyEmail() {
    const html = buildEmailHtml(report!);
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([email], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      })]);
    } else {
      await navigator.clipboard.writeText(email);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="page-shell">
      <header className="page-intro">
        <div>
          <p className="eyebrow">One upload center</p>
          <h1>Upload a report</h1>
          <p>Choose either a daily or weekly USPS load-details file, or the Sunday missed-stops file. The hub will recognize it automatically.</p>
        </div>
        <label className="upload-button">
          <span>{loading ? "Identifying and processing…" : "Choose report"}</span>
          <input type="file" accept=".xlsx,.xlsm,.xls" onChange={handleFileSelect} disabled={loading} />
        </label>
      </header>

      {fileName && <div className="file-strip"><span>Selected file</span><strong>{fileName}</strong></div>}
      {error && <div className="alert alert-error">{error}</div>}

      {!report && !missedStops && !loading && (
        <section className="empty-state">
          <div className="empty-icon">DT</div>
          <h2>One place for both report types</h2>
          <p>Upload the USPS load-details workbook for completion reporting or DAVENPORT TRANSPORTATION INC for missed stops. Duplicate Load Numbers are counted once.</p>
        </section>
      )}

      {reportType === "missed" && missedStops && (
        <div className="report-stack">
          <section className="report-banner"><div><p className="eyebrow eyebrow-light">Missed-stops report recognized</p><h2>{number(missedStops.rows.length)} unique non-compliant loads</h2><p>The Sunday workbook was identified automatically.</p></div></section>
          <section className="metric-grid">
            <article className="metric-card metric-primary"><span>Missing stops</span><strong>{number(missedStops.totalMissingStops)}</strong></article>
            <article className="metric-card"><span>Geofence non-compliant loads</span><strong>{number(missedStops.geofenceNonCompliantLoads)}</strong></article>
            <article className="metric-card"><span>Ping non-compliant loads</span><strong>{number(missedStops.pingNonCompliantLoads)}</strong></article>
            <article className="metric-card"><span>Loads requiring mapping</span><strong>{number(missedStops.unmappedLoads)}</strong></article>
          </section>
          <section className="notice-grid">
            <div className="notice"><strong>{missedStops.duplicateLoadNumbers.length}</strong><span>duplicate Load Numbers skipped</span></div>
            <div className="notice"><strong>{missedStops.byDate.length}</strong><span>operating dates represented</span></div>
            <div className="notice"><strong>{missedStops.byContract.length}</strong><span>contract groups represented</span></div>
            <div className="notice"><strong>{missedStops.byLocation.length}</strong><span>missing-stop locations identified</span></div>
          </section>
          <div className="two-column">
            <section className="panel overflow-hidden"><div className="panel-heading"><h2>Missing stops by day</h2></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Loads</th><th>Missing stops</th></tr></thead><tbody>{missedStops.byDate.map((row) => <tr key={row.key}><td className="font-semibold text-navy">{row.key}</td><td>{number(row.loads)}</td><td>{number(row.missingStops)}</td></tr>)}</tbody></table></div></section>
            <section className="panel overflow-hidden"><div className="panel-heading"><h2>Contracts with most missing stops</h2></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>Loads</th><th>Missing stops</th></tr></thead><tbody>{missedStops.byContract.slice(0, 20).map((row) => <tr key={row.key} className={row.key === "Others" || row.key === "Unmapped" ? "attention-row" : ""}><td className="font-semibold text-navy">{row.key}</td><td>{number(row.loads)}</td><td>{number(row.missingStops)}</td></tr>)}</tbody></table></div></section>
          </div>
          <section className="panel overflow-hidden"><div className="panel-heading"><h2>Most frequently missed locations</h2><span>Top 25</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Location</th><th>Occurrences</th></tr></thead><tbody>{missedStops.byLocation.slice(0, 25).map((row) => <tr key={row.key}><td className="font-semibold text-navy">{row.key}</td><td>{number(row.occurrences)}</td></tr>)}</tbody></table></div></section>
        </div>
      )}

      {reportType === "loads" && report && (
        <div className="report-stack">
          <section className="report-banner">
            <div>
              <p className="eyebrow eyebrow-light">Weekly report ready</p>
              <h2>{displayDate(report.periodStart)} - {displayDate(report.periodEnd)}</h2>
              <p>{number(report.reportLoads.length)} unique loads included. This period is saved in History.</p>
            </div>
            <button className="secondary-button" onClick={copyEmail}>{copied ? "Copied" : "Copy email report"}</button>
          </section>

          <section className="metric-grid">
            <article className="metric-card metric-primary"><span>Overall completion</span><strong>{percent(report.totals.percentComplete)}</strong></article>
            <article className="metric-card"><span>Total stops</span><strong>{number(report.totals.totalStops)}</strong></article>
            <article className="metric-card"><span>Completed stops</span><strong>{number(report.totals.completedStops)}</strong></article>
            <article className="metric-card"><span>Incomplete stops</span><strong>{number(report.totals.incompleteStops)}</strong></article>
          </section>

          <section className="notice-grid">
            <div className="notice"><strong>{report.duplicateLoadNumbers.length}</strong><span>duplicate Load Numbers skipped</span></div>
            <div className="notice"><strong>{report.outsidePeriodCount}</strong><span>loads kept for dates outside this weekly view</span></div>
            <div className="notice"><strong>{report.unmatchedContractCount}</strong><span>loads needing a contract review</span></div>
            <div className="notice"><strong>{report.unmatchedSupervisorCount}</strong><span>loads needing a supervisor assignment</span></div>
          </section>

          <section className="panel overflow-hidden">
            <div className="panel-heading"><h2>Daily performance</h2><span>Click a day to view its contracts</span></div>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Operating day</th><th>Loads</th><th>Total stops</th><th>Completed</th><th>Incomplete</th><th>Completion</th></tr></thead><tbody>{report.daily.map((row) => <tr key={row.key} className={selectedDay === row.key ? "selected-day-row" : ""}><td><button className="day-button" onClick={() => setSelectedDay(selectedDay === row.key ? "" : row.key)}>{row.label}</button></td><td>{number(row.loadCount)}</td><td>{number(row.totalStops)}</td><td>{number(row.completedStops)}</td><td>{number(row.incompleteStops)}</td><td className="font-semibold">{percent(row.percentComplete)}</td></tr>)}</tbody></table></div>
          </section>
          {selectedDay && <SummaryTable title={`Contracts for ${displayDate(selectedDay)}`} rows={selectedDayContracts} />}
          <div className="two-column">
            <SummaryTable title="Supervisor rankings" rows={report.supervisors} rank />
            <SummaryTable title="Contract performance" rows={report.contracts} />
          </div>
          <section className="panel email-panel">
            <div className="panel-heading"><h2>Email preview</h2><button className="text-button" onClick={copyEmail}>{copied ? "Copied" : "Copy"}</button></div>
            <pre>{email}</pre>
          </section>
        </div>
      )}
    </main>
  );
}
