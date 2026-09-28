"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { parseContractPayRates, type ContractPayRate } from "@/lib/parseContractPayRates";
import { supabase } from "@/lib/supabase";

const money = (value: number | null) => value === null ? "—" : value.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function ContractPayRatesImport() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [allowed, setAllowed] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ContractPayRate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [existing, setExisting] = useState<ContractPayRate[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => {
    void supabase.rpc("is_contract_financial_user").then(({ data }) => setAllowed(data === true));
  }, []);
  async function refresh() {
    const result = await supabase.from("contract_pay_rates").select("contract_number,st_hourly,tt_hourly,fringe_hourly,car_hourly,daily_rate,needs_review").order("contract_number");
    if (!result.error) setExisting(result.data as ContractPayRate[]);
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
    // Preserve previously reviewed effective dates. New rates remain undated until verified.
    const dates = await supabase.from("contract_pay_rates").select("contract_number,effective_start").in("contract_number", rows.map((row) => row.contract_number));
    if (dates.error && dates.error.code !== "42P01") { setError(dates.error.message); setWorking(false); return; }
    const existingDates = new Map((dates.data ?? []).map((row) => [row.contract_number, row.effective_start]));
    const payload = rows.map((row) => ({ ...row, effective_start: existingDates.get(row.contract_number) ?? null,
      source_file: fileName, reviewed_by: auth.user!.id, reviewed_at: new Date().toISOString() }));
    const result = await supabase.from("contract_pay_rates").upsert(payload, { onConflict: "contract_number" });
    if (result.error) setError(result.error.message.includes("contract_pay_rates") ? "Run contract_pay_rates.sql in Supabase, then save again." : result.error.message);
    else { setMessage(`${rows.length} contract rate references saved. Daily rates for 364A8, 36463, and 378A5 are included. Other daily and location-specific amounts remain blank.`); setRows([]); void refresh(); }
    setWorking(false);
  }
  if (!allowed) return <p className="panel">Restricted financial access required.</p>;
  return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Private financial reference</p><h2>Contract pay rates</h2><span>Review ST, TT, car, and hourly fringe amounts from the workbook. The source file is read in your browser.</span></div></div>
    <p>Fringe applies to every worked hour. The first daily-rate column applies to all drivers on 364A8, 36463, and 378A5. Other daily rates are ignored, and location-specific amounts remain unresolved. Contracts with one hourly truck type can show a planning estimate from saved payroll hours; mixed contracts use reviewed truck counts.</p>
    <div className="rate-import-actions"><button type="button" className="upload-button" onClick={() => fileInput.current?.click()}>Choose rate workbook</button><input ref={fileInput} type="file" accept=".xlsx,.xls" className="rate-file-input" aria-label="Choose rate workbook file" onChange={(event) => void choose(event.target.files?.[0])}/><span>{fileName || "No workbook chosen"}</span></div>
    {error && <p className="alert alert-error" role="alert">{error}</p>}{message && <p className="alert" role="status">{message}</p>}
    {rows.length > 0 && <><p><strong>{rows.length} contracts found</strong> · {warnings.length} need location review. Saving an existing contract updates its rate reference.</p>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>ST/hour</th><th>TT/hour</th><th>Fringe/hour</th><th>Car/hour</th><th>Daily</th><th>Review</th></tr></thead><tbody>{rows.map((row) => <tr key={row.contract_number}><td>{row.contract_number}</td><td>{money(row.st_hourly)}</td><td>{money(row.tt_hourly)}</td><td>{money(row.fringe_hourly)}</td><td>{money(row.car_hourly)}</td><td>{money(row.daily_rate)}</td><td>{row.needs_review ? "Location rate" : "—"}</td></tr>)}</tbody></table></div>
      <button type="button" className="primary-link rate-save-button" disabled={working} onClick={() => void save()}>{working ? "Saving…" : `Save ${rows.length} reviewed contract rates`}</button></>}
    {existing.length > 0 && <details><summary>{existing.length} saved contract rate references</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>Contract</th><th>ST/hour</th><th>TT/hour</th><th>Fringe/hour</th><th>Car/hour</th><th>Daily</th><th>Review</th></tr></thead><tbody>{existing.map((row) => <tr key={row.contract_number}><td><Link href={`/contracts/${encodeURIComponent(row.contract_number)}`}>{row.contract_number}</Link></td><td>{money(row.st_hourly)}</td><td>{money(row.tt_hourly)}</td><td>{money(row.fringe_hourly)}</td><td>{money(row.car_hourly)}</td><td>{money(row.daily_rate)}</td><td>{row.needs_review ? "Location rate" : "—"}</td></tr>)}</tbody></table></div></details>}
  </section>;
}
