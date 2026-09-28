"use client";

import { useState } from "react";
import { parseUspsSchedule } from "@/lib/parseUspsSchedule";
import { parseUspsContractWorkbook } from "@/lib/parseUspsContractWorkbook";
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

export default function FuelBulkMileageImport({ onSaved }: { onSaved: () => void }) {
  const [rows, setRows] = useState<Candidate[]>([]);
  const [plans, setPlans] = useState<ExistingPlan[]>([]);
  const [commonStart, setCommonStart] = useState("");
  const [commonEnd, setCommonEnd] = useState("");
  const [commonMpg, setCommonMpg] = useState("");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function change(id: string, update: Partial<Candidate>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...update } : row));
    setConfirmed(false);
  }

  async function readFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(""); setMessage(""); setConfirmed(false); setRows([]); setPlans([]);
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
        for (const [index, summary] of summaries.entries()) {
          candidates.push({ id: `workbook-${index}-${summary.sheet}`, fileName: `${workbook.name} · ${summary.sheet}`,
            contract: summary.contract, miles: summary.annualMiles == null ? "" : String(summary.annualMiles),
            page: null, start: commonStart || asOf, end: commonEnd || summary.earliestExpiration,
            mpg: commonMpg, selected: !summary.issue, issue: summary.issue,
            trips: summary.activeTrips, excludedTrips: summary.excludedTrips,
            hours: summary.annualHours, payment: summary.scheduledPayment });
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
            start: commonStart, end: commonEnd, mpg: commonMpg, selected: !issue, issue });
        } catch {
          candidates.push({ id: `${index}-${file.name}`, fileName: file.name, contract: contractFromName(file.name),
            miles: "", page: null, start: commonStart, end: commonEnd, mpg: commonMpg,
            selected: false, issue: "PDF could not be read; use the individual mileage plan editor" });
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
          if (latest && !row.mpg) row.mpg = String(latest.assumed_mpg);
        });
      }
      setRows(candidates);
      setMessage(`${candidates.length} contract source${candidates.length === 1 ? "" : "s"} read locally. Check the figures, dates, and MPG before importing.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The saved mileage plans could not be checked.");
    } finally { setWorking(false); }
  }

  function conflict(row: Candidate) {
    if (!row.start) return "Effective start date required";
    if (row.end && row.end < row.start) return "End date is before start date";
    const miles = Number(row.miles), mpg = Number(row.mpg);
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

  async function save() {
    const chosen = rows.filter((row) => row.selected);
    if (!confirmed || !chosen.length) return;
    const invalid = chosen.find((row) => conflict(row));
    if (invalid) { setError(`${invalid.contract || invalid.fileName}: ${conflict(invalid)}`); return; }
    setWorking(true); setError(""); setMessage("");
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) { setError("Sign in again before saving mileage plans."); setWorking(false); return; }
    let saved = 0;
    for (const row of chosen) {
      const exact = plans.find((plan) => plan.contract_number === row.contract && plan.effective_start === row.start);
      const previous = plans.filter((plan) => plan.contract_number === row.contract).at(-1);
      const { error: saveError } = await supabase.from("fuel_contract_mileage_plans").upsert({
        contract_number: row.contract, effective_start: row.start, effective_end: row.end || null,
        annual_miles: Number(row.miles), assumed_mpg: Number(row.mpg),
        alert_above_percent: exact?.alert_above_percent ?? previous?.alert_above_percent ?? 15,
        tractor_count: exact?.tractor_count ?? previous?.tractor_count ?? null,
        straight_truck_count: exact?.straight_truck_count ?? previous?.straight_truck_count ?? null,
        van_count: exact?.van_count ?? previous?.van_count ?? null,
        updated_by: userData.user.id,
      }, { onConflict: "contract_number,effective_start" });
      if (saveError) {
        setError(`${saved} saved; ${row.contract} could not be saved: ${saveError.code === "23P01" ? "dates overlap a saved plan" : saveError.message}. Review the remaining rows before trying again.`);
        break;
      }
      saved += 1;
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, selected: false } : item));
    }
    if (saved) { setMessage(`${saved} mileage plan${saved === 1 ? "" : "s"} saved. Fuel estimates now use these dated annual miles.`); onSaved(); }
    setConfirmed(false); setWorking(false);
  }

  const selected = rows.filter((row) => row.selected);
  const blockers = selected.map(conflict).filter(Boolean);
  return <details className="panel fuel-bulk-import no-print">
    <summary>Import annual miles from a USPS contract workbook or PDFs</summary>
    <div className="fuel-bulk-body">
      <p>Select the USPS trip workbook for all contracts at once, or several schedule PDFs. The workbook totals active trip rows as of the date below. Files stay in this browser; only confirmed mileage plans are saved.</p>
      <label className="fuel-bulk-date">Trips active on<input type="date" value={asOf} onChange={(event) => { setAsOf(event.target.value); setRows([]); setConfirmed(false); }} /></label>
      <label className="hub-secondary-link fuel-bulk-file">{working ? "Reading or saving…" : "Choose USPS workbook or PDFs"}<input type="file" accept=".xlsx,.xlsm,.xls,.pdf" multiple disabled={working} onChange={(event) => void readFiles(event.target.files)} /></label>
      {rows.length > 0 && <>
        <div className="fuel-bulk-common"><label>Apply start date to all<input type="date" value={commonStart} onChange={(event) => { const value = event.target.value; setCommonStart(value); setRows((current) => current.map((row) => ({ ...row, start: value }))); setConfirmed(false); }} /></label><label>Apply end date to all (optional)<input type="date" value={commonEnd} onChange={(event) => { const value = event.target.value; setCommonEnd(value); setRows((current) => current.map((row) => ({ ...row, end: value }))); setConfirmed(false); }} /></label><label>Apply MPG to all (optional)<input type="number" min="0.01" step="0.1" value={commonMpg} onChange={(event) => { const value = event.target.value; setCommonMpg(value); setRows((current) => current.map((row) => ({ ...row, mpg: value }))); setConfirmed(false); }} /></label></div>
        <div className="table-scroll"><table className="data-table fuel-bulk-table"><thead><tr><th>Use</th><th>Source</th><th>Contract</th><th>Active trips</th><th>Annual miles</th><th>Scheduled trip payment</th><th>Annual hours</th><th>Effective from</th><th>Through</th><th>MPG</th><th>Review</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><input type="checkbox" aria-label={`Import ${row.fileName}`} checked={row.selected} disabled={Boolean(row.issue) || working} onChange={(event) => change(row.id, { selected: event.target.checked })} /></td><td>{row.fileName}{row.page && <small>PDF page {row.page}</small>}{Boolean(row.excludedTrips) && <small>{row.excludedTrips} trips outside selected date</small>}</td><td>{row.contract || "—"}</td><td>{row.trips ?? "—"}</td><td><input aria-label={`Annual miles for ${row.fileName}`} type="number" min="0.01" step="0.1" value={row.miles} disabled={working || Boolean(row.issue)} onChange={(event) => change(row.id, { miles: event.target.value })} /></td><td>{row.payment == null ? "—" : row.payment.toLocaleString("en-US", { style: "currency", currency: "USD" })}</td><td>{row.hours == null ? "—" : row.hours.toLocaleString("en-US")}</td><td><input aria-label={`Start for ${row.fileName}`} type="date" value={row.start} disabled={working} onChange={(event) => change(row.id, { start: event.target.value })} /></td><td><input aria-label={`End for ${row.fileName}`} type="date" value={row.end} disabled={working} onChange={(event) => change(row.id, { end: event.target.value })} /></td><td><input aria-label={`MPG for ${row.fileName}`} type="number" min="0.01" step="0.1" value={row.mpg} disabled={working} onChange={(event) => change(row.id, { mpg: event.target.value })} /></td><td>{row.issue || (row.selected ? conflict(row) || "Ready for confirmation" : "Skipped")}</td></tr>)}</tbody></table></div>
        <p>Scheduled trip payment is a projection from the USPS workbook, not money already earned. The fuel mileage plan saves miles, dates, and MPG; rate and trip history still need a separate secure contract model.</p>
        <label className="fuel-bulk-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I checked each selected contract, its stated annual miles, effective dates, and MPG against the source.</label>
        <button type="button" className="primary-link" disabled={working || !confirmed || !selected.length || blockers.length > 0} onClick={() => void save()}>{working ? "Saving…" : `Save ${selected.length} mileage plan${selected.length === 1 ? "" : "s"}`}</button>
      </>}
      {error && <p className="alert alert-error">{error}</p>}{message && <p className="alert fuel-success">{message}</p>}
    </div>
  </details>;
}
