"use client";

import Link from "next/link";
import type { OperationalNote } from "@/components/ContractOperationalNotes";

type PerformanceRow = {
  supervisor?: string;
  contract_number?: string;
  total_stops: number;
  completed_stops: number;
  incomplete_stops: number;
  completion_percent: number;
};

const number = (value: number) => Number(value || 0).toLocaleString("en-US");
const percent = (value: number) => `${(Number(value || 0) * 100).toFixed(2)}%`;
const noteStatus = (status: OperationalNote["status"]) => status === "waiting_on_usps" ? "Waiting on USPS" : status === "monitoring" ? "Monitoring" : "Resolved";

export default function SupervisorReportOverview({ supervisors, supervisorContracts, contracts, notes, start, end, showRankings }: {
  supervisors: PerformanceRow[];
  supervisorContracts: PerformanceRow[];
  contracts: PerformanceRow[];
  notes: OperationalNote[];
  start: string;
  end: string;
  showRankings: boolean;
}) {
  const bottomContracts = new Set(showRankings ? contracts.slice(0, 10).map((row) => row.contract_number) : []);
  return <section className="panel supervisor-report-overview">
    <div className="panel-heading"><div><p className="eyebrow">Gary&apos;s report at a glance</p><h2>Supervisors and their contracts</h2><span>{supervisors.length} supervisors · Tap a name to see its contract totals and saved USPS notes.</span></div></div>
    {supervisors.length ? <div className="supervisor-report-list">{supervisors.map((supervisor, index) => {
      const name = supervisor.supervisor || "Unassigned";
      const assigned = supervisorContracts.filter((row) => row.supervisor === supervisor.supervisor);
      return <details key={name} className={`supervisor-report-person ${showRankings && index < 5 ? "supervisor-report-top" : ""}`}>
        <summary><span className="supervisor-report-name"><strong>{name}</strong><small>{assigned.length} contract{assigned.length === 1 ? "" : "s"}</small></span><span className="supervisor-report-numbers"><strong>{percent(supervisor.completion_percent)}</strong><small>{number(supervisor.total_stops)} stops · {number(supervisor.incomplete_stops)} incomplete</small></span></summary>
        <div className="supervisor-report-contracts">{assigned.length ? assigned.map((row) => {
          const contract = row.contract_number || "Unmapped";
          const contractNotes = notes.filter((item) => item.contract_number === contract && item.status !== "resolved");
          return <div className={`supervisor-report-contract ${bottomContracts.has(contract) ? "supervisor-report-low" : ""}`} key={contract}>
            <Link href={`/contracts/${encodeURIComponent(contract)}?start=${start}&end=${end}`}><strong>{contract}</strong><span>Open details →</span></Link>
            <span>{number(row.total_stops)} stops · {number(row.incomplete_stops)} incomplete</span>
            <strong>{percent(row.completion_percent)}</strong>
            {contractNotes.length > 0 && <div className="supervisor-report-notes">{contractNotes.map((note) => <p key={note.id}><b>{noteStatus(note.status)}{note.trip_number ? ` · Trip ${note.trip_number}` : ""}:</b> {note.note}</p>)}</div>}
          </div>;
        }) : <p className="location-empty">No contracts have loads in these dates.</p>}</div>
      </details>;
    })}</div> : <div className="location-empty">No supervisor results for the selected dates.</div>}
  </section>;
}
