"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUploadHandoff } from "@/components/UploadHandoff";
import { parseUspsSchedule } from "@/lib/parseUspsSchedule";
import { parseUspsContractWorkbook, type WorkbookTrip } from "@/lib/parseUspsContractWorkbook";
import { supabase } from "@/lib/supabase";

type Candidate = {
  id: string;
  fileName: string;
  contract: string;
  miles: string;
  page: number | null;
  start: string;
  end: string;
  mpg: string;
  selected: boolean;
  issue: string;
  trips?: number;
  excludedTrips?: number;
  hours?: number | null;
  payment?: number | null;
  termMiles?: number | null;
  termDays?: number | null;
  termStart?: string;
  termEnd?: string;
  tripRows?: WorkbookTrip[];
  equipment: { code: string; trips: number }[];
  truckType: "average" | "tractor" | "straight" | "van" | "mixed" | "custom";
  tractors: string;
  straightTrucks: string;
  vans: string;
  saveMileage: boolean;
};
type ExistingPlan = {
  contract_number: string;
  effective_start: string;
  effective_end: string | null;
  annual_miles: number;
  assumed_mpg: number;
  alert_above_percent: number;
  tractor_count: number | null;
  straight_truck_count: number | null;
  van_count: number | null;
};

const contractFromName = (name: string) => name.match(/\b(\d{4}[A-Z]|\d{3}[A-Z]\d|\d{2}[A-Z]\d{2})\b/i)?.[1]?.toUpperCase() || "";
const overlaps = (start: string, end: string, plan: ExistingPlan) =>
  start <= (plan.effective_end || "9999-12-31") && plan.effective_start <= (end || "9999-12-31");
const MPG = { tractor: 6.4, straight: 8.5, van: 12, average: 7.45 } as const;
const mixedMpg = (tractors: number, straight: number, vans: number) =>
  (tractors + straight + vans) / (tractors / MPG.tractor + straight / MPG.straight + vans / MPG.van);
function typeFromPlan(plan: ExistingPlan | undefined): Candidate["truckType"] {
  if (!plan) return "average";
  const counts = [plan.tractor_count ?? 0, plan.straight_truck_count ?? 0, plan.van_count ?? 0];
  if (counts.filter((count) => count > 0).length > 1) return "mixed";
  return counts[0] > 0 ? "tractor" : counts[1] > 0 ? "straight" : counts[2] > 0 ? "van" : plan.assumed_mpg === MPG.average ? "average" : "custom";
}

export default function FuelBulkMileageImport({ onSaved }: { onSaved: () => void }) {
  const handoff = useUploadHandoff();
  const [rows, setRows] = useState<Candidate[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [plans, setPlans] = useState<ExistingPlan[]>([]);
  const [commonStart, setCommonStart] = useState("");
  const [commonEnd, setCommonEnd] = useState("");
  const [commonMpg, setCommonMpg] = useState("");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [sourceWorkbook, setSourceWorkbook] = useState<{ name: string; hash: string } | null>(null);
  const [canStoreTrips, setCanStoreTrips] = useState(false);
  const [tripsSaved, setTripsSaved] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void supabase.rpc("is_contract_financial_user").then(({ data }) => setCanStoreTrips(data === true));
  }, []);

  function change(id: string, update: Partial<Candidate>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...update } : row));
    setConfirmed(false);
  }
  function chooseTruckType(row: Candidate, truckType: Candidate["truckType"]) {
    change(row.id, {
      truckType, mpg: truckType === "custom" ? row.mpg : truckType === "mixed" ? "" : String(MPG[truckType]),
      tractors: truckType === "tractor" ? "1" : truckType === "straight" || truckType === "van" || truckType === "average" ? "0" : row.tractors,
      straightTrucks: truckType === "straight" ? "1" : truckType === "tractor" || truckType === "van" || truckType === "average" ? "0" : row.straightTrucks,
      vans: truckType === "van" ? "1" : truckType === "tractor" || truckType === "straight" || truckType === "average" ? "0" : row.vans,
    });
  }
  function changeTruckCount(row: Candidate, field: "tractors" | "straightTrucks" | "vans", count: string) {
    const next = { tractors: row.tractors, straightTrucks: row.straightTrucks, vans: row.vans, [field]: count };
    const numbers = [next.tractors, next.straightTrucks, next.vans];
    const valid = numbers.every((n) => n !== "" && Number.isInteger(Number(n)) && Number(n) >= 0) && numbers.some((n) => Number(n) > 0);
    change(row.id, { ...next, mpg: valid ? String(Number(mixedMpg(Number(next.tractors), Number(next.straightTrucks), Number(next.vans)).toFixed(3))) : "" });
  }

  async function readFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    setExpanded(true);
    setError(""); setMessage(""); setConfirmed(false); setRows([]); setPlans([]); setSourceWorkbook(null); setTripsSaved([]);
    const chosen = Array.from(files);
    const workbookFiles = chosen.filter((file) => /\.(xlsx|xlsm|xls)$/i.test(file.name));
    const pdfFiles = chosen.filter((file) => /\.pdf$/i.test(file.name));
    if (chosen.length > 30 || workbookFiles.length > 1 || chosen.length !== workbookFiles.length + pdfFiles.length) {
      setError("Choose one USPS contract workbook or up to 30 schedule PDFs at a time."); return;
    }
    setWorking(true);
    try {
      const candidates: Candidate[] = [];
      if (workbookFiles.length) {
        const workbook = workbookFiles[0];
        const summaries = await parseUspsContractWorkbook(workbook, asOf);
        const digest = await crypto.subtle.digest("SHA-256", await workbook.arrayBuffer());
        setSourceWorkbook({ name: workbook.name, hash: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") });
        for (const [index, summary] of summaries.entries()) {
          const equipmentCounts = new Map<string, number>();
          for (const trip of summary.tripRows) equipmentCounts.set(trip.equipment_type || "Unspecified", (equipmentCounts.get(trip.equipment_type || "Unspecified") || 0) + 1);
          candidates.push({ id: `workbook-${index}-${summary.sheet}`, fileName: `${workbook.name} · ${summary.sheet}`,
            contract: summary.contract, miles: summary.annualMiles == null ? "" : String(summary.annualMiles),
            page: null, start: commonStart || (summary.termDays ? summary.termStart : asOf), end: commonEnd || summary.earliestExpiration,
            mpg: commonMpg || String(MPG.average), selected: !summary.issue, issue: summary.issue,
            trips: summary.activeTrips, excludedTrips: summary.excludedTrips,
            hours: summary.annualHours, payment: summary.scheduledPayment,
            termMiles: summary.termMiles, termDays: summary.termDays,
            termStart: summary.termStart, termEnd: summary.earliestExpiration, tripRows: summary.tripRows,
            equipment: [...equipmentCounts].map(([code, trips]) => ({ code, trips })),
            truckType: commonMpg ? "custom" : "average", tractors: "", straightTrucks: "", vans: "", saveMileage: true });
        }
      }
      for (const [index, file] of pdfFiles.entries()) {
        try {
          const result = await parseUspsSchedule(file);
          const fromName = contractFromName(file.name);
          const issue = !result.contractNumber ? "Contract number missing" :
            fromName && fromName !== result.contractNumber ? `Filename says ${fromName}; PDF says ${result.contractNumber}` :
            result.annualMiles == null ? "No unambiguous labeled annual miles near the top; check this PDF manually" : "";
          candidates.push({ id: `${index}-${file.name}`, fileName: file.name, contract: result.contractNumber,
            miles: result.annualMiles == null ? "" : String(result.annualMiles), page: result.annualMilesPage,
            start: commonStart, end: commonEnd, mpg: commonMpg || String(MPG.average), selected: !issue, issue,
            equipment: [], truckType: commonMpg ? "custom" : "average", tractors: "", straightTrucks: "", vans: "", saveMileage: true });
        } catch {
          candidates.push({ id: `${index}-${file.name}`, fileName: file.name, contract: contractFromName(file.name),
            miles: "", page: null, start: commonStart, end: commonEnd, mpg: commonMpg || String(MPG.average),
            selected: false, issue: "PDF could not be read; use the individual mileage plan editor",
            equipment: [], truckType: commonMpg ? "custom" : "average", tractors: "", straightTrucks: "", vans: "", saveMileage: true });
        }
      }
      const contracts = [...new Set(candidates.map((row) => row.contract).filter(Boolean))];
      if (contracts.length) {
        const { data, error: lookupError } = await supabase.from("fuel_contract_mileage_plans")
          .select("contract_number,effective_start,effective_end,annual_miles,assumed_mpg,alert_above_percent,tractor_count,straight_truck_count,van_count")
          .in("contract_number", contracts).order("effective_start");
        if (lookupError) throw lookupError;
        const existing = (data || []) as ExistingPlan[];
        setPlans(existing);
        candidates.forEach((row) => {
          const latest = existing.filter((plan) => plan.contract_number === row.contract).at(-1);
          if (latest && !commonMpg) {
            row.mpg = String(latest.assumed_mpg);
            row.truckType = typeFromPlan(latest);
            row.tractors = latest.tractor_count == null ? "" : String(latest.tractor_count);
            row.straightTrucks = latest.straight_truck_count == null ? "" : String(latest.straight_truck_count);
            row.vans = latest.van_count == null ? "" : String(latest.van_count);
          }
          const overlap = existing.find((plan) => plan.contract_number === row.contract && row.start && overlaps(row.start, row.end, plan));
          if (overlap && (overlap.effective_start !== row.start || (overlap.effective_end || "") !== row.end)) row.saveMileage = false;
        });
      }
      setRows(candidates);
      setMessage(`${candidates.length} contract source${candidates.length === 1 ? "" : "s"} read locally. Check the figures, dates, and MPG before importing.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The saved mileage plans could not be checked.");
    } finally { setWorking(false); }
  }
  useEffect(() => {
    const file = handoff.take("fuel_contracts");
    if (file) void readFiles([file]);
  // Consume the in-memory file once when this page opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function conflict(row: Candidate) {
    if (!row.saveMileage) return "";
    if (!row.start) return "Effective start date required";
    if (row.end && row.end < row.start) return "End date is before start date";
    if (row.termDays && (!row.end || row.start < row.termStart! || row.end > row.termEnd!))
      return `${row.termDays}-day plan must stay within ${row.termStart}–${row.termEnd}`;
    const miles = Number(row.miles), mpg = Number(row.mpg);
    if (row.truckType === "mixed" && (![row.tractors, row.straightTrucks, row.vans].every((n) => n !== "" && Number.isInteger(Number(n)) && Number(n) >= 0) || Number(row.tractors) + Number(row.straightTrucks) + Number(row.vans) === 0)) return "Enter the actual counts of tractors, straight trucks, and vans";
    if (!row.miles || !Number.isFinite(miles) || miles <= 0) return "Annual miles required";
    if (!row.mpg || !Number.isFinite(mpg) || mpg <= 0) return "MPG required";
    if (row.issue) return row.issue;
    if (rows.some((other) => other.id !== row.id && other.selected && other.contract === row.contract && other.start &&
      row.start <= (other.end || "9999-12-31") && other.start <= (row.end || "9999-12-31"))) return "Two selected PDFs overlap for this contract";
    const match = plans.find((plan) => plan.contract_number === row.contract && overlaps(row.start, row.end, plan));
    if (match && (match.effective_start !== row.start || (match.effective_end || "") !== row.end))
      return `Overlaps saved plan ${match.effective_start}–${match.effective_end || "current"}; edit its dates first`;
    return "";
  }

  async function saveAll() {
    const chosen = rows.filter((row) => row.selected);
    if (!confirmed || !chosen.length || working) return;
    const invalid = chosen.find((row) => conflict(row));
    if (invalid) { setError(`${invalid.contract || invalid.fileName}: ${conflict(invalid)}. Review that contract card, or keep its existing mileage plan.`); return; }
    setWorking(true); setError(""); setMessage("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Sign in again before saving.");
      const tripCandidates = sourceWorkbook && canStoreTrips ? chosen.filter((row) => row.tripRows?.length && !row.issue) : [];
      let newTrips = 0;
      if (tripCandidates.length) {
        const { data: existing, error: lookupError } = await supabase.from("usps_contract_trip_snapshots")
          .select("contract_number").eq("source_hash", sourceWorkbook!.hash).eq("snapshot_date", asOf)
          .in("contract_number", tripCandidates.map((row) => row.contract));
        if (lookupError) throw new Error("Secure trip storage is not ready. Run usps_contract_trip_snapshots.sql in Supabase before saving.");
        const duplicates = new Set((existing || []).map((row) => row.contract_number));
        const fresh = tripCandidates.filter((row) => !duplicates.has(row.contract));
        if (fresh.length) {
          const { error: tripError } = await supabase.from("usps_contract_trip_snapshots").insert(fresh.map((row) => ({
            contract_number: row.contract, snapshot_date: asOf, source_hash: sourceWorkbook!.hash,
            source_file: sourceWorkbook!.name, trip_count: row.tripRows!.length,
            source_miles: Number(row.tripRows!.reduce((sum, trip) => sum + trip.annual_miles, 0).toFixed(1)),
            source_hours: Number(row.tripRows!.reduce((sum, trip) => sum + trip.annual_hours, 0).toFixed(2)),
            scheduled_payment: Number(row.tripRows!.reduce((sum, trip) => sum + trip.scheduled_trip_payment, 0).toFixed(2)),
            term_days: row.termDays || null, trips: row.tripRows, uploaded_by: userData.user!.id,
          })));
          if (tripError) throw new Error(`Trip records could not be saved: ${tripError.message}`);
          newTrips = fresh.length;
        }
        setTripsSaved(tripCandidates.map((row) => row.contract));
      }
      let savedPlans = 0;
      for (const row of chosen.filter((item) => item.saveMileage)) {
        const exact = plans.find((plan) => plan.contract_number === row.contract && plan.effective_start === row.start);
        const previous = plans.filter((plan) => plan.contract_number === row.contract).at(-1);
        const counts = row.truckType === "mixed" ? [Number(row.tractors), Number(row.straightTrucks), Number(row.vans)] :
          row.truckType === "tractor" ? [1, 0, 0] : row.truckType === "straight" ? [0, 1, 0] :
          row.truckType === "van" ? [0, 0, 1] : [null, null, null];
        const { error: planError } = await supabase.from("fuel_contract_mileage_plans").upsert({
          contract_number: row.contract, effective_start: row.start, effective_end: row.end || null,
          annual_miles: Number(row.miles), assumed_mpg: Number(row.mpg),
          alert_above_percent: exact?.alert_above_percent ?? previous?.alert_above_percent ?? 15,
          tractor_count: counts[0], straight_truck_count: counts[1], van_count: counts[2],
          updated_by: userData.user.id,
        }, { onConflict: "contract_number,effective_start" });
        if (planError) throw new Error(`${newTrips} new trip records and ${savedPlans} mileage plans saved. ${row.contract} mileage plan failed: ${planError.code === "23P01" ? "its dates overlap an existing plan" : planError.message}. Review this contract before retrying.`);
        savedPlans++;
        setRows((current) => current.map((item) => item.id === row.id ? { ...item, saveMileage: false } : item));
      }
      if (savedPlans) onSaved();
      const kept = chosen.filter((row) => !row.saveMileage).length;
      setMessage(`${newTrips} new trip records saved${tripCandidates.length > newTrips ? ` (${tripCandidates.length - newTrips} already stored)` : ""}; ${savedPlans} mileage plans saved${kept ? `; ${kept} existing plans kept` : ""}. Open a contract to see its trips and rates.`);
      setConfirmed(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The records could not be saved."); }
    finally { setWorking(false); }
  }

  const selected = rows.filter((row) => row.selected);
  const blockers = selected.map((row) => ({ contract: row.contract, reason: conflict(row) })).filter((item) => item.reason);
  return <details className="panel fuel-bulk-import no-print" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>Import annual miles from a USPS contract workbook or PDFs</summary>
    <div className="fuel-bulk-body">
      <p>Select a USPS trip workbook or schedule PDFs. Review each contract below, then save the selected contracts together. The source file stays in this browser; reviewed trip rows and mileage assumptions are saved to their restricted records.</p>
      <label className="fuel-bulk-date">Trips active on<input type="date" value={asOf} onChange={(event) => { setAsOf(event.target.value); setRows([]); setSourceWorkbook(null); setConfirmed(false); }} /></label>
      <label className="hub-secondary-link fuel-bulk-file">{working ? "Reading or saving…" : "Choose USPS workbook or PDFs"}<input type="file" accept=".xlsx,.xlsm,.xls,.pdf" multiple disabled={working} onChange={(event) => void readFiles(event.target.files)} /></label>
      {rows.length > 0 && <>
        <div className="fuel-bulk-common"><label>Apply start date to all<input type="date" value={commonStart} onChange={(event) => { const value = event.target.value; setCommonStart(value); setRows((current) => current.map((row) => ({ ...row, start: value }))); setConfirmed(false); }} /></label><label>Apply end date to all (optional)<input type="date" value={commonEnd} onChange={(event) => { const value = event.target.value; setCommonEnd(value); setRows((current) => current.map((row) => ({ ...row, end: value }))); setConfirmed(false); }} /></label><label>Apply custom MPG to all (optional)<input type="number" min="0.01" step="0.01" value={commonMpg} onChange={(event) => { const value = event.target.value; setCommonMpg(value); setRows((current) => current.map((row) => ({ ...row, mpg: value || String(MPG.average), truckType: value ? "custom" : "average" }))); setConfirmed(false); }} /></label></div>
        <p className="fuel-bulk-assumption">Starting estimate: 7.45 MPG, the simple average of tractor 6.4 and straight truck 8.5. USPS equipment codes below describe trip requirements, not how many trucks you own. Choose a type or enter actual counts when known.</p>
        <div className="fuel-bulk-cards">{rows.map((row) => <article className="fuel-bulk-card" key={row.id}>
          <div className="fuel-bulk-card-head"><label><input type="checkbox" aria-label={`Include ${row.contract || row.fileName}`} checked={row.selected} disabled={Boolean(row.issue) || working} onChange={(event) => change(row.id, { selected: event.target.checked })} /><strong>{row.contract || "Contract not found"}</strong></label><span>{row.trips ?? "—"} active trips{row.excludedTrips ? ` · ${row.excludedTrips} outside selected date` : ""}</span></div>
          <p className="fuel-bulk-source">{row.fileName}{row.page ? ` · PDF page ${row.page}` : ""}</p>
          {row.equipment.length > 0 && <div className="fuel-bulk-equipment"><strong>USPS vehicle codes</strong><div>{row.equipment.map(({ code, trips }) => <span key={code}>{code} · {trips} trip{trips === 1 ? "" : "s"}</span>)}</div></div>}
          <div className="fuel-bulk-stats"><span><b>{row.termDays ? "Term miles" : "Schedule miles"}</b>{(row.termMiles ?? Number(row.miles)).toLocaleString("en-US")}</span><span><b>Schedule hours</b>{row.hours?.toLocaleString("en-US") ?? "—"}</span><span><b>Scheduled payment</b>{row.payment == null ? "—" : row.payment.toLocaleString("en-US", { style: "currency", currency: "USD" })}</span></div>
          <div className="fuel-bulk-plan-choice"><label><input type="checkbox" checked={row.saveMileage} disabled={working || Boolean(row.issue)} onChange={(event) => change(row.id, { saveMileage: event.target.checked })} /> Save fuel mileage plan</label>{!row.saveMileage && <span>Mileage plan skipped; reviewed trips can still be saved.</span>}</div>
          {row.saveMileage && <><div className="fuel-bulk-fields"><label>Truck / MPG estimate<select value={row.truckType} disabled={working} onChange={(event) => chooseTruckType(row, event.target.value as Candidate["truckType"])}><option value="average">Tractor + straight average · 7.45 MPG</option><option value="tractor">Tractor · 6.4 MPG</option><option value="straight">Straight truck · 8.5 MPG</option><option value="van">Van · 12 MPG</option><option value="mixed">Mixed fleet · enter truck counts</option><option value="custom">Custom MPG</option></select></label><label>MPG<input type="number" min="0.01" step="0.01" value={row.mpg} readOnly={row.truckType !== "custom"} disabled={working} onChange={(event) => change(row.id, { mpg: event.target.value })} /></label></div>
            {row.truckType === "mixed" && <div className="fuel-bulk-fields"><label>Tractors<input type="number" min="0" step="1" value={row.tractors} onChange={(event) => changeTruckCount(row, "tractors", event.target.value)} /></label><label>Straight trucks<input type="number" min="0" step="1" value={row.straightTrucks} onChange={(event) => changeTruckCount(row, "straightTrucks", event.target.value)} /></label><label>Vans<input type="number" min="0" step="1" value={row.vans} onChange={(event) => changeTruckCount(row, "vans", event.target.value)} /></label></div>}
            <details className="fuel-bulk-dates"><summary>Review fuel plan miles and dates</summary><div className="fuel-bulk-fields"><label>Annualized miles<input type="number" min="0.01" step="0.1" value={row.miles} disabled={working || Boolean(row.issue)} onChange={(event) => change(row.id, { miles: event.target.value })} /></label><label>Effective from<input type="date" value={row.start} disabled={working} onChange={(event) => change(row.id, { start: event.target.value })} /></label><label>Through<input type="date" value={row.end} disabled={working} onChange={(event) => change(row.id, { end: event.target.value })} /></label></div>{row.termDays && <p>{row.termMiles?.toLocaleString()} miles over {row.termDays} days; fuel estimate is annualized only within this term.</p>}</details></>}
          {(row.issue || (row.selected && conflict(row))) && <p className="fuel-bulk-card-error">{row.issue || conflict(row)}</p>}
        </article>)}</div>
        <p>Scheduled trip payment is a projection from the USPS workbook, not money already earned. Reviewed trip rows and rates can be saved to the restricted contract record; mileage plans remain a separate fuel estimate.</p>
        <label className="fuel-bulk-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I reviewed the selected contracts, source trip totals, dated mileage plans, and MPG assumptions.</label>
        <div className="fuel-bulk-actions">
          <button type="button" className="primary-link" disabled={working || !confirmed || !selected.length} onClick={() => void saveAll()}>{working ? "Saving…" : `Save ${selected.length} reviewed contract${selected.length === 1 ? "" : "s"}`}</button>
        </div>
        {blockers.length > 0 && <p className="fuel-bulk-review" role="status">Mileage plans need review: {blockers.slice(0, 4).map((item) => `${item.contract}: ${item.reason}`).join("; ")}{blockers.length > 4 ? `; and ${blockers.length - 4} more. See the contract cards for details.` : "."} Trip records you already saved remain available on Contracts.</p>}
        {tripsSaved.length > 0 && <div className="fuel-bulk-links">Saved contracts: {tripsSaved.map((contract) => <Link key={contract} href={`/contracts/${encodeURIComponent(contract)}`}>{contract}</Link>)}</div>}
      </>}
      {error && <p className="alert alert-error">{error}</p>}{message && <p className="alert fuel-success">{message}</p>}
    </div>
  </details>;
}
