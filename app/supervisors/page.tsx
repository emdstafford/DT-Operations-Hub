"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SummaryRow } from "@/lib/processors/reportProcessor";

type SavedSupervisorReport = {
  fileName: string;
  periodStart: string;
  periodEnd: string;
  supervisors: SummaryRow[];
};

function displayDate(value: string) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export default function SupervisorsPage() {
  const [report, setReport] = useState<SavedSupervisorReport | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("dt-latest-supervisor-report");
    if (saved) setReport(JSON.parse(saved) as SavedSupervisorReport);
  }, []);

  const rows = report?.supervisors ?? [];

  return (
    <main className="page-shell">
      <header className="page-intro">
        <div>
          <p className="eyebrow">USPS performance</p>
          <h1>Supervisor performance</h1>
          <p>Trip-level supervisor totals from the most recently uploaded USPS load-details file.</p>
        </div>
        <Link className="upload-button" href="/upload">Upload a report</Link>
      </header>

      {!report ? (
        <section className="empty-state">
          <div className="empty-icon">SP</div>
          <h2>Upload a USPS report first</h2>
          <p>The supervisor page will use its filename dates and split Tonya Capps-Owen’s 296B8 and 296C2 trips before calculating results.</p>
        </section>
      ) : (
        <div className="report-stack">
          <section className="report-banner">
            <div>
              <p className="eyebrow eyebrow-light">Reporting period from filename</p>
              <h2>{displayDate(report.periodStart)} - {displayDate(report.periodEnd)}</h2>
              <p>{report.fileName}</p>
            </div>
          </section>
          <section className="panel overflow-hidden">
            <div className="panel-heading"><h2>Supervisor rankings</h2><span>{rows.length} results</span></div>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Rank</th><th>Supervisor</th><th>Loads</th><th>Total stops</th><th>Completed</th><th>Incomplete</th><th>Completion</th></tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={row.key} className={row.key === "Unassigned" ? "attention-row" : ""}>
                    <td>#{index + 1}</td><td className="font-semibold text-navy">{row.label}</td><td>{row.loadCount.toLocaleString()}</td><td>{row.totalStops.toLocaleString()}</td><td>{row.completedStops.toLocaleString()}</td><td>{row.incompleteStops.toLocaleString()}</td><td className="font-semibold">{(row.percentComplete * 100).toFixed(2)}%</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
