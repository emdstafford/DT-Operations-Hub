"use client";

import { useMemo, useState } from "react";
import {
  processReport,
  type ProcessedReport,
  type SummaryRow,
} from "@/lib/processors/reportProcessor";

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
              <tr key={row.key} className={row.key === "Unassigned" ? "attention-row" : ""}>
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

export default function UploadPage() {
  const [report, setReport] = useState<ProcessedReport | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const email = useMemo(() => report ? buildEmail(report) : "", [report]);

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    setError("");
    setReport(null);
    try {
      setReport(await processReport(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The report could not be processed.");
    } finally {
      setLoading(false);
    }
  }

  async function copyEmail() {
    await navigator.clipboard.writeText(email);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="page-shell">
      <header className="page-intro">
        <div>
          <p className="eyebrow">FourKites reporting</p>
          <h1>Upload TQ report</h1>
          <p>Review weekly, daily, contract, and supervisor results before saving them to history.</p>
        </div>
        <label className="upload-button">
          <span>{loading ? "Processing report…" : "Choose TQ report"}</span>
          <input type="file" accept=".xlsx,.xlsm,.xls" onChange={handleFileSelect} disabled={loading} />
        </label>
      </header>

      {fileName && <div className="file-strip"><span>Selected file</span><strong>{fileName}</strong></div>}
      {error && <div className="alert alert-error">{error}</div>}

      {!report && !loading && (
        <section className="empty-state">
          <div className="empty-icon">DT</div>
          <h2>Start with the TQ_GENERATENOW workbook</h2>
          <p>DT Operations Hub will use the report period, actual operating dates, contract tags, trip numbers, and unique Load Numbers.</p>
        </section>
      )}

      {report && (
        <div className="report-stack">
          <section className="report-banner">
            <div>
              <p className="eyebrow eyebrow-light">Weekly report ready</p>
              <h2>{displayDate(report.periodStart)} - {displayDate(report.periodEnd)}</h2>
              <p>{number(report.reportLoads.length)} unique loads included in the weekly view</p>
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

          <SummaryTable title="Daily performance" rows={report.daily} />
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
