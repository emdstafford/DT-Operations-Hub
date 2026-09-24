"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { estimateContractMileage, type MileagePlan } from "@/lib/fuelMileageEstimate";
import { supabase } from "@/lib/supabase";

type ContractRow = {
  contract_number?: string;
  completion_percent: number;
  incomplete_stops: number;
};

type Purchase = {
  contract_number: string;
  purchased_gallons: number;
  purchased_fuel_cost: number;
};

type Check = {
  contract: string;
  completion: number;
  incomplete: number;
  expectedGallons: number;
  purchasedGallons: number;
  variancePercent: number;
  status: "over" | "plan-needed";
};

const number = (value: number, decimals = 0) => Number(value || 0).toLocaleString("en-US", {
  minimumFractionDigits: decimals,
  maximumFractionDigits: decimals,
});
const percent = (value: number) => `${(Number(value || 0) * 100).toFixed(2)}%`;

export default function DashboardFuelChecks({ start, end, contracts }: {
  start: string;
  end: string;
  contracts: ContractRow[];
}) {
  const [plans, setPlans] = useState<MileagePlan[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const contractNumbers = useMemo(() => [...new Set(contracts.map((row) => row.contract_number || "").filter(Boolean))], [contracts]);
  const contractKey = contractNumbers.join("|");

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!contractNumbers.length) { setLoading(false); return; }
      setLoading(true);
      const [planResult, purchaseResult] = await Promise.all([
        supabase.from("fuel_contract_mileage_plans")
          .select("contract_number,effective_start,effective_end,annual_miles,assumed_mpg,tractor_count,straight_truck_count,alert_above_percent")
          .in("contract_number", contractNumbers).lte("effective_start", end).order("effective_start"),
        supabase.rpc("fuel_contract_purchases_for_estimate", { p_start: start, p_end: end, p_contracts: contractNumbers }),
      ]);
      if (!active) return;
      // The estimate RPC is limited to approved fuel users. Keep financial data
      // completely off the operations dashboard for every other account.
      if (purchaseResult.error || planResult.error) {
        setAllowed(false); setPlans([]); setPurchases([]); setLoading(false); return;
      }
      setAllowed(true);
      setPlans((planResult.data ?? []) as MileagePlan[]);
      setPurchases((purchaseResult.data ?? []) as Purchase[]);
      setLoading(false);
    })();
    return () => { active = false; };
  // contractKey is the stable representation of the visible contract selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, contractKey]);

  const checks = useMemo<Check[]>(() => contracts.map((contract) => {
    const contractNumber = contract.contract_number || "Unmapped";
    const estimate = estimateContractMileage(plans.filter((plan) => plan.contract_number === contractNumber), start, end);
    const purchase = purchases.find((row) => row.contract_number === contractNumber);
    const purchasedGallons = Number(purchase?.purchased_gallons ?? 0);
    const complete = estimate.totalDays > 0 && estimate.coveredDays === estimate.totalDays;
    const variancePercent = estimate.expectedGallons > 0 ? (purchasedGallons / estimate.expectedGallons - 1) * 100 : 0;
    return {
      contract: contractNumber,
      completion: Number(contract.completion_percent || 0),
      incomplete: Number(contract.incomplete_stops || 0),
      expectedGallons: estimate.expectedGallons,
      purchasedGallons,
      variancePercent,
      status: !complete ? "plan-needed" : variancePercent > estimate.alertAbovePercent ? "over" : null,
    };
  }).filter((row): row is Check => row.status !== null)
    .sort((a, b) => a.status === b.status ? b.variancePercent - a.variancePercent : a.status === "over" ? -1 : 1), [contracts, plans, purchases, start, end]);

  if (!allowed) return null;
  const over = checks.filter((row) => row.status === "over");
  const planNeeded = checks.filter((row) => row.status === "plan-needed");
  const shown = [...over, ...planNeeded].slice(0, 8);

  return <section className="panel dashboard-fuel-checks">
    <div className="panel-heading"><div><p className="eyebrow">Restricted fuel view</p><h2>Contract &amp; fuel checks</h2><span>{start} – {end} · Only approved fuel users see this section</span></div><Link className="hub-secondary-link" href="/fuel">Open Fuel Reports</Link></div>
    {loading ? <div className="hub-loading">Checking contract fuel estimates…</div> : <>
      <div className="fuel-check-summary">
        <div className={over.length ? "fuel-check-alert" : ""}><span>Over expected fuel</span><strong>{over.length}</strong></div>
        <div className={planNeeded.length ? "fuel-check-warning" : ""}><span>Plans needed</span><strong>{planNeeded.length}</strong></div>
        <div><span>Contracts checked</span><strong>{contractNumbers.length}</strong></div>
      </div>
      {shown.length ? <div className="fuel-check-list">{shown.map((row) => <article key={row.contract} className={`fuel-check-row fuel-check-${row.status}`}>
        <div><Link href={`/contracts/${encodeURIComponent(row.contract)}`}>{row.contract}</Link><span>{row.status === "over" ? "Fuel over estimate" : "Mileage plan needed"}</span></div>
        <div><span>USPS completion</span><strong>{percent(row.completion)}</strong><small>{number(row.incomplete)} incomplete</small></div>
        <div><span>Purchased gallons</span><strong>{number(row.purchasedGallons, 1)}</strong></div>
        <div><span>{row.status === "over" ? "Expected / difference" : "Fuel estimate"}</span><strong>{row.status === "over" ? `${number(row.expectedGallons, 1)} / +${number(row.variancePercent, 1)}%` : "Not available"}</strong></div>
      </article>)}</div> : <div className="fuel-check-clear"><strong>No fuel-estimate alerts for these dates.</strong><span>All visible contracts have complete plans and are within their saved review thresholds.</span></div>}
      {checks.length > shown.length && <p className="fuel-check-more">Showing the first {shown.length} of {checks.length} checks. Open Fuel Reports to review every contract.</p>}
    </>}
  </section>;
}
