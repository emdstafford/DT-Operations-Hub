"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type MonthlyRow = {
  contract_number: string;
  period_start: string;
  load_count: number;
  total_stops: number;
  completed_stops: number;
  incomplete_stops: number;
  completion_percent: number;
  supervisors: string[] | null;
};

type ContractPacket = {
  contract: string;
  supervisors: string[];
  months: MonthlyRow[];
  totals: {
    loads: number;
    total: number;
    completed: number;
    incomplete: number;
  };
};

const number = (value: number) => Number(value || 0).toLocaleString("en-US");
const percent = (value: number) => `${(Number(value || 0) * 100).toFixed(2)}%`;

function monthName(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
  });
}

export default function MonthlyContractPrintReport() {
  const currentYear = Number(new Date().toISOString().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [excludeAugust, setExcludeAugust] = useState(false);
  const [sourceRows, setSourceRows] = useState<MonthlyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      const result = await supabase.rpc("all_contract_monthly_performance", {
        p_start: start,
        p_end: end,
        p_exclude_august_2026: excludeAugust,
      });

      if (cancelled) return;
      if (result.error) {
        setError(
          result.error.message.includes("all_contract_monthly_performance")
            ? "Install supabase/all_contract_monthly_print.sql in Supabase to enable this report."
            : result.error.message
        );
        setSourceRows([]);
      } else {
        setSourceRows((result.data ?? []) as MonthlyRow[]);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [start, end, excludeAugust]);

  const packets = useMemo<ContractPacket[]>(() => {
    const grouped = new Map<string, MonthlyRow[]>();
    for (const source of sourceRows) {
      const row = {
        ...source,
        load_count: Number(source.load_count),
        total_stops: Number(source.total_stops),
        completed_stops: Number(source.completed_stops),
        incomplete_stops: Number(source.incomplete_stops),
        completion_percent: Number(source.completion_percent),
        supervisors: Array.isArray(source.supervisors) ? source.supervisors : [],
      };
      const contract = row.contract_number || "Unmapped";
      const months = grouped.get(contract) ?? [];
      months.push(row);
      grouped.set(contract, months);
    }

    return [...grouped.entries()].map(([contract, months]) => {
      months.sort((a, b) => a.period_start.localeCompare(b.period_start));
      const supervisorSet = new Set<string>();
      months.forEach((row) => row.supervisors?.forEach((name) => {
        if (name && name !== "Unassigned") supervisorSet.add(name);
      }));
      const totals = months.reduce((sum, row) => ({
        loads: sum.loads + row.load_count,
        total: sum.total + row.total_stops,
        completed: sum.completed + row.completed_stops,
        incomplete: sum.incomplete + row.incomplete_stops,
      }), { loads: 0, total: 0, completed: 0, incomplete: 0 });

      return {
        contract,
        supervisors: supervisorSet.size ? [...supervisorSet].sort((a, b) => a.localeCompare(b)) : ["Unassigned"],
        months,
        totals,
      };
    }).sort((a, b) => a.contract.localeCompare(b.contract));
  }, [sourceRows]);

  return <section className="panel monthly-contract-report" id="monthly-report">
    <div className="monthly-report-controls no-print">
      <div>
        <p className="eyebrow">Printable contract packet</p>
        <h2>All contracts by month</h2>
        <p>Every contract prints on its own page with its supervisor and January–December results.</p>
      </div>
      <div className="monthly-report-actions">
        <label>Report year
          <input type="number" min="2023" max="2100" value={year} onChange={(event) => setYear(Number(event.target.value) || currentYear)} />
        </label>
        <label className="filter-checkbox"><input type="checkbox" checked={excludeAugust} onChange={(event) => setExcludeAugust(event.target.checked)} />Exclude Aug 13–20</label>
        <button className="primary-link" type="button" disabled={loading || !packets.length} onClick={() => window.print()}>Print All Contracts</button>
      </div>
    </div>

    {error && <div className="alert alert-error">{error}</div>}
    {loading ? <div className="hub-loading">Building the contract packet…</div> :
      packets.length ? <div className="contract-packet">
        {packets.map((packet) => {
          const overallCompletion = packet.totals.total ? packet.totals.completed / packet.totals.total : 0;
          return <article className="contract-print-page" key={packet.contract}>
            <header className="contract-page-heading">
              <div>
                <p>DT Intelligence Hub · {year}</p>
                <h1>Contract {packet.contract}</h1>
                <strong>Supervisor{packet.supervisors.length === 1 ? "" : "s"}: {packet.supervisors.join(" / ")}</strong>
              </div>
            </header>

            <div className="contract-page-summary">
              <div><span>Completion</span><strong>{percent(overallCompletion)}</strong></div>
              <div><span>Loads</span><strong>{number(packet.totals.loads)}</strong></div>
              <div><span>Total stops</span><strong>{number(packet.totals.total)}</strong></div>
              <div><span>Incomplete</span><strong>{number(packet.totals.incomplete)}</strong></div>
            </div>

            <table className="data-table contract-month-table">
              <thead><tr><th>Month</th><th>Supervisor</th><th>Loads</th><th>Total</th><th>Completed</th><th>Incomplete</th><th>Completion</th></tr></thead>
              <tbody>{packet.months.map((row) => {
                const supervisors = row.supervisors?.filter((name) => name && name !== "Unassigned") ?? [];
                return <tr key={row.period_start}>
                  <th>{monthName(row.period_start)}</th>
                  <td>{supervisors.length ? supervisors.join(" / ") : "Unassigned"}</td>
                  <td>{number(row.load_count)}</td>
                  <td>{number(row.total_stops)}</td>
                  <td>{number(row.completed_stops)}</td>
                  <td>{number(row.incomplete_stops)}</td>
                  <td><strong>{percent(row.completion_percent)}</strong></td>
                </tr>;
              })}</tbody>
              <tfoot><tr><th>Year total</th><th>{packet.supervisors.join(" / ")}</th><th>{number(packet.totals.loads)}</th><th>{number(packet.totals.total)}</th><th>{number(packet.totals.completed)}</th><th>{number(packet.totals.incomplete)}</th><th>{percent(overallCompletion)}</th></tr></tfoot>
            </table>
          </article>;
        })}
      </div> : <div className="location-empty">No contract data was found for {year}.</div>}
  </section>;
}
