"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { MileagePlan } from "@/lib/fuelMileageEstimate";

type Assignment = { supervisor: string; start_date: string; end_date: string | null };
type CurrentAssignment = { supervisor: string };

const number = (value: number, decimals = 0) => Number(value || 0).toLocaleString("en-US", {
  minimumFractionDigits: decimals,
  maximumFractionDigits: decimals,
});

function names(values: Array<string | null | undefined>) {
  return [...new Set(values.flatMap((value) => String(value ?? "").split("/")).map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

export default function ContractPlanningSummary({ contract }: { contract: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [currentAssignments, setCurrentAssignments] = useState<CurrentAssignment[]>([]);
  const [plans, setPlans] = useState<MileagePlan[]>([]);
  const [fuelAccess, setFuelAccess] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: user } = await supabase.auth.getUser();
      const [dated, current, fuelPlans, permission] = await Promise.all([
        supabase.from("contract_assignment_periods").select("supervisor,start_date,end_date").eq("contract_number", contract).order("start_date", { ascending: false }),
        supabase.from("contract_supervisors").select("supervisor").eq("contract_number", contract),
        supabase.from("fuel_contract_mileage_plans").select("contract_number,effective_start,effective_end,annual_miles,assumed_mpg,tractor_count,straight_truck_count,alert_above_percent").eq("contract_number", contract).order("effective_start", { ascending: false }),
        supabase.from("fuel_tool_users").select("email").eq("email", user.user?.email?.toLowerCase() ?? "").eq("active", true).maybeSingle(),
      ]);
      if (!active) return;
      setAssignments((dated.data ?? []) as Assignment[]);
      setCurrentAssignments((current.data ?? []) as CurrentAssignment[]);
      // Fuel plans are intentionally hidden by RLS from accounts without fuel-report access.
      setFuelAccess(Boolean(permission.data));
      if (permission.data && !fuelPlans.error) setPlans((fuelPlans.data ?? []) as MileagePlan[]);
    })();
    return () => { active = false; };
  }, [contract]);

  const today = new Date().toISOString().slice(0, 10);
  const supervisors = useMemo(() => {
    const active = assignments.filter((item) => item.start_date <= today && (!item.end_date || item.end_date >= today));
    return names(active.length ? active.map((item) => item.supervisor) : currentAssignments.map((item) => item.supervisor));
  }, [assignments, currentAssignments, today]);

  if (!supervisors.length && !fuelAccess) return null;

  return <section className="panel contract-planning-panel">
    <div className="panel-heading"><div><p className="eyebrow">Contract planning</p><h2>Assignment and fuel plan</h2></div>{fuelAccess && <Link className="hub-secondary-link no-print" href={`/fuel?contract=${encodeURIComponent(contract)}&view=mileage`}>See contract fuel report →</Link>}</div>
    {supervisors.length > 0 && <div className="contract-supervisor-summary">
      <span>Current supervisor{supervisors.length === 1 ? "" : "s"}</span>
      <div>{supervisors.map((name) => <strong key={name}>{name}</strong>)}</div>
    </div>}
    {plans.length > 0 && <div className="table-scroll"><table className="data-table">
      <thead><tr><th>Effective dates</th><th>Annual miles</th><th>Tractors</th><th>Straight trucks</th><th>Estimated MPG</th></tr></thead>
      <tbody>{plans.map((plan) => <tr key={plan.effective_start}>
        <td>{plan.effective_start} – {plan.effective_end || "Current"}</td>
        <td>{number(plan.annual_miles, 1)}</td>
        <td>{plan.tractor_count ?? "—"}</td>
        <td>{plan.straight_truck_count ?? "—"}</td>
        <td>{number(plan.assumed_mpg, 2)}</td>
      </tr>)}</tbody>
    </table></div>}
    {fuelAccess && !plans.length && <p className="contract-planning-empty">No dated fuel plan saved yet. Add one in Fuel Reports.</p>}
  </section>;
}
