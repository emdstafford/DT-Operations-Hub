"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { parseContractPayRates, type ContractPayRate } from "@/lib/parseContractPayRates";
import { supabase } from "@/lib/supabase";

type SavedContractPayRate = ContractPayRate & { effective_start: string | null };
type RateDraft = {
  st_hourly: string;
  tt_hourly: string;
  fringe_hourly: string;
  car_hourly: string;
  daily_rate: string;
  effective_start: string;
  needs_review: boolean;
};

const money = (value: number | null) => value === null ? "—" : value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const editValue = (value: number | null) => value === null ? "" : String(value);
const draftFor = (row: SavedContractPayRate): RateDraft => ({
  st_hourly: editValue(row.st_hourly),
  tt_hourly: editValue(row.tt_hourly),
  fringe_hourly: editValue(row.fringe_hourly),
  car_hourly: editValue(row.car_hourly),
  daily_rate: editValue(row.daily_rate),
  effective_start: row.effective_start ?? "",
  needs_review: row.needs_review,
});
function rate(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10000) throw new Error("Rates must be a positive dollar amount.");
  return Math.round(parsed * 100) / 100;
}

export default function ContractPayRatesImport() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [allowed, setAllowed] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ContractPayRate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [existing, setExisting] = useState<SavedContractPayRate[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<RateDraft | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void supabase.rpc("is_contract_financial_user").then(({ data }) => setAllowed(data === true));
  }, []);

  async function refresh() {
    const result = await supabase
      .from("contract_pay_rates")
      .select("contract_number,st_hourly,tt_hourly,fringe_hourly,car_hourly,daily_rate,needs_review,effective_start")
      .order("contract_number");
    if (!result.error) setExisting(result.data as SavedContractPayRate[]);
  }
  useEffect(() => { if (allowed) void refresh(); }, [allowed]);

  async function choose(file: File | undefined) {
    setRows([]); setWarnings([]); setError(""); setMessage("");
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = book.Sheets[book.SheetNames[0]];
      const parsed = parseContractPayRates(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as unknown[][]);
      setRows(parsed.rates); setWarnings(parsed.warnings); setFileName(file.name);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read the rate workbook."); }
  }

  async function save() {
    if (!rows.length) return;
    setWorking(true); setError(""); setMessage("");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setError("Sign in again to save rates."); setWorking(false); return; }
    const dates = await supabase.from("contract_pay_rates").select("contract_number,effective_start").in("contract_number", rows.map((row) => row.contract_number));
    if (dates.error && dates.error.code !== "42P01") { setError(dates.error.message); setWorking(false); return; }
    const existingDates = new Map((dates.data ?? []).map((row) => [row.contract_number, row.effective_start]));
    const payload = rows.map((row) => ({ ...row, effective_start: existingDates.get(row.contract_number) ?? null,
      source_file: fileName, reviewed_by: auth.user!.id, reviewed_at: new Date().toISOString() }));
    const result = await supabase.from("contract_pay_rates").upsert(payload, { onConflict: "contract_number" });
    if (result.error) setError(result.error.message.includes("contract_pay_rates") ? "Run contract_pay_rates.sql in Supabase, then save again." : result.error.message);
    else {
      setMessage(`${rows.length} contract rate references saved. You can now edit individual rates below without re-uploading the workbook.`);
      setRows([]);
      void refresh();
    }
    setWorking(false);
  }

  function startEdit(row: SavedContractPayRate) {
    setEditing(row.contract_number);
    setDraft(draftFor(row));
    setError("");
    setMessage("");
  }

  async function saveEdit(contractNumber: string) {
    if (!draft) return;
    setWorking(true); setError(""); setMessage("");
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sign in again to update rates.");
      const payload = {
        st_hourly: rate(draft.st_hourly),
        tt_hourly: rate(draft.tt_hourly),
        fringe_hourly: rate(draft.fringe_hourly),
        car_hourly: rate(draft.car_hourly),
        daily_rate: rate(draft.daily_rate),
        effective_start: draft.effective_start || null,
        needs_review: draft.needs_review,
        source_file: "Manual update",
        reviewed_by: auth.user.id,
        reviewed_at: new Date().toISOString(),
      };
      const result = await supabase.from("contract_pay_rates").update(payload).eq("contract_number", contractNumber);
      if (result.error) throw result.error;
      setEditing(null); setDraft(null);
      setMessage(`${contractNumber} pay rates updated.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this contract rate.");
    } finally {
      setWorking(false);
    }
  }

  if (!allowed) return <p className="panel">Restricted financial access required.</p>;

  return <section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">Private financial reference</p><h2>Contract pay rates</h2><span>Update straight truck, tractor trailer, fringe, car, and daily pay rates here.</span></div></div>
    <p>Fringe applies to every worked hour. Use the saved-rate editor for normal pay changes; the workbook upload remains available for bulk updates.</p>

    <details className="rate-upload-disclosure">
      <summary>Bulk update from rate workbook</summary>
      <div className="rate-import-actions"><button type="button" className="upload-button" onClick={() => fileInput.current?.click()}>Choose rate workbook</button><input ref={fileInput} type="file" accept=".xlsx,.xls" className="rate-file-input" aria-label="Choose rate workbook file" onChange={(event) => void choose(event.target.files?.[0])}/><span>{fileName || "No workbook chosen"}</span></div>
      {rows.length > 0 && <><p><strong>{rows.length} contracts found</strong> · {warnings.length} need location review. Saving an existing contract updates its rate reference.</p>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>ST/hour</th><th>TT/hour</th><th>Fringe/hour</th><th>Car/hour</th><th>Daily</th><th>Review</th></tr></thead><tbody>{rows.map((row) => <tr key={row.contract_number}><td>{row.contract_number}</td><td>{money(row.st_hourly)}</td><td>{money(row.tt_hourly)}</td><td>{money(row.fringe_hourly)}</td><td>{money(row.car_hourly)}</td><td>{money(row.daily_rate)}</td><td>{row.needs_review ? "Location rate" : "—"}</td></tr>)}</tbody></table></div>
        <button type="button" className="primary-link rate-save-button" disabled={working} onClick={() => void save()}>{working ? "Saving…" : `Save ${rows.length} reviewed contract rates`}</button></>}
    </details>

    {error && <p className="alert alert-error" role="alert">{error}</p>}
    {message && <p className="fuel-success" role="status">{message}</p>}

    {existing.length > 0 && <div className="rate-editor">
      <div className="panel-heading rate-editor-heading"><div><h3>Saved contract pay rates</h3><span>Click Edit beside a contract whenever ST, TT, fringe, car, or daily pay changes.</span></div></div>
      <div className="table-scroll"><table className="data-table rate-editor-table"><thead><tr><th>Contract</th><th>Straight Truck/hour</th><th>Tractor Trailer/hour</th><th>Fringe/hour</th><th>Car/hour</th><th>Daily</th><th>Effective</th><th>Review</th><th></th></tr></thead><tbody>{existing.map((row) => {
        const isEditing = editing === row.contract_number && draft;
        return <tr key={row.contract_number}>
          <td><Link href={`/contracts/${encodeURIComponent(row.contract_number)}`}>{row.contract_number}</Link></td>
          {isEditing ? <>
            <td><input type="number" min="0" step="0.01" aria-label={`${row.contract_number} straight truck hourly rate`} value={draft.st_hourly} onChange={(event) => setDraft({ ...draft, st_hourly: event.target.value })}/></td>
            <td><input type="number" min="0" step="0.01" aria-label={`${row.contract_number} tractor trailer hourly rate`} value={draft.tt_hourly} onChange={(event) => setDraft({ ...draft, tt_hourly: event.target.value })}/></td>
            <td><input type="number" min="0" step="0.01" aria-label={`${row.contract_number} fringe hourly rate`} value={draft.fringe_hourly} onChange={(event) => setDraft({ ...draft, fringe_hourly: event.target.value })}/></td>
            <td><input type="number" min="0" step="0.01" aria-label={`${row.contract_number} car hourly rate`} value={draft.car_hourly} onChange={(event) => setDraft({ ...draft, car_hourly: event.target.value })}/></td>
            <td><input type="number" min="0" step="0.01" aria-label={`${row.contract_number} daily rate`} value={draft.daily_rate} onChange={(event) => setDraft({ ...draft, daily_rate: event.target.value })}/></td>
            <td><input type="date" aria-label={`${row.contract_number} effective date`} value={draft.effective_start} onChange={(event) => setDraft({ ...draft, effective_start: event.target.value })}/></td>
            <td><label className="rate-review-check"><input type="checkbox" checked={draft.needs_review} onChange={(event) => setDraft({ ...draft, needs_review: event.target.checked })}/> Needs review</label></td>
            <td><div className="rate-row-actions"><button type="button" className="primary-link" disabled={working} onClick={() => void saveEdit(row.contract_number)}>Save</button><button type="button" className="hub-secondary-link" disabled={working} onClick={() => { setEditing(null); setDraft(null); }}>Cancel</button></div></td>
          </> : <>
            <td>{money(row.st_hourly)}</td><td>{money(row.tt_hourly)}</td><td>{money(row.fringe_hourly)}</td><td>{money(row.car_hourly)}</td><td>{money(row.daily_rate)}</td>
            <td>{row.effective_start || "—"}</td><td>{row.needs_review ? "Needs review" : "Reviewed"}</td>
            <td><button type="button" className="hub-secondary-link" onClick={() => startEdit(row)}>Edit</button></td>
          </>}
        </tr>;
      })}</tbody></table></div>
    </div>}
  </section>;
}
