"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getReportHistory, type ReportSnapshot } from "@/lib/reportHistory";

const number = (value: number) => value.toLocaleString("en-US");
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
function date(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

export default function HistoryPage() {
  const [history, setHistory] = useState<ReportSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState("");
  useEffect(() => { const saved = getReportHistory(); setHistory(saved); setSelectedId(saved[0]?.id ?? ""); }, []);
  const report = history.find((item) => item.id === selectedId) ?? history[0];

  return <main className="page-shell">
    <header className="page-intro"><div><p className="eyebrow">Saved USPS reports</p><h1>Report history</h1><p>Return to any reporting period previously processed on this device.</p></div><Link className="upload-button" href="/upload">Upload another report</Link></header>
    {!report ? <section className="empty-state"><div className="empty-icon">H</div><h2>No saved weeks yet</h2><p>Upload a USPS load-details file and its summary will remain available here.</p></section> : <div className="report-stack">
      <section className="panel history-picker"><label htmlFor="period">Reporting period</label><select id="period" value={report.id} onChange={(event) => setSelectedId(event.target.value)}>{history.map((item) => <option key={item.id} value={item.id}>{date(item.periodStart)} - {date(item.periodEnd)}</option>)}</select><span>{report.fileName}</span></section>
      <section className="metric-grid"><article className="metric-card metric-primary"><span>Overall completion</span><strong>{percent(report.totals.percentComplete)}</strong></article><article className="metric-card"><span>Unique loads</span><strong>{number(report.uniqueLoadCount)}</strong></article><article className="metric-card"><span>Total stops</span><strong>{number(report.totals.totalStops)}</strong></article><article className="metric-card"><span>Incomplete stops</span><strong>{number(report.totals.incompleteStops)}</strong></article></section>
      <div className="two-column">
        <section className="panel overflow-hidden"><div className="panel-heading"><h2>Supervisor performance</h2></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Supervisor</th><th>Total</th><th>Completed</th><th>Incomplete</th><th>Completion</th></tr></thead><tbody>{report.supervisors.map((row, index) => <tr key={row.key} className={index < 5 ? "top-performer-row" : ""}><td className="font-semibold text-navy">{row.label}</td><td>{number(row.totalStops)}</td><td>{number(row.completedStops)}</td><td>{number(row.incompleteStops)}</td><td>{percent(row.percentComplete)}</td></tr>)}</tbody></table></div></section>
        <section className="panel overflow-hidden"><div className="panel-heading"><h2>Daily performance</h2></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Day</th><th>Total</th><th>Incomplete</th><th>Completion</th></tr></thead><tbody>{report.daily.map((row) => <tr key={row.key}><td className="font-semibold text-navy">{row.label}</td><td>{number(row.totalStops)}</td><td>{number(row.incompleteStops)}</td><td>{percent(row.percentComplete)}</td></tr>)}</tbody></table></div></section>
      </div>
      <section className="panel overflow-hidden"><div className="panel-heading"><h2>Contract performance</h2><span>{report.contracts.length} contracts</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>Loads</th><th>Total</th><th>Completed</th><th>Incomplete</th><th>Completion</th></tr></thead><tbody>{report.contracts.map((row, index) => <tr key={row.key} className={index < 10 ? "bottom-contract-row" : ""}><td className="font-semibold text-navy">{row.label}</td><td>{number(row.loadCount)}</td><td>{number(row.totalStops)}</td><td>{number(row.completedStops)}</td><td>{number(row.incompleteStops)}</td><td>{percent(row.percentComplete)}</td></tr>)}</tbody></table></div></section>
    </div>}
  </main>;
}
