"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { estimateContractMileage, type MileagePlan } from "@/lib/fuelMileageEstimate";
import { supabase } from "@/lib/supabase";

export type FuelMileageRow = {
  contract: string;
  plannedMiles: number;
  expectedGallons: number;
  purchasedGallons: number;
  purchasedFuelCost: number;
  variancePercent: number;
  alertAbovePercent: number;
  coveredDays: number;
  totalDays: number;
  status: "review" | "in-range" | "incomplete";
};

type Purchase = { contract_number: string; purchased_gallons: number; purchased_fuel_cost: number };
const number = (value: number, decimals = 0) => Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
const currency = (value: number) => Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function FuelMileagePlanner({ start, end, contracts, planOptions, selectedContract, canEdit, onRowsChange }: {
  start: string; end: string; contracts: string[]; planOptions: string[]; selectedContract: string;
  canEdit: boolean; onRowsChange: (rows: FuelMileageRow[]) => void;
}) {
  const [plans, setPlans] = useState<MileagePlan[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [planContract, setPlanContract] = useState("");
  const [effectiveStart, setEffectiveStart] = useState("");
  const [effectiveEnd, setEffectiveEnd] = useState("");
  const [annualMiles, setAnnualMiles] = useState("");
  const [mpg, setMpg] = useState("");
  const [threshold, setThreshold] = useState("15");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selected = selectedContract ? [selectedContract] : contracts;
  const contractKey = selected.join("|");

  const refresh = useCallback(async () => {
    if (!selected.length || !start || !end) { setPlans([]); setPurchases([]); return; }
    const [planResult, purchaseResult] = await Promise.all([
      supabase.from("fuel_contract_mileage_plans").select("contract_number,effective_start,effective_end,annual_miles,assumed_mpg,alert_above_percent").in("contract_number", selected).lte("effective_start", end).order("effective_start"),
      supabase.rpc("fuel_contract_purchases_for_estimate", { p_start: start, p_end: end, p_contracts: selected }),
    ]);
    if (planResult.error || purchaseResult.error) {
      setError("To enable mileage estimates, run fuel_mileage_estimates.sql in Supabase.");
      setPlans([]); setPurchases([]);
      return;
    }
    setError("");
    setPlans((planResult.data ?? []) as MileagePlan[]);
    setPurchases((purchaseResult.data ?? []) as Purchase[]);
  // contractKey represents the exact selection; avoid refetching when parent recreates its array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, contractKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo(() => selected.map((contract): FuelMileageRow => {
    const estimate = estimateContractMileage(plans.filter((plan) => plan.contract_number === contract), start, end);
    const purchase = purchases.find((item) => item.contract_number === contract);
    const purchasedGallons = Number(purchase?.purchased_gallons ?? 0);
    const variancePercent = estimate.expectedGallons > 0 ? (purchasedGallons / estimate.expectedGallons - 1) * 100 : 0;
    const complete = estimate.totalDays > 0 && estimate.coveredDays === estimate.totalDays;
    return {
      contract, ...estimate,
      purchasedGallons, purchasedFuelCost: Number(purchase?.purchased_fuel_cost ?? 0),
      variancePercent, status: !complete ? "incomplete" : variancePercent > estimate.alertAbovePercent ? "review" : "in-range",
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [contractKey, plans, purchases, start, end]);

  useEffect(() => { onRowsChange(rows); }, [rows, onRowsChange]);

  function choosePlan(contract: string, date: string) {
    setPlanContract(contract); setEffectiveStart(date);
    const previous = plans.find((item) => item.contract_number === contract && item.effective_start === date);
    setEffectiveEnd(previous?.effective_end ?? "");
    setAnnualMiles(previous ? String(previous.annual_miles) : "");
    setMpg(previous ? String(previous.assumed_mpg) : "");
    setThreshold(previous ? String(previous.alert_above_percent) : "15");
  }

  async function savePlan() {
    const miles = Number(annualMiles), assumedMpg = Number(mpg), alert = Number(threshold);
    if (!canEdit || !planContract || !effectiveStart || !Number.isFinite(miles) || miles <= 0 || !Number.isFinite(assumedMpg) || assumedMpg <= 0 || !Number.isFinite(alert) || alert < 0 || alert > 200 || (effectiveEnd && effectiveEnd < effectiveStart)) {
      setError("Choose a contract, valid effective dates, annual miles, MPG above zero, and a review threshold from 0% to 200%.");
      return;
    }
    setSaving(true); setError(""); setMessage("");
    const { data: user } = await supabase.auth.getUser();
    const { error: saveError } = await supabase.from("fuel_contract_mileage_plans").upsert({
      contract_number: planContract, effective_start: effectiveStart, effective_end: effectiveEnd || null,
      annual_miles: miles, assumed_mpg: assumedMpg, alert_above_percent: alert, updated_by: user.user?.id,
    }, { onConflict: "contract_number,effective_start" });
    if (saveError) setError(saveError.code === "23P01" ? "These dates overlap another mileage plan for this contract. End the earlier plan before adding this one." : saveError.message);
    else { setMessage(`Saved mileage plan for ${planContract}.`); await refresh(); }
    setSaving(false);
  }

  return <section className="panel fuel-mileage-panel">
    <div className="panel-heading"><div><p className="eyebrow">Fuel planning</p><h2>Planned miles and fuel purchased</h2><span>Estimate uses annual schedule miles divided across the calendar year, then the MPG assumption. Purchases may shift between periods when tanks are filled.</span></div></div>
    {error && <p className="alert alert-error">{error}</p>}{message && <p className="alert fuel-success">{message}</p>}
    {canEdit && <details className="fuel-mileage-editor"><summary>Add or update a dated mileage plan</summary><div className="fuel-mileage-fields">
      <label>Contract<select value={planContract} onChange={(event) => choosePlan(event.target.value, "")}><option value="">Choose contract</option>{planOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Effective from<input type="date" value={effectiveStart} onChange={(event) => choosePlan(planContract, event.target.value)} /></label>
      <label>Effective through (optional)<input type="date" value={effectiveEnd} onChange={(event) => setEffectiveEnd(event.target.value)} /></label>
      <label>Planned miles per year<input type="number" min="0.01" step="0.1" value={annualMiles} onChange={(event) => setAnnualMiles(event.target.value)} /></label>
      <label>Estimated miles per gallon<input type="number" min="0.01" step="0.1" value={mpg} onChange={(event) => setMpg(event.target.value)} /></label>
      <label>Flag when over expected by (%)<input type="number" min="0" max="200" step="0.1" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
      <button type="button" className="primary-link" disabled={saving} onClick={() => void savePlan()}>{saving ? "Saving…" : "Save mileage plan"}</button>
    </div><p>For a service change, set the previous plan’s end date, then add the new annual miles with its own effective start date. You can select an existing start date to revise its values.</p></details>}
    {plans.length > 0 && <details className="fuel-mileage-editor"><summary>Saved plan dates ({plans.length})</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>From</th><th>Through</th><th>Annual miles</th><th>MPG</th><th>Review above</th><th></th></tr></thead><tbody>{plans.map((plan) => <tr key={`${plan.contract_number}-${plan.effective_start}`}><td>{plan.contract_number}</td><td>{plan.effective_start}</td><td>{plan.effective_end || "Current"}</td><td>{number(plan.annual_miles,1)}</td><td>{number(plan.assumed_mpg,1)}</td><td>{number(plan.alert_above_percent,1)}%</td><td>{canEdit && <button className="hub-secondary-link" type="button" onClick={() => choosePlan(plan.contract_number,plan.effective_start)}>Edit</button>}</td></tr>)}</tbody></table></div></details>}
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>Planned miles</th><th>Expected gallons</th><th>Purchased gallons</th><th>Difference</th><th>Fuel spend</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.contract} className={row.status === "review" ? "fuel-policy-alert-row" : ""}><td className="font-semibold text-navy">{row.contract}</td><td>{row.status === "incomplete" ? "—" : number(row.plannedMiles,1)}</td><td>{row.status === "incomplete" ? "—" : number(row.expectedGallons,1)}</td><td>{number(row.purchasedGallons,1)}</td><td>{row.status === "incomplete" ? "—" : `${row.variancePercent >= 0 ? "+" : ""}${number(row.variancePercent,1)}%`}</td><td>{currency(row.purchasedFuelCost)}</td><td>{row.status === "incomplete" ? `Plan needed (${row.coveredDays}/${row.totalDays} days)` : row.status === "review" ? `Needs review (>${number(row.alertAbovePercent,1)}%)` : "Within estimate"}</td></tr>)}</tbody></table></div>
    <p className="fuel-mileage-note">A fuel variance measures purchases against an MPG estimate; it does not confirm actual miles driven, misuse, or contract profit. DEF and fees are excluded. Changing an MPG assumption updates the estimate for all dates in that plan.</p>
  </section>;
}
