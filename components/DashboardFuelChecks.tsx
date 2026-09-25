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
  alertAbovePercent: number;
  coveredDays: number;
  totalDays: number;
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
  const [view, setView] = useState<"over" | "plan-needed">("over");
  const [showAll, setShowAll] = useState(false);
  const contractNumbers = useMemo(() => [...new Set(contracts.map((row) => row.contract_number || "").filter(Boolean))], [contracts]);
  const contractKey = contractNumbers.join("|");

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!contractNumbers.length) { setLoading(false); return; }
      setLoading(true);
      setAllowed(false);
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
      alertAbovePercent: estimate.alertAbovePercent,
      coveredDays: estimate.coveredDays,
      totalDays: estimate.totalDays,
      status: !complete ? "plan-needed" : variancePercent > estimate.alertAbovePercent ? "over" : null,
    };
  }).filter((row): row is Check => row.status !== null)
    .sort((a, b) => a.status === b.status ? b.variancePercent - a.variancePercent : a.status === "over" ? -1 : 1), [contracts, plans, purchases, start, end]);

  if (!allowed) return null;
  const over = checks.filter((row) => row.status === "over");
  const planNeeded = checks.filter((row) => row.status === "plan-needed");
  const activeView = view;
  const matching = activeView === "over" ? over : planNeeded;
  const shown = showAll ? matching : matching.slice(0, 5);
  const purchasedCost = purchases.reduce((sum, row) => sum + Number(row.purchased_fuel_cost || 0), 0);
  const purchasedGallons = purchases.reduce((sum, row) => sum + Number(row.purchased_gallons || 0), 0);

  return <section className="panel dashboard-fuel-checks">
    <div className="panel-heading"><div><p className="eyebrow">Fuel and operations</p><h2>Contracts to check</h2><span>{start} – {end} · Visible to approved fuel users</span></div><Link className="hub-secondary-link" href="/fuel">Fuel Reports →</Link></div>
    {loading ? <div className="hub-loading">Checking contract fuel estimates…</div> : <>
      <div className="dashboard-fuel-purchases"><div><span>Fuel spend on displayed contracts</span><strong>{purchasedCost.toLocaleString("en-US", { style: "currency", currency: "USD" })}</strong></div><div><span>Fuel gallons purchased</span><strong>{number(purchasedGallons, 1)}</strong></div></div>
      <div className="fuel-check-summary" role="group" aria-label="Fuel checks">
        <button type="button" className={activeView === "over" ? "active fuel-check-alert" : ""} onClick={() => { setView("over"); setShowAll(false); }} aria-pressed={activeView === "over"}><strong>{over.length}</strong><span>Over fuel estimate</span></button>
        <button type="button" className={activeView === "plan-needed" ? "active fuel-check-warning" : ""} onClick={() => { setView("plan-needed"); setShowAll(false); }} aria-pressed={activeView === "plan-needed"}><strong>{planNeeded.length}</strong><span>Need a mileage plan</span></button>
        <div><strong>{contractNumbers.length}</strong><span>Contracts in this view</span></div>
      </div>
      {shown.length ? <div className="fuel-check-list">{shown.map((row) => <article key={row.contract} className={`fuel-check-row fuel-check-${row.status}`}>
        <div className="fuel-check-identity"><Link href={`/fuel?contract=${encodeURIComponent(row.contract)}&start=${start}&end=${end}&view=mileage`}>{row.contract} · Fuel report →</Link><span><Link href={`/contracts/${encodeURIComponent(row.contract)}?start=${start}&end=${end}`}>USPS contract details</Link></span></div>
        <div className="fuel-check-reason"><span>{activeView === "over" ? "Above estimate" : "Plan covers"}</span><strong>{activeView === "over" ? `+${number(row.variancePercent, 1)}%` : `${number(row.coveredDays)} of ${number(row.totalDays)} days`}</strong>{activeView === "over" && <small>Review above {number(row.alertAbovePercent, 1)}%</small>}</div>
        <div className="fuel-check-detail"><span>{activeView === "over" ? "Fuel gallons · bought / expected" : "Fuel gallons purchased"}</span><strong>{activeView === "over" ? `${number(row.purchasedGallons, 1)} / ${number(row.expectedGallons, 1)}` : number(row.purchasedGallons, 1)}</strong></div>
        <div className="fuel-check-detail"><span>USPS completion</span><strong>{percent(row.completion)}</strong><small>{number(row.incomplete)} incomplete stops</small></div>
      </article>)}</div> : <div className="fuel-check-clear"><strong>{activeView === "over" ? "No contracts are over their fuel estimate." : "Every contract has a mileage plan for these dates."}</strong><span>{activeView === "over" ? "Select “Need a mileage plan” to see contracts without full coverage." : "Select “Over fuel estimate” to see contracts above their saved threshold."}</span></div>}
      {matching.length > shown.length && <button type="button" className="fuel-check-expand" onClick={() => setShowAll(true)}>Show all {number(matching.length)} contracts ↓</button>}
      {showAll && matching.length > 5 && <button type="button" className="fuel-check-expand" onClick={() => setShowAll(false)}>Show fewer ↑</button>}
      <p className="fuel-check-more">Fuel is an estimate based on planned miles and MPG. Purchases can move between date ranges when a truck refuels.</p>
    </>}
  </section>;
}
