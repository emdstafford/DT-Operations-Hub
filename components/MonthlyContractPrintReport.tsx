"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type ContractPerformanceRow = {
  contract_number: string;
  load_count: number;
  total_stops: number;
  completed_stops: number;
  incomplete_stops: number;
  completion_percent: number;
};

type SupervisorContractRow = ContractPerformanceRow & {
  supervisor: string;
};

type AssignmentRow = {
  contract_number: string;
  supervisor: string;
};

type ContractPrintRow = ContractPerformanceRow & {
  supervisors: string[];
};

type DashboardPayload = {
  contracts?: ContractPerformanceRow[];
  supervisor_contracts?: SupervisorContractRow[];
};

const number = (value: number) => Number(value || 0).toLocaleString("en-US");
const percent = (value: number) => `${(Number(value || 0) * 100).toFixed(2)}%`;

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, monthNumber, 0));
  const end = `${year}-${String(monthNumber).padStart(2, "0")}-${String(endDate.getUTCDate()).padStart(2, "0")}`;
  return { start, end };
}

function displayDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function health(value: number) {
  const score = Number(value || 0);
  if (score >= 0.95) return { label: "Good", className: "health-good" };
  if (score >= 0.9) return { label: "Needs help", className: "health-help" };
  return { label: "Alert", className: "health-alert" };
}

function addSupervisor(map: Map<string, Set<string>>, contract: string, supervisor: string) {
  if (!contract || !supervisor || supervisor === "Unassigned") return;
  const names = map.get(contract) ?? new Set<string>();
  names.add(supervisor);
  map.set(contract, names);
}

export default function MonthlyContractPrintReport() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [excludeAugust, setExcludeAugust] = useState(false);
  const [contractRows, setContractRows] = useState<ContractPerformanceRow[]>([]);
  const [embeddedSupervisorRows, setEmbeddedSupervisorRows] = useState<SupervisorContractRow[]>([]);
  const [assignmentRows, setAssignmentRows] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const { start, end } = useMemo(() => monthBounds(month), [month]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");

      const [performanceResult, assignmentResult] = await Promise.all([
        supabase.rpc("dashboard_hub_filtered", {
          p_start: start,
          p_end: end,
          p_grain: "month",
          p_contracts: null,
          p_supervisors: null,
          p_exclude_august_2026: excludeAugust,
          p_max_completion: null,
          p_min_missed_stops: null,
        }),
        supabase
          .from("contract_assignment_periods")
          .select("contract_number, supervisor")
          .lte("start_date", end)
          .or(`end_date.is.null,end_date.gte.${start}`),
      ]);

      if (cancelled) return;
      if (performanceResult.error) {
        setError(performanceResult.error.message);
        setContractRows([]);
        setEmbeddedSupervisorRows([]);
      } else {
        const payload = performanceResult.data as DashboardPayload | null;
        setContractRows(payload?.contracts ?? []);
        setEmbeddedSupervisorRows(payload?.supervisor_contracts ?? []);
      }

      // Dated assignments are authoritative where they exist. The supervisors
      // embedded in historical load rows remain the fallback for other contracts.
      setAssignmentRows(assignmentResult.error ? [] : (assignmentResult.data ?? []) as AssignmentRow[]);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [start, end, excludeAugust]);

  const rows = useMemo<ContractPrintRow[]>(() => {
    const embeddedByContract = new Map<string, Set<string>>();
    const datedByContract = new Map<string, Set<string>>();

    for (const row of embeddedSupervisorRows) {
      addSupervisor(embeddedByContract, row.contract_number || "Unmapped", row.supervisor);
    }
    for (const row of assignmentRows) {
      addSupervisor(datedByContract, row.contract_number, row.supervisor);
    }

    return contractRows.map((row) => {
      const contract = row.contract_number || "Unmapped";
      const authoritative = datedByContract.get(contract);
      const fallback = embeddedByContract.get(contract);
      const supervisors = [...(authoritative?.size ? authoritative : fallback ?? new Set<string>())]
        .sort((a, b) => a.localeCompare(b));

      return {
        contract_number: contract,
        supervisors: supervisors.length ? supervisors : ["Unassigned"],
        load_count: Number(row.load_count),
        total_stops: Number(row.total_stops),
        completed_stops: Number(row.completed_stops),
        incomplete_stops: Number(row.incomplete_stops),
        completion_percent: Number(row.completion_percent),
      };
    }).sort((a, b) =>
      a.completion_percent - b.completion_percent ||
      a.contract_number.localeCompare(b.contract_number)
    );
  }, [contractRows, embeddedSupervisorRows, assignmentRows]);

  const totals = useMemo(() => rows.reduce((sum, row) => ({
    loads: sum.loads + row.load_count,
    total: sum.total + row.total_stops,
    completed: sum.completed + row.completed_stops,
    incomplete: sum.incomplete + row.incomplete_stops,
  }), { loads: 0, total: 0, completed: 0, incomplete: 0 }), [rows]);

  return <section className="panel monthly-contract-report">
    <div className="monthly-report-controls no-print">
      <div>
        <p className="eyebrow">Monthly printable report</p>
        <h2>All contract totals</h2>
        <p>One line per contract with every supervisor assigned during that month.</p>
      </div>
      <div className="monthly-report-actions">
        <label>Month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <label className="filter-checkbox"><input type="checkbox" checked={excludeAugust} onChange={(event) => setExcludeAugust(event.target.checked)} />Exclude Aug 13–20</label>
        <button className="primary-link" type="button" disabled={loading || !rows.length} onClick={() => window.print()}>Print all contracts</button>
      </div>
    </div>

    <div className="print-only print-report-heading">
      <p>DT Intelligence Hub</p>
      <h1>Monthly Contract Performance</h1>
      <strong>{displayDate(start)} – {displayDate(end)}</strong>
    </div>

    {error && <div className="alert alert-error">{error}</div>}
    {loading ? <div className="hub-loading">Loading monthly contract totals…</div> :
      rows.length ? <>
        <div className="monthly-report-summary">
          <span><strong>{rows.length}</strong> contracts</span>
          <span><strong>{number(totals.loads)}</strong> loads</span>
          <span><strong>{number(totals.total)}</strong> total stops</span>
          <span><strong>{number(totals.incomplete)}</strong> incomplete</span>
          <span><strong>{percent(totals.total ? totals.completed / totals.total : 0)}</strong> completion</span>
        </div>
        <div className="table-scroll monthly-print-table-wrap">
          <table className="data-table monthly-print-table">
            <thead><tr><th>Contract</th><th>Supervisor</th><th>Loads</th><th>Total</th><th>Completed</th><th>Incomplete</th><th>Completion</th><th>Status</th></tr></thead>
            <tbody>{rows.map((row) => {
              const status = health(row.completion_percent);
              return <tr key={row.contract_number}>
                <td className="font-semibold text-navy">{row.contract_number}</td>
                <td>{row.supervisors.join(" / ")}</td>
                <td>{number(row.load_count)}</td>
                <td>{number(row.total_stops)}</td>
                <td>{number(row.completed_stops)}</td>
                <td>{number(row.incomplete_stops)}</td>
                <td>{percent(row.completion_percent)}</td>
                <td><span className={`contract-health ${status.className}`}>{status.label}</span></td>
              </tr>;
            })}</tbody>
            <tfoot><tr><th colSpan={2}>All contracts</th><th>{number(totals.loads)}</th><th>{number(totals.total)}</th><th>{number(totals.completed)}</th><th>{number(totals.incomplete)}</th><th>{percent(totals.total ? totals.completed / totals.total : 0)}</th><th /></tr></tfoot>
          </table>
        </div>
      </> : <div className="location-empty">No contract data was found for this month.</div>}
  </section>;
}
