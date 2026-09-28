"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { estimateContractMileage, type MileagePlan } from "@/lib/fuelMileageEstimate";
import { supabase } from "@/lib/supabase";

type Totals = { loads: number; total: number; completed: number; incomplete: number };
type Fuel = { spend: number; gallons: number; expected: number; covered: number; days: number };
type Schedule = { trip_count: number; scheduled_payment: number; source_hours: number; term_days: number | null; snapshot_date: string };
type PayRate = { st_hourly: number | null; tt_hourly: number | null; fringe_hourly: number | null; car_hourly: number | null; daily_rate: number | null; needs_review: boolean; effective_start: string | null };
type PayHours = { hours: number; payrolls: number; first_period: string | null; last_period: string | null };
type PayPeriod = { payroll_name: string; period_start: string; period_end: string; hours: number };
const number = (value: number, digits = 0) => Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: digits });
const money = (value: number) => Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function ContractAtGlance({ contract, start, end, totals }: { contract: string; start: string; end: string; totals: Totals }) {
  const [fuel, setFuel] = useState<Fuel | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [payRate, setPayRate] = useState<PayRate | null>(null);
  const [payHours, setPayHours] = useState<PayHours | null>(null);
  const [payHoursError, setPayHoursError] = useState("");
  const [payPeriods, setPayPeriods] = useState<PayPeriod[]>([]);
  const [ratePlans, setRatePlans] = useState<MileagePlan[]>([]);
  const [financialAccess, setFinancialAccess] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!start || !end || start > end) return;
    let active = true;
    setLoading(true); setFuel(null); setSchedule(null); setPayRate(null); setPayHours(null); setPayHoursError(""); setPayPeriods([]); setRatePlans([]);
    void (async () => {
      const [purchases, plans, access] = await Promise.all([
        supabase.rpc("fuel_contract_purchases_for_estimate", { p_start: start, p_end: end, p_contracts: [contract] }),
        supabase.from("fuel_contract_mileage_plans").select("contract_number,effective_start,effective_end,annual_miles,assumed_mpg,tractor_count,straight_truck_count,van_count,alert_above_percent").eq("contract_number", contract).lte("effective_start", end),
        supabase.rpc("is_contract_financial_user"),
      ]);
      if (!active) return;
      if (!purchases.error && !plans.error) {
        setRatePlans((plans.data ?? []) as MileagePlan[]);
        const purchased = purchases.data?.[0];
        const estimate = estimateContractMileage((plans.data ?? []) as MileagePlan[], start, end);
        setFuel({ spend: Number(purchased?.purchased_fuel_cost ?? 0), gallons: Number(purchased?.purchased_gallons ?? 0),
          expected: estimate.expectedGallons, covered: estimate.coveredDays, days: estimate.totalDays });
      }
      setFinancialAccess(access.data === true);
      if (access.data === true) {
        const [result, rateResult, hoursResult, periodsResult] = await Promise.all([supabase.from("usps_contract_trip_snapshots")
          .select("trip_count,scheduled_payment,source_hours,term_days,snapshot_date")
          .eq("contract_number", contract)
          .order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
          supabase.from("contract_pay_rates").select("st_hourly,tt_hourly,fringe_hourly,car_hourly,daily_rate,needs_review,effective_start")
            .eq("contract_number", contract).maybeSingle(),
          supabase.rpc("contract_pay_estimate_hours", { p_contract: contract, p_start: start, p_end: end }),
          supabase.rpc("contract_payroll_periods", { p_contract: contract })]);
        if (active && !result.error) setSchedule(result.data as Schedule | null);
        if (active && !rateResult.error) setPayRate(rateResult.data as PayRate | null);
        if (active && !hoursResult.error) setPayHours((hoursResult.data?.[0] ?? null) as PayHours | null);
        if (active && hoursResult.error) setPayHoursError("Payroll hour summary unavailable. Run contract_pay_estimate_hours.sql in Supabase.");
        if (active && !periodsResult.error) setPayPeriods((periodsResult.data ?? []) as PayPeriod[]);
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [contract, start, end]);

  const fuelLink = `/fuel?contract=${encodeURIComponent(contract)}&start=${start}&end=${end}&view=report`;
  const complete = totals.total ? totals.completed / totals.total * 100 : 0;
  const uniformPlan = ratePlans.find((plan) => plan.effective_start <= start && (!plan.effective_end || plan.effective_end >= end));
  const stCount = Number(uniformPlan?.straight_truck_count ?? 0);
  const ttCount = Number(uniformPlan?.tractor_count ?? 0);
  const mixedRate = payRate?.st_hourly != null && payRate?.tt_hourly != null && uniformPlan && stCount > 0 && ttCount > 0 && Number(uniformPlan.van_count ?? 0) === 0
    ? (payRate.st_hourly * stCount + payRate.tt_hourly * ttCount) / (stCount + ttCount) : null;
  const singleRate = payRate && payRate.car_hourly === null && payRate.daily_rate === null &&
    ((payRate.st_hourly !== null && payRate.tt_hourly === null) || (payRate.tt_hourly !== null && payRate.st_hourly === null))
    ? (payRate.st_hourly ?? payRate.tt_hourly) : null;
  const applicableRate = Boolean(payRate && !payRate.needs_review && payRate.daily_rate === null && payRate.car_hourly === null && (singleRate !== null || mixedRate !== null));
  const baseRate = applicableRate ? Number(singleRate ?? mixedRate) : 0;
  const estimatedPay = applicableRate && payRate && payHours && Number(payHours.hours) > 0
    ? Number(payHours.hours) * (baseRate + Number(payRate.fringe_hourly ?? 0)) : null;
  const payStatus = loading ? "Checking payroll hours" : !payRate ? "Rate reference needed" :
    !applicableRate ? payRate.daily_rate !== null ? "Daily pay needs workdays" : payRate.needs_review ? "Location rate needs review" : "Truck mix needs review" :
    estimatedPay !== null ? `${payHours?.payrolls} saved payroll periods` : payHoursError ? "Payroll query needs setup" : payPeriods.length ? "Choose saved payroll dates" : "No saved hours in dates";
  return <>
    <section id="contract-overview" className="contract-overview no-print" aria-label="Contract at a glance">
      <div className="contract-overview-heading"><strong>At a glance</strong><span>{start} – {end} · Choose a card to see its detail</span></div>
      <nav className="contract-overview-grid" aria-label="Contract details">
        <a href="#contract-trend" className="contract-overview-card"><span>Completion</span><strong>{totals.total ? `${complete.toFixed(2)}%` : "—"}</strong><small>See performance trend ↓</small></a>
        <a href="#contract-trend" className="contract-overview-card"><span>Unique loads</span><strong>{number(totals.loads)}</strong><small>See performance trend ↓</small></a>
        <a href="#contract-trend" className="contract-overview-card"><span>Total stops</span><strong>{number(totals.total)}</strong><small>See performance trend ↓</small></a>
        <a href="#contract-missed" className="contract-overview-card"><span>Incomplete stops</span><strong>{number(totals.incomplete)}</strong><small>See dates and trips ↓</small></a>
        {fuel && <a href="#contract-fuel" className="contract-overview-card"><span>Fuel purchased</span><strong>{loading ? "…" : money(fuel.spend)}</strong><small>Diesel and gasoline · see detail ↓</small></a>}
        {financialAccess && <a href="#contract-schedule" className="contract-overview-card"><span>Latest USPS scheduled payment</span><strong>{schedule ? money(schedule.scheduled_payment) : "—"}</strong><small>{schedule ? `${number(schedule.trip_count)} trips · reviewed ${schedule.snapshot_date}` : "No reviewed schedule"} ↓</small></a>}
        {financialAccess && <a href="#contract-driver-pay" className="contract-overview-card"><span>Base pay + fringe estimate</span><strong>{estimatedPay === null ? "—" : money(estimatedPay)}</strong><small>{payStatus} ↓</small></a>}
        <a href="#contract-notes" className="contract-overview-card"><span>Trip notes</span><strong>Review</strong><small>See USPS issues ↓</small></a>
      </nav>
    </section>
    {fuel && <section id="contract-fuel" className="panel contract-financial-panel no-print">
      <div className="panel-heading"><div><p className="eyebrow">Selected dates</p><h2>Fuel</h2><span>Diesel and gasoline purchased for {contract} from {start} through {end}</span></div><Link className="hub-secondary-link" href={fuelLink}>Full fuel report →</Link></div>
      <div className="contract-financial-stats"><div><span>Fuel cost</span><strong>{money(fuel.spend)}</strong></div><div><span>Gallons purchased</span><strong>{number(fuel.gallons, 1)}</strong></div><div><span>Plan coverage</span><strong>{fuel.covered} of {fuel.days} days</strong></div>{fuel.covered === fuel.days && <div><span>Estimated gallons</span><strong>{number(fuel.expected, 1)}</strong></div>}</div>
      <p>Fuel purchases are assigned to this contract; filling a tank can shift purchases between date ranges. DEF, fees, and adjustments are in the full fuel report.</p>
    </section>}
    {financialAccess && <section id="contract-driver-pay" className="panel contract-financial-panel contract-pay-pending no-print">
      <div className="panel-heading"><div><p className="eyebrow">Cost planning</p><h2>Driver pay estimate</h2><span>Restricted rate reference and saved payroll hours</span></div><Link className="hub-secondary-link" href="/contracts/pay-rates">Review pay rates →</Link></div>
      {payRate ? <><div className="contract-financial-stats"><div><span>Straight truck / hour</span><strong>{payRate.st_hourly === null ? "—" : money(payRate.st_hourly)}</strong></div><div><span>Tractor trailer / hour</span><strong>{payRate.tt_hourly === null ? "—" : money(payRate.tt_hourly)}</strong></div><div><span>Fringe / worked hour</span><strong>{payRate.fringe_hourly === null ? "—" : money(payRate.fringe_hourly)}</strong></div><div><span>Car / hour</span><strong>{payRate.car_hourly === null ? "—" : money(payRate.car_hourly)}</strong></div>{payRate.daily_rate !== null && <div><span>Daily / driver</span><strong>{money(payRate.daily_rate)}</strong></div>}</div>
        {estimatedPay !== null && <div className="contract-financial-stats"><div><span>Saved payroll hours</span><strong>{number(Number(payHours?.hours), 2)}</strong></div><div><span>Estimated base + fringe</span><strong>{money(estimatedPay)}</strong></div></div>}
        {estimatedPay !== null ? <p>Estimate = saved hours × ({money(baseRate)} hourly + {money(Number(payRate.fringe_hourly ?? 0))} fringe). {mixedRate !== null && singleRate === null ? `The hourly rate weights ${stCount} straight truck(s) and ${ttCount} tractor(s) equally by truck; actual hours per truck may differ. ` : ""}It covers {payHours?.payrolls} complete saved payroll period{payHours?.payrolls === 1 ? "" : "s"} entirely within {start}–{end}{payHours?.first_period ? ` (${payHours.first_period}–${payHours.last_period})` : ""}. Rate effective date {payRate.effective_start ?? "is unverified"}. This excludes overtime premiums, taxes, benefits, and unsaved or partial payroll periods; it is not actual payroll cost or profit.</p>
          : <p>{payHoursError ? "Payroll hours cannot be checked until the database function is installed. " : !applicableRate ? payRate.daily_rate !== null ? "A daily rate needs the number of days worked; timecard summaries only store hours. " : payRate.needs_review ? "A location-specific rate needs review. " : "For mixed ST/TT pay, add dated straight-truck and tractor counts covering the selected dates. " : "No saved hours from a complete payroll period for this contract fall inside the selected dates. Choose a range containing an entire saved payroll period, or check the contract on the payroll upload. "}Rate effective date {payRate.effective_start ?? "has not been verified"}. No pay estimate is shown.</p>}</> : <p>No rate reference saved for this contract. Import the workbook to make the hourly figures available for review.</p>}
      {payPeriods.length > 0 && <details className="contract-pay-periods" open={estimatedPay === null}><summary>Saved payroll periods for {contract} ({payPeriods.length})</summary><p>Choose a payroll period to use its saved contract hours. The contract page dates will change to that entire payroll period.</p><div className="contract-pay-period-list">{payPeriods.map((period) => <Link key={`${period.period_start}-${period.period_end}`} className="hub-secondary-link" href={`/contracts/${encodeURIComponent(contract)}?start=${period.period_start}&end=${period.period_end}#contract-driver-pay`}>{period.payroll_name} · {period.period_start}–{period.period_end} · {number(Number(period.hours), 2)} hours →</Link>)}</div></details>}
      {payRate?.st_hourly != null && payRate.tt_hourly != null && <p><Link href={`/fuel?contract=${encodeURIComponent(contract)}&start=${start}&end=${end}&view=mileage`}>Set dated straight-truck and tractor counts in the fuel plan →</Link> Counts must cover all selected dates for a mixed-rate estimate.</p>}
      {payHoursError && <p className="alert alert-error">{payHoursError}</p>}
    </section>}
  </>;
}
