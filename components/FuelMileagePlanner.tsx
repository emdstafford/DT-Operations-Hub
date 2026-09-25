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
const DEFAULT_MPG = { tractor: 6.4, straight: 8.5, van: 12 } as const;
const validVehicleCounts = (...values: string[]) => values.every((value) => value !== "" && Number.isInteger(Number(value)) && Number(value) >= 0) && values.some((value) => Number(value) > 0);
const mixedMpg = (tractors: number, straightTrucks: number, vans: number) =>
  (tractors + straightTrucks + vans) / (tractors / DEFAULT_MPG.tractor + straightTrucks / DEFAULT_MPG.straight + vans / DEFAULT_MPG.van);

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
  const [truckType, setTruckType] = useState("custom");
  const [tractors, setTractors] = useState("");
  const [straightTrucks, setStraightTrucks] = useState("");
  const [vans, setVans] = useState("");
  const [threshold, setThreshold] = useState("15");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selected = selectedContract ? [selectedContract] : contracts;
  const planContracts = [...new Set([...selected, ...(planContract ? [planContract] : [])])];
  const contractKey = planContracts.join("|");

  const refresh = useCallback(async () => {
    if (!planContracts.length || !start || !end) { setPlans([]); setPurchases([]); return; }
    const [planResult, purchaseResult] = await Promise.all([
      supabase.from("fuel_contract_mileage_plans").select("contract_number,effective_start,effective_end,annual_miles,assumed_mpg,tractor_count,straight_truck_count,van_count,alert_above_percent").in("contract_number", planContracts).order("effective_start"),
      supabase.rpc("fuel_contract_purchases_for_estimate", { p_start: start, p_end: end, p_contracts: selected }),
    ]);
    const missingColumn = (code?: string) => ["42703", "PGRST204", "PGRST200"].includes(code ?? "");
    const needsVanMigration = missingColumn(planResult.error?.code);
    const priorPlans = needsVanMigration
      ? await supabase.from("fuel_contract_mileage_plans").select("contract_number,effective_start,effective_end,annual_miles,assumed_mpg,tractor_count,straight_truck_count,alert_above_percent").in("contract_number", planContracts).order("effective_start")
      : null;
    const needsCountMigration = Boolean(priorPlans && missingColumn(priorPlans.error?.code));
    const legacyPlans = needsCountMigration
      ? await supabase.from("fuel_contract_mileage_plans").select("contract_number,effective_start,effective_end,annual_miles,assumed_mpg,alert_above_percent").in("contract_number", planContracts).order("effective_start")
      : null;
    const currentPlans = legacyPlans ?? priorPlans ?? planResult;
    if (currentPlans.error || purchaseResult.error) {
      setError("To enable mileage estimates, run fuel_mileage_estimates.sql in Supabase.");
      setPlans([]); setPurchases([]);
      return;
    }
    setError(needsVanMigration ? "To use van counts and updated MPG assumptions, run fuel_mpg_assumptions.sql in Supabase. Saved estimates remain visible." : "");
    setPlans((currentPlans.data ?? []) as MileagePlan[]);
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
    const savedMpg = previous ? String(previous.assumed_mpg) : "";
    setMpg(savedMpg);
    setTractors(previous?.tractor_count != null ? String(previous.tractor_count) : "");
    setStraightTrucks(previous?.straight_truck_count != null ? String(previous.straight_truck_count) : "");
    setVans(previous?.van_count != null ? String(previous.van_count) : "");
    const counts = [Number(previous?.tractor_count ?? 0), Number(previous?.straight_truck_count ?? 0), Number(previous?.van_count ?? 0)];
    const types = counts.filter((count) => count > 0).length;
    setTruckType(types > 1 ? "mixed" : counts[0] > 0 ? "tractor" : counts[1] > 0 ? "straight" : counts[2] > 0 ? "van" : savedMpg === "6.4" ? "tractor" : savedMpg === "8.5" ? "straight" : savedMpg === "12" ? "van" : "custom");
    setThreshold(previous ? String(previous.alert_above_percent) : "15");
  }

  async function savePlan() {
    const miles = Number(annualMiles), alert = Number(threshold);
    const tractorCount = Number(tractors), straightCount = Number(straightTrucks), vanCount = Number(vans);
    const validMix = truckType !== "mixed" || ([tractors, straightTrucks, vans].every((count) => count !== "") && [tractorCount, straightCount, vanCount].every((count) => Number.isInteger(count) && count >= 0) && tractorCount + straightCount + vanCount > 0);
    const assumedMpg = truckType === "mixed" && validMix ? mixedMpg(tractorCount, straightCount, vanCount) : Number(mpg);
    if (!canEdit || !planContract || !effectiveStart || !Number.isFinite(miles) || miles <= 0 || !validMix || !Number.isFinite(assumedMpg) || assumedMpg <= 0 || !Number.isFinite(alert) || alert < 0 || alert > 200 || (effectiveEnd && effectiveEnd < effectiveStart)) {
      setError("Choose a contract, valid effective dates, annual miles, MPG above zero, and a review threshold from 0% to 200%.");
      return;
    }
    setSaving(true); setError(""); setMessage("");
    const { data: user } = await supabase.auth.getUser();
    const { error: saveError } = await supabase.from("fuel_contract_mileage_plans").upsert({
      contract_number: planContract, effective_start: effectiveStart, effective_end: effectiveEnd || null,
      annual_miles: miles, assumed_mpg: assumedMpg, alert_above_percent: alert, updated_by: user.user?.id,
      tractor_count: truckType === "mixed" ? tractorCount : truckType === "tractor" ? 1 : truckType === "straight" || truckType === "van" ? 0 : null,
      straight_truck_count: truckType === "mixed" ? straightCount : truckType === "straight" ? 1 : truckType === "tractor" || truckType === "van" ? 0 : null,
      van_count: truckType === "mixed" ? vanCount : truckType === "van" ? 1 : truckType === "tractor" || truckType === "straight" ? 0 : null,
    }, { onConflict: "contract_number,effective_start" });
    if (saveError) setError(saveError.code === "23P01" ? "These dates overlap another mileage plan for this contract. End the earlier plan before adding this one." : ["42703", "PGRST204"].includes(saveError.code) ? "Run fuel_mpg_assumptions.sql in Supabase before saving updated vehicle counts." : saveError.message);
    else { await refresh(); setMessage(`Saved mileage plan for ${planContract} starting ${effectiveStart}. Open “Saved plan dates” below to view or edit it; estimates use the selected report dates.`); }
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
      <label>Truck type starting point<select value={truckType} onChange={(event) => {
        const type = event.target.value;
        setTruckType(type);
        if (type === "tractor") setMpg(String(DEFAULT_MPG.tractor));
        if (type === "straight") setMpg(String(DEFAULT_MPG.straight));
        if (type === "van") setMpg(String(DEFAULT_MPG.van));
      }}><option value="custom">Enter a custom MPG</option><option value="tractor">Tractor (6.4 MPG)</option><option value="straight">Straight truck (8.5 MPG)</option><option value="van">Van (12 MPG)</option><option value="mixed">Mixed fleet (enter counts)</option></select></label>
      {truckType === "mixed" && <>
        <label>Number of tractors<input type="number" min="0" step="1" value={tractors} onChange={(event) => setTractors(event.target.value)} /></label>
        <label>Number of straight trucks<input type="number" min="0" step="1" value={straightTrucks} onChange={(event) => setStraightTrucks(event.target.value)} /></label>
        <label>Number of vans<input type="number" min="0" step="1" value={vans} onChange={(event) => setVans(event.target.value)} /></label>
        {validVehicleCounts(tractors, straightTrucks, vans) && <p>Estimated fleet average: {number(mixedMpg(Number(tractors), Number(straightTrucks), Number(vans)), 2)} MPG, assuming each vehicle drives similar miles.</p>}
      </>}
      {truckType !== "mixed" && <label>Estimated miles per gallon (editable)<input type="number" min="0.01" step="0.1" value={mpg} onChange={(event) => {
        const value = event.target.value;
        setMpg(value);
        if ((truckType === "tractor" && value !== String(DEFAULT_MPG.tractor)) || (truckType === "straight" && value !== String(DEFAULT_MPG.straight)) || (truckType === "van" && value !== String(DEFAULT_MPG.van))) setTruckType("custom");
      }} /></label>}
      <label>Flag when over expected by (%)<input type="number" min="0" max="200" step="0.1" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
      <button type="button" className="primary-link" disabled={saving} onClick={() => void savePlan()}>{saving ? "Saving…" : "Save mileage plan"}</button>
    </div><p>For a service change, set the previous plan’s end date, then add the new annual miles with its own effective start date. You can select an existing start date to revise its values.</p></details>}
    {plans.length > 0 && <details className="fuel-mileage-editor"><summary>Saved plan dates ({plans.length})</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>From</th><th>Through</th><th>Annual miles</th><th>Tractors</th><th>Straight trucks</th><th>Vans</th><th>MPG</th><th>Review above</th><th></th></tr></thead><tbody>{plans.map((plan) => <tr key={`${plan.contract_number}-${plan.effective_start}`}><td>{plan.contract_number}</td><td>{plan.effective_start}</td><td>{plan.effective_end || "Current"}</td><td>{number(plan.annual_miles,1)}</td><td>{plan.tractor_count ?? "—"}</td><td>{plan.straight_truck_count ?? "—"}</td><td>{plan.van_count ?? "—"}</td><td>{number(plan.assumed_mpg,2)}</td><td>{number(plan.alert_above_percent,1)}%</td><td>{canEdit && <button className="hub-secondary-link" type="button" onClick={() => choosePlan(plan.contract_number,plan.effective_start)}>Edit</button>}</td></tr>)}</tbody></table></div></details>}
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>Planned miles</th><th>Expected gallons</th><th>Purchased gallons</th><th>Difference</th><th>Fuel spend</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.contract} className={row.status === "review" ? "fuel-policy-alert-row" : ""}><td className="font-semibold text-navy">{row.contract}</td><td>{row.status === "incomplete" ? "—" : number(row.plannedMiles,1)}</td><td>{row.status === "incomplete" ? "—" : number(row.expectedGallons,1)}</td><td>{number(row.purchasedGallons,1)}</td><td>{row.status === "incomplete" ? "—" : `${row.variancePercent >= 0 ? "+" : ""}${number(row.variancePercent,1)}%`}</td><td>{currency(row.purchasedFuelCost)}</td><td>{row.status === "incomplete" ? `Plan needed (${row.coveredDays}/${row.totalDays} days)` : row.status === "review" ? `Needs review (>${number(row.alertAbovePercent,1)}%)` : "Within estimate"}</td></tr>)}</tbody></table></div>
    <p className="fuel-mileage-note">A fuel variance measures purchases against an MPG estimate; it does not confirm actual miles driven, misuse, or contract profit. DEF and fees are excluded. Changing an MPG assumption updates the estimate for all dates in that plan.</p>
  </section>;
}
