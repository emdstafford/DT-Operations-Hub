"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { processFuelReport, type ProcessedFuelReport } from "@/lib/processFuelReport";
import { supabase } from "@/lib/supabase";

type SummaryRow = { name: string; city?: string; state?: string; transactions: number; fuel_gallons: number; total_spend: number; gasoline_spend?: number };
type TrendRow = { period_start: string; transactions: number; fuel_gallons: number; total_spend: number };
type GasolineRow = { transaction_date: string; person_name: string; contract_number: string; merchant_name: string; merchant_city: string; merchant_state: string; vehicle_number: string; product_description: string; unit_gallons: number; price_per_unit: number; net_cost: number };
type FuelData = {
  totals: { line_items: number; transactions: number; total_spend: number; fuel_gallons: number; fuel_cost: number; gasoline_spend: number; gasoline_lines: number; gasoline_gallons: number; average_price_per_gallon: number };
  trend: TrendRow[];
  by_contract: SummaryRow[];
  by_person: SummaryRow[];
  by_station: SummaryRow[];
  by_product: Array<{ name: string; line_items: number; units: number; total_spend: number }>;
  gasoline_alerts: GasolineRow[];
};
type Options = { period_start: string | null; period_end: string | null; contracts: string[]; people: string[]; stations: string[] };
type View = "contracts" | "people" | "stations" | "products" | "gasoline" | "trend";

const emptyData: FuelData = { totals: { line_items: 0, transactions: 0, total_spend: 0, fuel_gallons: 0, fuel_cost: 0, gasoline_spend: 0, gasoline_lines: 0, gasoline_gallons: 0, average_price_per_gallon: 0 }, trend: [], by_contract: [], by_person: [], by_station: [], by_product: [], gasoline_alerts: [] };
const currency = (value: number) => Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const number = (value: number, decimals = 0) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const displayDate = (value: string) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "—";
const productLabel = (value: string) => ({ diesel: "Diesel", gasoline: "Gasoline", def: "DEF", fee: "Transaction fees", adjustment: "Adjustments", other: "Other" }[value] || value);

export default function FuelReports() {
  const today = new Date().toISOString().slice(0, 10);
  const [canUpload, setCanUpload] = useState(false);
  const [options, setOptions] = useState<Options>({ period_start: null, period_end: null, contracts: [], people: [], stations: [] });
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [grain, setGrain] = useState("week");
  const [contract, setContract] = useState("");
  const [person, setPerson] = useState("");
  const [station, setStation] = useState("");
  const [category, setCategory] = useState("");
  const [view, setView] = useState<View>("contracts");
  const [data, setData] = useState<FuelData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ProcessedFuelReport | null>(null);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState("");

  const loadOptions = useCallback(async (resetDates = false) => {
    const { data: result, error: optionsError } = await supabase.rpc("fuel_filter_options");
    if (optionsError) {
      setError(optionsError.message.includes("fuel_filter_options") ? "Run the Fuel Reports SQL in Supabase to enable this page." : optionsError.message);
      return;
    }
    const next = (result ?? { period_start: null, period_end: null, contracts: [], people: [], stations: [] }) as Options;
    setOptions(next);
    if ((resetDates || start === today) && next.period_start && next.period_end) {
      setStart(next.period_start);
      setEnd(next.period_end);
    }
  }, [start, today]);

  useEffect(() => { void (async () => {
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email?.toLowerCase() ?? "";
    const { data: access } = await supabase.from("fuel_tool_users").select("can_upload").eq("email", email).eq("active", true).maybeSingle();
    setCanUpload(Boolean(access?.can_upload));
    await loadOptions(true);
  })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true); setError("");
      const { data: result, error: dashboardError } = await supabase.rpc("fuel_dashboard", {
        p_start: start, p_end: end, p_grain: grain,
        p_contract: contract || null, p_person: person || null, p_station: station || null, p_category: category || null,
      });
      if (!active) return;
      if (dashboardError) setError(dashboardError.message.includes("fuel_dashboard") ? "Run the Fuel Reports SQL in Supabase to enable fuel analytics." : dashboardError.message);
      else setData((result ?? emptyData) as FuelData);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [start, end, grain, contract, person, station, category]);

  async function selectFile(file?: File) {
    if (!file) return;
    setParsing(true); setError(""); setUploadMessage(""); setPreview(null);
    try { setPreview(await processFuelReport(file)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The Comdata file could not be read."); }
    finally { setParsing(false); }
  }

  async function importReport() {
    if (!preview || uploading) return;
    setUploading(true); setProgress(0); setError(""); setUploadMessage("");
    let importId = "";
    try {
      const { data: existing } = await supabase.from("fuel_imports").select("id,created_at").eq("file_hash", preview.fileHash).maybeSingle();
      if (existing) throw new Error("This exact Comdata file has already been imported.");
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Your session expired. Sign in again before importing.");
      const { data: created, error: importError } = await supabase.from("fuel_imports").insert({
        file_name: preview.fileName, file_hash: preview.fileHash, period_start: preview.periodStart, period_end: preview.periodEnd,
        source_row_count: preview.sourceRows, inserted_row_count: 0, transaction_count: preview.transactionCount,
        total_fuel_gallons: preview.totalFuelGallons, total_net_cost: preview.totalNetCost, uploaded_by: userData.user.id,
      }).select("id").single();
      if (importError || !created) throw new Error(importError?.message || "The fuel import could not be started.");
      importId = created.id;
      let inserted = 0;
      const batchSize = 500;
      for (let index = 0; index < preview.rows.length; index += batchSize) {
        const batch = preview.rows.slice(index, index + batchSize).map((row) => ({ ...row, import_id: importId }));
        const { data: saved, error: rowError } = await supabase.from("fuel_transactions").upsert(batch, { onConflict: "unique_key", ignoreDuplicates: true }).select("id");
        if (rowError) throw new Error(`Import stopped near row ${index + 1}: ${rowError.message}`);
        inserted += saved?.length ?? 0;
        setProgress(Math.min(100, Math.round(((index + batch.length) / preview.rows.length) * 100)));
      }
      const { error: updateError } = await supabase.from("fuel_imports").update({ inserted_row_count: inserted }).eq("id", importId);
      if (updateError) throw new Error(updateError.message);
      const skipped = preview.rows.length - inserted;
      setUploadMessage(`${number(inserted)} fuel line items saved${skipped ? ` · ${number(skipped)} overlapping lines skipped` : ""}.`);
      setStart(preview.periodStart); setEnd(preview.periodEnd); setPreview(null);
      await loadOptions(false);
    } catch (cause) {
      if (importId) await supabase.from("fuel_imports").delete().eq("id", importId);
      setError(cause instanceof Error ? cause.message : "The fuel report could not be imported.");
    } finally { setUploading(false); }
  }

  const activeRows = useMemo(() => view === "contracts" ? data.by_contract : view === "people" ? data.by_person : view === "stations" ? data.by_station : [], [data, view]);

  function clearFilters() { setContract(""); setPerson(""); setStation(""); setCategory(""); }

  return <div className="report-stack fuel-report-stack">
    {canUpload && <section className="panel fuel-upload-panel">
      <div><p className="eyebrow">Import Comdata</p><h2>Upload Transaction Listing</h2><p>The file stays inside the secured DT system. Driver-license fields, VINs, and license plates are not stored.</p></div>
      <label className="primary-link fuel-file-button">{parsing ? "Reading file…" : "Choose Comdata file"}<input type="file" accept=".xlsx,.xls" disabled={parsing || uploading} onChange={(event) => void selectFile(event.target.files?.[0])} /></label>
    </section>}
    {preview && <section className="panel fuel-import-preview">
      <div className="panel-heading"><div><p className="eyebrow">Ready to import</p><h2>{preview.fileName}</h2></div><span>{displayDate(preview.periodStart)} – {displayDate(preview.periodEnd)}</span></div>
      <div className="fuel-preview-grid"><div><span>Source rows</span><strong>{number(preview.sourceRows)}</strong></div><div><span>Transactions</span><strong>{number(preview.transactionCount)}</strong></div><div><span>Fuel gallons</span><strong>{number(preview.totalFuelGallons, 1)}</strong></div><div><span>Net cost</span><strong>{currency(preview.totalNetCost)}</strong></div><div className="fuel-gas-preview"><span>Gasoline lines</span><strong>{number(preview.gasolineRows)}</strong></div></div>
      {preview.duplicateRowsRemoved > 0 && <p className="fuel-preview-note">{number(preview.duplicateRowsRemoved)} exact duplicate row{preview.duplicateRowsRemoved === 1 ? " was" : "s were"} removed during validation.</p>}
      <div className="fuel-preview-actions"><button className="clear-filters" disabled={uploading} onClick={() => setPreview(null)}>Cancel</button><button className="primary-link" disabled={uploading} onClick={() => void importReport()}>{uploading ? `Saving… ${progress}%` : "Import fuel report"}</button></div>
      {uploading && <progress className="fuel-import-progress" max="100" value={progress} />}
    </section>}
    {(error || uploadMessage) && <section className={`alert ${error ? "alert-error" : "fuel-success"}`}>{error || uploadMessage}</section>}

    <section className="panel fuel-filters">
      <div className="fuel-date-fields"><label>From<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label><label>To<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label><label>Group trend<select value={grain} onChange={(event) => setGrain(event.target.value)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label></div>
      <div className="fuel-filter-fields"><label>Contract<select value={contract} onChange={(event) => setContract(event.target.value)}><option value="">All contracts</option>{options.contracts.map((item) => <option key={item}>{item}</option>)}</select></label><label>Employee<select value={person} onChange={(event) => setPerson(event.target.value)}><option value="">All employees</option>{options.people.map((item) => <option key={item}>{item}</option>)}</select></label><label>Station<select value={station} onChange={(event) => setStation(event.target.value)}><option value="">All stations</option>{options.stations.map((item) => <option key={item}>{item}</option>)}</select></label><label>Fuel type<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All products</option><option value="diesel">Diesel</option><option value="gasoline">Gasoline</option><option value="def">DEF</option><option value="fee">Transaction fees</option><option value="adjustment">Adjustments</option><option value="other">Other</option></select></label>{(contract || person || station || category) && <button className="clear-filters" onClick={clearFilters}>Clear filters</button>}</div>
    </section>

    {loading ? <section className="hub-loading">Loading fuel activity…</section> : <>
      <section className="fuel-metric-grid"><article className="metric-card metric-primary"><span>Total spend</span><strong>{currency(data.totals.total_spend)}</strong></article><article className="metric-card"><span>Fuel gallons</span><strong>{number(data.totals.fuel_gallons, 1)}</strong></article><article className="metric-card"><span>Fuel transactions</span><strong>{number(data.totals.transactions)}</strong></article><article className="metric-card"><span>Average price per gallon</span><strong>{currency(data.totals.average_price_per_gallon)}</strong></article><button className="metric-card metric-card-action fuel-alert-card" onClick={() => setView("gasoline")}><span>Gasoline spend</span><strong>{currency(data.totals.gasoline_spend)}</strong><small>{number(data.totals.gasoline_lines)} lines · Review →</small></button></section>
      <nav className="fuel-view-tabs" aria-label="Fuel report view"><button className={view === "contracts" ? "active" : ""} onClick={() => setView("contracts")}>Contracts</button><button className={view === "people" ? "active" : ""} onClick={() => setView("people")}>Employees</button><button className={view === "stations" ? "active" : ""} onClick={() => setView("stations")}>Stations</button><button className={view === "products" ? "active" : ""} onClick={() => setView("products")}>Fuel types</button><button className={view === "trend" ? "active" : ""} onClick={() => setView("trend")}>Trend</button><button className={view === "gasoline" ? "active fuel-warning-tab" : "fuel-warning-tab"} onClick={() => setView("gasoline")}>Gasoline review</button></nav>

      {(view === "contracts" || view === "people" || view === "stations") && <section className="panel overflow-hidden"><div className="panel-heading"><h2>{view === "contracts" ? "Fuel by contract" : view === "people" ? "Fuel by employee" : "Fuel by station"}</h2><span>{displayDate(start)} – {displayDate(end)}</span></div><div className="table-scroll fuel-table-scroll"><table className="data-table"><thead><tr><th>{view === "contracts" ? "Contract" : view === "people" ? "Employee" : "Station"}</th>{view === "stations" && <th>Location</th>}<th>Transactions</th><th>Fuel gallons</th><th>Gasoline spend</th><th>Total spend</th></tr></thead><tbody>{activeRows.map((row) => <tr key={`${row.name}-${row.city || ""}-${row.state || ""}`}><td className="font-semibold text-navy">{row.name}</td>{view === "stations" && <td>{[row.city,row.state].filter(Boolean).join(", ")}</td>}<td>{number(row.transactions)}</td><td>{number(row.fuel_gallons,1)}</td><td>{currency(row.gasoline_spend || 0)}</td><td><strong>{currency(row.total_spend)}</strong></td></tr>)}</tbody></table></div></section>}

      {view === "products" && <section className="panel overflow-hidden"><div className="panel-heading"><h2>Spend by fuel type</h2><span>Fees and adjustments remain separate from fuel gallons</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Category</th><th>Line items</th><th>Units/gallons</th><th>Total spend</th></tr></thead><tbody>{data.by_product.map((row) => <tr key={row.name}><td className="font-semibold text-navy">{productLabel(row.name)}</td><td>{number(row.line_items)}</td><td>{number(row.units,1)}</td><td><strong>{currency(row.total_spend)}</strong></td></tr>)}</tbody></table></div></section>}

      {view === "trend" && <section className="panel overflow-hidden"><div className="panel-heading"><h2>{grain === "month" ? "Monthly" : grain === "day" ? "Daily" : "Weekly"} fuel trend</h2><span>{displayDate(start)} – {displayDate(end)}</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Period starting</th><th>Transactions</th><th>Fuel gallons</th><th>Total spend</th></tr></thead><tbody>{data.trend.map((row) => <tr key={row.period_start}><td className="font-semibold text-navy">{displayDate(row.period_start)}</td><td>{number(row.transactions)}</td><td>{number(row.fuel_gallons,1)}</td><td><strong>{currency(row.total_spend)}</strong></td></tr>)}</tbody></table></div></section>}

      {view === "gasoline" && <section className="panel overflow-hidden"><div className="panel-heading"><div><h2>Gasoline purchases for review</h2><span>Gasoline is flagged for review. A listed purchase is not automatically misuse.</span></div><strong className="fuel-gas-total">{currency(data.totals.gasoline_spend)}</strong></div>{data.gasoline_alerts.length ? <div className="table-scroll fuel-table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Employee</th><th>Contract</th><th>Vehicle</th><th>Station</th><th>Product</th><th>Gallons</th><th>PPG</th><th>Cost</th></tr></thead><tbody>{data.gasoline_alerts.map((row,index) => <tr key={`${row.transaction_date}-${row.person_name}-${row.net_cost}-${index}`}><td>{displayDate(row.transaction_date)}</td><td className="font-semibold text-navy">{row.person_name}</td><td>{row.contract_number}</td><td>{row.vehicle_number || "—"}</td><td>{row.merchant_name}<small className="fuel-location">{[row.merchant_city,row.merchant_state].filter(Boolean).join(", ")}</small></td><td>{row.product_description}</td><td>{number(row.unit_gallons,2)}</td><td>{currency(row.price_per_unit)}</td><td><strong>{currency(row.net_cost)}</strong></td></tr>)}</tbody></table></div> : <div className="location-empty">No gasoline purchases match the selected filters.</div>}</section>}
    </>}
  </div>;
}
