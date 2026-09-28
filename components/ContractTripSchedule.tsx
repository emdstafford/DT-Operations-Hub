"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { WorkbookTrip } from "@/lib/parseUspsContractWorkbook";

type Snapshot = { id: string; contract_number: string; snapshot_date: string; source_file: string; trip_count: number;
  source_miles: number; source_hours: number; scheduled_payment: number; term_days: number | null; created_at: string };
const number = (value: number, decimals = 1) => Number(value).toLocaleString("en-US", { maximumFractionDigits: decimals });
const money = (value: number) => Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function ContractTripSchedule({ contract }: { contract: string }) {
  const [allowed, setAllowed] = useState(false);
  const [versions, setVersions] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState("");
  const [trips, setTrips] = useState<WorkbookTrip[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      const permission = await supabase.rpc("is_contract_financial_user");
      if (!active || permission.data !== true) return;
      setAllowed(true);
      const result = await supabase.from("usps_contract_trip_snapshots")
        .select("id,contract_number,snapshot_date,source_file,trip_count,source_miles,source_hours,scheduled_payment,term_days,created_at")
        .eq("contract_number", contract.toUpperCase()).order("snapshot_date", { ascending: false }).order("created_at", { ascending: false }).limit(30);
      if (!active) return;
      if (result.error) setError(result.error.message);
      else {
        const saved = (result.data || []) as Snapshot[];
        setVersions(saved);
        setSelected(saved[0]?.id || "");
      }
    })();
    return () => { active = false; };
  }, [contract]);
  useEffect(() => {
    if (!selected) { setTrips([]); return; }
    let active = true;
    void supabase.from("usps_contract_trip_snapshots").select("trips").eq("id", selected).single().then(({ data, error: readError }) => {
      if (!active) return;
      if (readError) setError(readError.message);
      else setTrips((data?.trips || []) as WorkbookTrip[]);
    });
    return () => { active = false; };
  }, [selected]);
  if (!allowed) return null;
  const current = versions.find((item) => item.id === selected);
  return <section id="contract-schedule" className="panel contract-trip-panel no-print">
    <div className="panel-heading"><div><p className="eyebrow">Restricted financial data</p><h2>USPS trip schedule and rates</h2><span>Trips active when the workbook was reviewed. Earlier snapshots remain available.</span></div></div>
    {error && <p className="alert alert-error">{error}</p>}
    {!versions.length && !error && <p className="contract-trip-empty">No reviewed USPS trip workbook is saved for this contract yet. <Link href="/fuel">Import the workbook on Fuel Reports →</Link></p>}
    {current && <>
      <div className="contract-trip-version"><label>Reviewed version<select value={selected} onChange={(event) => setSelected(event.target.value)}>{versions.map((item) => <option key={item.id} value={item.id}>{item.snapshot_date} · {item.source_file}</option>)}</select></label><span>{current.trip_count} trips · {current.term_days ? `${current.term_days}-day term` : "Annual schedule"}</span></div>
      <div className="contract-trip-summary"><div><span>{current.term_days ? "Term miles" : "Scheduled annual miles"}</span><strong>{number(current.source_miles)}</strong></div><div><span>{current.term_days ? "Term hours" : "Scheduled annual hours"}</span><strong>{number(current.source_hours, 2)}</strong></div><div><span>{current.term_days ? "Term trip payment" : "Scheduled annual trip payment"}</span><strong>{money(current.scheduled_payment)}</strong></div></div>
      <p className="contract-trip-note">Trip payment is the USPS schedule projection for this version. It is not actual revenue received or contract profit.</p>
      <details className="contract-trip-details"><summary>Show {trips.length} trips</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>Trip</th><th>Frequency</th><th>Equipment</th><th>Runs</th><th>Miles/trip</th><th>Hours/trip</th><th>Trip payment</th><th>Schedule miles</th><th>Schedule payment</th><th>Effective</th><th>Expires</th></tr></thead><tbody>{trips.map((trip) => <tr key={trip.trip_number}><td><strong>{trip.trip_number}</strong></td><td>{trip.frequency_code || trip.frequency_description || "—"}</td><td>{trip.equipment_type || "—"}</td><td>{number(trip.annual_trip_count, 0)}</td><td>{number(trip.per_trip_miles)}</td><td>{number(trip.per_trip_hours, 2)}</td><td>{money(trip.unit_cost)}</td><td>{number(trip.annual_miles)}</td><td>{money(trip.scheduled_trip_payment)}</td><td>{trip.effective_start}</td><td>{trip.expiration_date}</td></tr>)}</tbody></table></div></details>
    </>}
  </section>;
}
