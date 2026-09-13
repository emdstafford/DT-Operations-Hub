"use client";

import { useState } from "react";
import {
  processOperationalExceptions,
  type MissedStopSummary,
} from "@/lib/processOperationalExceptions";

export default function OperationalExceptionsPage() {
  const [summary, setSummary] = useState<MissedStopSummary | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    setError("");
    try {
      setSummary(await processOperationalExceptions(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The missed-stops report could not be processed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <header className="page-intro">
        <div><p className="eyebrow">Sunday reporting</p><h1>Missed stops</h1><p>Upload the Davenport non-compliant loads workbook to review missing geofence stops by date, contract, and location.</p></div>
        <label className="upload-button"><span>{loading ? "Processing report…" : "Choose missed-stops report"}</span><input type="file" accept=".xlsx,.xls" onChange={handleFileSelect} disabled={loading} /></label>
      </header>
      {fileName && <div className="file-strip"><span>Selected file</span><strong>{fileName}</strong></div>}
      {error && <div className="alert alert-error">{error}</div>}
      {!summary && !loading && <section className="empty-state"><div className="empty-icon">MS</div><h2>Upload the Sunday report</h2><p>Each unique Load Number will be counted once. “Others” and unmapped contract rows will remain visible for review.</p></section>}
      {summary && <div className="report-stack">
        <section className="report-banner"><div><p className="eyebrow eyebrow-light">Missed-stops report ready</p><h2>{summary.rows.length.toLocaleString()} unique non-compliant loads</h2><p>Load-level detail is ready to connect with TQ history and supervisor assignments.</p></div></section>
        <section className="metric-grid">
          <article className="metric-card metric-primary"><span>Missing stops</span><strong>{summary.totalMissingStops.toLocaleString()}</strong></article>
          <article className="metric-card"><span>Geofence non-compliant loads</span><strong>{summary.geofenceNonCompliantLoads.toLocaleString()}</strong></article>
          <article className="metric-card"><span>Ping non-compliant loads</span><strong>{summary.pingNonCompliantLoads.toLocaleString()}</strong></article>
          <article className="metric-card"><span>Loads requiring mapping</span><strong>{summary.unmappedLoads.toLocaleString()}</strong></article>
        </section>
        <section className="notice-grid">
          <div className="notice"><strong>{summary.duplicateLoadNumbers.length}</strong><span>duplicate Load Numbers skipped</span></div>
          <div className="notice"><strong>{summary.byDate.length}</strong><span>operating dates represented</span></div>
          <div className="notice"><strong>{summary.byContract.length}</strong><span>contract groups represented</span></div>
          <div className="notice"><strong>{summary.byLocation.length}</strong><span>missing-stop locations identified</span></div>
        </section>
        <div className="two-column">
          <section className="panel overflow-hidden"><div className="panel-heading"><h2>Missing stops by day</h2></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Loads</th><th>Missing stops</th></tr></thead><tbody>{summary.byDate.map((row) => <tr key={row.key}><td className="font-semibold text-navy">{row.key}</td><td>{row.loads.toLocaleString()}</td><td>{row.missingStops.toLocaleString()}</td></tr>)}</tbody></table></div></section>
          <section className="panel overflow-hidden"><div className="panel-heading"><h2>Contracts with most missing stops</h2></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>Loads</th><th>Missing stops</th></tr></thead><tbody>{summary.byContract.slice(0, 20).map((row) => <tr key={row.key} className={row.key === "Others" || row.key === "Unmapped" ? "attention-row" : ""}><td className="font-semibold text-navy">{row.key}</td><td>{row.loads.toLocaleString()}</td><td>{row.missingStops.toLocaleString()}</td></tr>)}</tbody></table></div></section>
        </div>
        <section className="panel overflow-hidden"><div className="panel-heading"><h2>Most frequently missed locations</h2><span>Top 25</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Location</th><th>Occurrences</th></tr></thead><tbody>{summary.byLocation.slice(0, 25).map((row) => <tr key={row.key}><td className="font-semibold text-navy">{row.key}</td><td>{row.occurrences.toLocaleString()}</td></tr>)}</tbody></table></div></section>
      </div>}
    </main>
  );
}
