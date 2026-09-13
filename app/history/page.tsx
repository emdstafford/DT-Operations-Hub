"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getMissedStopsHistory, getReportHistory, type MissedStopsSnapshot, type ReportSnapshot } from "@/lib/reportHistory";

const number = (value: number) => value.toLocaleString("en-US");
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
function date(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

export default function HistoryPage() {
  const [history, setHistory] = useState<ReportSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [missedHistory, setMissedHistory] = useState<MissedStopsSnapshot[]>([]);
  const [selectedMissedId, setSelectedMissedId] = useState("");
  useEffect(() => { void (async () => {
    const [saved, missed] = await Promise.all([getReportHistory(), getMissedStopsHistory()]);
    setHistory(saved); setSelectedId(saved[0]?.id ?? "");
    setMissedHistory(missed); setSelectedMissedId(missed[0]?.id ?? "");
  })(); }, []);
  const report = history.find((item) => item.id === selectedId) ?? history[0];
  const missed = missedHistory.find((item) => item.id === selectedMissedId) ?? missedHistory[0];
  const recurringLocations = useMemo(() => {
    const locations = new Map<string, { firstSeen: string; lastSeen: string; periods: number; occurrences: number }>();
    missedHistory.forEach((period) => period.byLocation.forEach((location) => {
      const current = locations.get(location.key);
      locations.set(location.key, {
        firstSeen: current && current.firstSeen < period.periodStart ? current.firstSeen : period.periodStart,
        lastSeen: current && current.lastSeen > period.periodEnd ? current.lastSeen : period.periodEnd,
        periods: (current?.periods ?? 0) + 1,
        occurrences: (current?.occurrences ?? 0) + location.occurrences,
      });
    }));
    return Array.from(locations.entries()).map(([location, values]) => ({ location, ...values }))
      .sort((a, b) => b.periods - a.periods || b.occurrences - a.occurrences);
  }, [missedHistory]);

  return <main className="page-shell">
    <header className="page-intro"><div><p className="eyebrow">Shared DT history</p><h1>Report history</h1><p>Return to reporting periods securely stored for approved DT Express employees on any computer.</p></div><Link className="upload-button" href="/upload">Upload another report</Link></header>
    {!report && !missed && <section className="empty-state"><div className="empty-icon">H</div><h2>No saved reports yet</h2><p>Upload a USPS load-details or missed-stops file and its summary will remain available here.</p></section>}
    {report && <div className="report-stack">
      <section className="panel history-picker"><label htmlFor="period">Reporting period</label><select id="period" value={report.id} onChange={(event) => setSelectedId(event.target.value)}>{history.map((item) => <option key={item.id} value={item.id}>{date(item.periodStart)} - {date(item.periodEnd)}</option>)}</select><span>{report.fileName}</span></section>
      <section className="metric-grid"><article className="metric-card metric-primary"><span>Overall completion</span><strong>{percent(report.totals.percentComplete)}</strong></article><article className="metric-card"><span>Unique loads</span><strong>{number(report.uniqueLoadCount)}</strong></article><article className="metric-card"><span>Total stops</span><strong>{number(report.totals.totalStops)}</strong></article><article className="metric-card"><span>Incomplete stops</span><strong>{number(report.totals.incompleteStops)}</strong></article></section>
      <div className="two-column">
        <section className="panel overflow-hidden"><div className="panel-heading"><h2>Supervisor performance</h2></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Supervisor</th><th>Total</th><th>Completed</th><th>Incomplete</th><th>Completion</th></tr></thead><tbody>{report.supervisors.map((row, index) => <tr key={row.key} className={index < 5 ? "top-performer-row" : ""}><td className="font-semibold text-navy">{row.label}</td><td>{number(row.totalStops)}</td><td>{number(row.completedStops)}</td><td>{number(row.incompleteStops)}</td><td>{percent(row.percentComplete)}</td></tr>)}</tbody></table></div></section>
        <section className="panel overflow-hidden"><div className="panel-heading"><h2>Daily performance</h2></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Day</th><th>Total</th><th>Incomplete</th><th>Completion</th></tr></thead><tbody>{report.daily.map((row) => <tr key={row.key}><td className="font-semibold text-navy">{row.label}</td><td>{number(row.totalStops)}</td><td>{number(row.incompleteStops)}</td><td>{percent(row.percentComplete)}</td></tr>)}</tbody></table></div></section>
      </div>
      <section className="panel overflow-hidden"><div className="panel-heading"><h2>Contract performance</h2><span>{report.contracts.length} contracts</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>Loads</th><th>Total</th><th>Completed</th><th>Incomplete</th><th>Completion</th></tr></thead><tbody>{report.contracts.map((row, index) => <tr key={row.key} className={index < 10 ? "bottom-contract-row" : ""}><td className="font-semibold text-navy">{row.label}</td><td>{number(row.loadCount)}</td><td>{number(row.totalStops)}</td><td>{number(row.completedStops)}</td><td>{number(row.incompleteStops)}</td><td>{percent(row.percentComplete)}</td></tr>)}</tbody></table></div></section>
    </div>}
    {missed && <div className="report-stack history-section">
      <div className="section-heading"><p className="eyebrow">Sunday reporting</p><h2>Missed Stops History</h2></div>
      <section className="panel history-picker"><label htmlFor="missed-period">Reporting period</label><select id="missed-period" value={missed.id} onChange={(event) => setSelectedMissedId(event.target.value)}>{missedHistory.map((item) => <option key={item.id} value={item.id}>{date(item.periodStart)} - {date(item.periodEnd)}</option>)}</select><span>{missed.fileName}</span></section>
      <section className="metric-grid"><article className="metric-card metric-primary"><span>Missing stops</span><strong>{number(missed.totalMissingStops)}</strong></article><article className="metric-card"><span>Unique loads</span><strong>{number(missed.uniqueLoadCount)}</strong></article><article className="metric-card"><span>Geofence non-compliant</span><strong>{number(missed.geofenceNonCompliantLoads)}</strong></article><article className="metric-card"><span>Ping non-compliant</span><strong>{number(missed.pingNonCompliantLoads)}</strong></article></section>
      <section className="panel overflow-hidden"><div className="panel-heading"><h2>Missing stops by operating day</h2></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Loads</th><th>Missing stops</th></tr></thead><tbody>{missed.byDate.map((row) => <tr key={row.key}><td className="font-semibold text-navy">{date(row.key)}</td><td>{number(row.loads)}</td><td>{number(row.missingStops)}</td></tr>)}</tbody></table></div></section>
      <div className="two-column">
        <section className="panel overflow-hidden"><div className="panel-heading"><h2>Contracts with most missing stops</h2><span>Top 25</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>Loads</th><th>Missing stops</th></tr></thead><tbody>{missed.byContract.slice(0, 25).map((row) => <tr key={row.key} className={row.key === "Others" || row.key === "Unmapped" ? "attention-row" : ""}><td className="font-semibold text-navy">{row.key}</td><td>{number(row.loads)}</td><td>{number(row.missingStops)}</td></tr>)}</tbody></table></div></section>
        <section className="panel overflow-hidden"><div className="panel-heading"><h2>Most frequently missed locations</h2><span>Top 25</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Location</th><th>Occurrences</th></tr></thead><tbody>{missed.byLocation.slice(0, 25).map((row) => <tr key={row.key}><td className="font-semibold text-navy">{row.key}</td><td>{number(row.occurrences)}</td></tr>)}</tbody></table></div></section>
      </div>
      <section className="panel overflow-hidden"><div className="panel-heading"><h2>Recurring missed locations</h2><span>Across all saved periods</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Location</th><th>First missed period</th><th>Latest missed period</th><th>Periods affected</th><th>Total occurrences</th></tr></thead><tbody>{recurringLocations.slice(0, 100).map((row) => <tr key={row.location}><td className="font-semibold text-navy">{row.location}</td><td>{date(row.firstSeen)}</td><td>{date(row.lastSeen)}</td><td>{number(row.periods)}</td><td>{number(row.occurrences)}</td></tr>)}</tbody></table></div></section>
    </div>}
  </main>;
}
