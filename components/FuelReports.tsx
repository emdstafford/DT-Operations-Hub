"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { processFuelReport, type ProcessedFuelReport } from "@/lib/processFuelReport";
import { supabase } from "@/lib/supabase";

type SummaryRow = { name: string; city?: string; state?: string; transactions: number; fuel_gallons: number; total_spend: number; gasoline_spend?: number };
type TrendRow = { period_start: string; transactions: number; fuel_gallons: number; total_spend: number };
type MonthlyContractRow = TrendRow & { contract_number: string; employees: number; gasoline_spend: number };
type GasolineRow = { transaction_date: string; person_name: string; contract_number: string; merchant_name: string; merchant_city: string; merchant_state: string; vehicle_number: string; product_description: string; unit_gallons: number; price_per_unit: number; net_cost: number; gasoline_authorized: boolean; monthly_spend_limit: number | null };
type SpendAlertRow = { person_name: string; period_start: string; total_spend: number; monthly_spend_limit: number; overage: number };
type EmployeeRule = { person_name: string; gasoline_authorized: boolean; monthly_spend_limit: number | null; notes: string | null };
type FuelData = {
  totals: { line_items: number; transactions: number; total_spend: number; fuel_gallons: number; fuel_cost: number; gasoline_spend: number; gasoline_lines: number; gasoline_gallons: number; average_price_per_gallon: number };
  trend: TrendRow[];
  by_contract: SummaryRow[];
  by_person: SummaryRow[];
  by_station: SummaryRow[];
  by_product: Array<{ name: string; line_items: number; units: number; total_spend: number }>;
  gasoline_alerts: GasolineRow[];
  spend_alerts: SpendAlertRow[];
  monthly_contracts: MonthlyContractRow[];
};
type Options = { period_start: string | null; period_end: string | null; contracts: string[]; people: string[]; stations: string[]; supervisors: string[] };
type View = "contracts" | "people" | "stations" | "products" | "gasoline" | "spend-alerts" | "controls" | "trend";

const emptyData: FuelData = { totals: { line_items: 0, transactions: 0, total_spend: 0, fuel_gallons: 0, fuel_cost: 0, gasoline_spend: 0, gasoline_lines: 0, gasoline_gallons: 0, average_price_per_gallon: 0 }, trend: [], by_contract: [], by_person: [], by_station: [], by_product: [], gasoline_alerts: [], spend_alerts: [], monthly_contracts: [] };
const currency = (value: number) => Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const number = (value: number, decimals = 0) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const displayDate = (value: string) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "—";
const productLabel = (value: string) => ({ diesel: "Diesel", gasoline: "Gasoline", def: "DEF", fee: "Transaction fees", adjustment: "Adjustments", other: "Other" }[value] || value);

export default function FuelReports() {
  const today = new Date().toISOString().slice(0, 10);
  const [canUpload, setCanUpload] = useState(false);
  const [options, setOptions] = useState<Options>({ period_start: null, period_end: null, contracts: [], people: [], stations: [], supervisors: [] });
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [grain, setGrain] = useState("week");
  const [reportMonth, setReportMonth] = useState("");
  const [supervisor, setSupervisor] = useState("");
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
  const [employeeRules, setEmployeeRules] = useState<EmployeeRule[]>([]);
  const [rulePerson, setRulePerson] = useState("");
  const [gasolineAuthorized, setGasolineAuthorized] = useState(false);
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [ruleNotes, setRuleNotes] = useState("");
  const [savingRule, setSavingRule] = useState(false);

  const loadOptions = useCallback(async (resetDates = false) => {
    const { data: result, error: optionsError } = await supabase.rpc("fuel_filter_options_v2");
    if (optionsError) {
      setError(optionsError.message.includes("fuel_filter_options_v2") ? "Run the Fuel Supervisor Reports SQL in Supabase to enable supervisor reporting." : optionsError.message);
      return;
    }
    const next = (result ?? { period_start: null, period_end: null, contracts: [], people: [], stations: [], supervisors: [] }) as Options;
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
      const { data: result, error: dashboardError } = await supabase.rpc("fuel_dashboard_v2", {
        p_start: start, p_end: end, p_grain: grain,
        p_supervisor: supervisor || null, p_contract: contract || null, p_person: person || null, p_station: station || null, p_category: category || null,
      });
      if (!active) return;
      if (dashboardError) setError(dashboardError.message.includes("fuel_dashboard_v2") ? "Run the Fuel Supervisor Reports SQL in Supabase to enable supervisor reporting." : dashboardError.message);
      else setData((result ?? emptyData) as FuelData);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [start, end, grain, supervisor, contract, person, station, category]);

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

  const loadEmployeeRules = useCallback(async () => {
    const { data: rules } = await supabase.from("fuel_employee_rules").select("person_name,gasoline_authorized,monthly_spend_limit,notes").order("person_name");
    setEmployeeRules((rules ?? []) as EmployeeRule[]);
  }, []);

  useEffect(() => { void loadEmployeeRules(); }, [loadEmployeeRules]);

  function clearFilters() { setSupervisor(""); setContract(""); setPerson(""); setStation(""); setCategory(""); }

  function chooseMonth(value: string) {
    setReportMonth(value);
    if (!value) return;
    const [year, month] = value.split("-").map(Number);
    setStart(`${value}-01`);
    setEnd(new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10));
    setGrain("month");
  }

  function downloadSupervisorCsv() {
    if (!supervisor) return;
    const rows = [["Supervisor", "Month", "Contract", "Employees", "Transactions", "Fuel Gallons", "Gasoline Spend", "Total Spend"], ...data.monthly_contracts.map((row) => [supervisor, row.period_start, row.contract_number, row.employees, row.transactions, Number(row.fuel_gallons || 0).toFixed(2), Number(row.gasoline_spend || 0).toFixed(2), Number(row.total_spend || 0).toFixed(2)])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${supervisor.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}-fuel-${start}-to-${end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function selectRulePerson(value: string) {
    setRulePerson(value);
    const existing = employeeRules.find((rule) => rule.person_name === value);
    setGasolineAuthorized(existing?.gasoline_authorized ?? false);
    setMonthlyLimit(existing?.monthly_spend_limit == null ? "" : String(existing.monthly_spend_limit));
    setRuleNotes(existing?.notes ?? "");
  }

  async function saveEmployeeRule() {
    if (!rulePerson || !canUpload) return;
    setSavingRule(true); setError(""); setUploadMessage("");
    const { data: userData } = await supabase.auth.getUser();
    const limit = monthlyLimit.trim() === "" ? null : Number(monthlyLimit);
    if (limit !== null && (!Number.isFinite(limit) || limit < 0)) {
      setError("Enter a valid monthly spending limit or leave it blank."); setSavingRule(false); return;
    }
    const { error: ruleError } = await supabase.from("fuel_employee_rules").upsert({
      person_name: rulePerson, gasoline_authorized: gasolineAuthorized, monthly_spend_limit: limit,
      notes: ruleNotes.trim() || null, updated_by: userData.user?.id,
    }, { onConflict: "person_name" });
    if (ruleError) setError(ruleError.message);
    else {
      setUploadMessage(`${rulePerson}'s fuel controls were saved.`);
      await loadEmployeeRules();
    }
    setSavingRule(false);
  }

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
      <div className="fuel-date-fields"><label>Quick month<input type="month" value={reportMonth} onChange={(event) => chooseMonth(event.target.value)} /></label><label>From<input type="date" value={start} onChange={(event) => { setReportMonth(""); setStart(event.target.value); }} /></label><label>To<input type="date" value={end} onChange={(event) => { setReportMonth(""); setEnd(event.target.value); }} /></label><label>Group trend<select value={grain} onChange={(event) => setGrain(event.target.value)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label></div>
      <div className="fuel-filter-fields"><label>Supervisor<select value={supervisor} onChange={(event) => { setSupervisor(event.target.value); setContract(""); setGrain("month"); }}><option value="">All supervisors</option>{options.supervisors.map((item) => <option key={item}>{item}</option>)}</select></label><label>Contract<select value={contract} onChange={(event) => setContract(event.target.value)}><option value="">All contracts</option>{options.contracts.map((item) => <option key={item}>{item}</option>)}</select></label><label>Employee<select value={person} onChange={(event) => setPerson(event.target.value)}><option value="">All employees</option>{options.people.map((item) => <option key={item}>{item}</option>)}</select></label><label>Station<select value={station} onChange={(event) => setStation(event.target.value)}><option value="">All stations</option>{options.stations.map((item) => <option key={item}>{item}</option>)}</select></label><label>Fuel type<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All products</option><option value="diesel">Diesel</option><option value="gasoline">Gasoline</option><option value="def">DEF</option><option value="fee">Transaction fees</option><option value="adjustment">Adjustments</option><option value="other">Other</option></select></label>{(supervisor || contract || person || station || category) && <button className="clear-filters" onClick={clearFilters}>Clear filters</button>}</div>
    </section>

    {loading ? <section className="hub-loading">Loading fuel activity…</section> : <>
      <section className="fuel-metric-grid"><article className="metric-card metric-primary"><span>Total spend</span><strong>{currency(data.totals.total_spend)}</strong></article><article className="metric-card"><span>Fuel gallons</span><strong>{number(data.totals.fuel_gallons, 1)}</strong></article><article className="metric-card"><span>Fuel transactions</span><strong>{number(data.totals.transactions)}</strong></article><article className="metric-card"><span>Average price per gallon</span><strong>{currency(data.totals.average_price_per_gallon)}</strong></article><button className="metric-card metric-card-action fuel-alert-card" onClick={() => setView("gasoline")}><span>Gasoline spend</span><strong>{currency(data.totals.gasoline_spend)}</strong><small>{number(data.totals.gasoline_lines)} lines · Review →</small></button></section>
      {supervisor && <section className="panel fuel-supervisor-report">
        <div className="fuel-supervisor-heading"><div><p className="eyebrow">Monthly supervisor fuel report</p><h2>{supervisor}</h2><span>{displayDate(start)} – {displayDate(end)} · {data.monthly_contracts.length} month/contract rows</span></div><div className="fuel-supervisor-actions no-print"><button className="clear-filters" onClick={downloadSupervisorCsv}>Download CSV</button><button className="primary-link" onClick={() => window.print()}>Print report</button></div></div>
        <div className="fuel-print-summary"><div><span>Total spend</span><strong>{currency(data.totals.total_spend)}</strong></div><div><span>Fuel gallons</span><strong>{number(data.totals.fuel_gallons,1)}</strong></div><div><span>Transactions</span><strong>{number(data.totals.transactions)}</strong></div><div><span>Contracts</span><strong>{number(new Set(data.monthly_contracts.map((row) => row.contract_number)).size)}</strong></div></div>
        <div className="table-scroll"><table className="data-table fuel-monthly-report-table"><thead><tr><th>Month</th><th>Contract</th><th>Employees</th><th>Transactions</th><th>Fuel gallons</th><th>Gasoline spend</th><th>Total spend</th></tr></thead><tbody>{data.monthly_contracts.map((row) => <tr key={`${row.period_start}-${row.contract_number}`}><td>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${row.period_start}T12:00:00Z`))}</td><td className="font-semibold text-navy">{row.contract_number}</td><td>{number(row.employees)}</td><td>{number(row.transactions)}</td><td>{number(row.fuel_gallons,1)}</td><td>{currency(row.gasoline_spend)}</td><td><strong>{currency(row.total_spend)}</strong></td></tr>)}</tbody></table></div>
      </section>}
      <nav className="fuel-view-tabs" aria-label="Fuel report view"><button className={view === "contracts" ? "active" : ""} onClick={() => setView("contracts")}>Contracts</button><button className={view === "people" ? "active" : ""} onClick={() => setView("people")}>Employees</button><button className={view === "stations" ? "active" : ""} onClick={() => setView("stations")}>Stations</button><button className={view === "products" ? "active" : ""} onClick={() => setView("products")}>Fuel types</button><button className={view === "trend" ? "active" : ""} onClick={() => setView("trend")}>Trend</button><button className={view === "gasoline" ? "active fuel-warning-tab" : "fuel-warning-tab"} onClick={() => setView("gasoline")}>Gasoline review</button><button className={view === "spend-alerts" ? "active fuel-warning-tab" : "fuel-warning-tab"} onClick={() => setView("spend-alerts")}>Spend alerts ({data.spend_alerts.length})</button><button className={view === "controls" ? "active" : ""} onClick={() => setView("controls")}>Employee fuel controls</button></nav>

      {(view === "contracts" || view === "people" || view === "stations") && <section className="panel overflow-hidden"><div className="panel-heading"><h2>{view === "contracts" ? "Fuel by contract" : view === "people" ? "Fuel by employee" : "Fuel by station"}</h2><span>{displayDate(start)} – {displayDate(end)}</span></div><div className="table-scroll fuel-table-scroll"><table className="data-table"><thead><tr><th>{view === "contracts" ? "Contract" : view === "people" ? "Employee" : "Station"}</th>{view === "stations" && <th>Location</th>}<th>Transactions</th><th>Fuel gallons</th><th>Gasoline spend</th><th>Total spend</th></tr></thead><tbody>{activeRows.map((row) => <tr key={`${row.name}-${row.city || ""}-${row.state || ""}`}><td className="font-semibold text-navy">{row.name}</td>{view === "stations" && <td>{[row.city,row.state].filter(Boolean).join(", ")}</td>}<td>{number(row.transactions)}</td><td>{number(row.fuel_gallons,1)}</td><td>{currency(row.gasoline_spend || 0)}</td><td><strong>{currency(row.total_spend)}</strong></td></tr>)}</tbody></table></div></section>}

      {view === "products" && <section className="panel overflow-hidden"><div className="panel-heading"><h2>Spend by fuel type</h2><span>Fees and adjustments remain separate from fuel gallons</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Category</th><th>Line items</th><th>Units/gallons</th><th>Total spend</th></tr></thead><tbody>{data.by_product.map((row) => <tr key={row.name}><td className="font-semibold text-navy">{productLabel(row.name)}</td><td>{number(row.line_items)}</td><td>{number(row.units,1)}</td><td><strong>{currency(row.total_spend)}</strong></td></tr>)}</tbody></table></div></section>}

      {view === "trend" && <section className="panel overflow-hidden"><div className="panel-heading"><h2>{grain === "month" ? "Monthly" : grain === "day" ? "Daily" : "Weekly"} fuel trend</h2><span>{displayDate(start)} – {displayDate(end)}</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Period starting</th><th>Transactions</th><th>Fuel gallons</th><th>Total spend</th></tr></thead><tbody>{data.trend.map((row) => <tr key={row.period_start}><td className="font-semibold text-navy">{displayDate(row.period_start)}</td><td>{number(row.transactions)}</td><td>{number(row.fuel_gallons,1)}</td><td><strong>{currency(row.total_spend)}</strong></td></tr>)}</tbody></table></div></section>}

      {view === "gasoline" && <section className="panel overflow-hidden"><div className="panel-heading"><div><h2>Gasoline purchases for review</h2><span>Authorized car drivers are identified; all others remain flagged for review.</span></div><strong className="fuel-gas-total">{currency(data.totals.gasoline_spend)}</strong></div>{data.gasoline_alerts.length ? <div className="table-scroll fuel-table-scroll"><table className="data-table"><thead><tr><th>Status</th><th>Date</th><th>Employee</th><th>Contract</th><th>Vehicle</th><th>Station</th><th>Product</th><th>Gallons</th><th>PPG</th><th>Cost</th></tr></thead><tbody>{data.gasoline_alerts.map((row,index) => <tr className={row.gasoline_authorized ? "" : "fuel-policy-alert-row"} key={`${row.transaction_date}-${row.person_name}-${row.net_cost}-${index}`}><td><span className={row.gasoline_authorized ? "fuel-policy-ok" : "fuel-policy-warning"}>{row.gasoline_authorized ? "Authorized" : "Review"}</span></td><td>{displayDate(row.transaction_date)}</td><td className="font-semibold text-navy">{row.person_name}</td><td>{row.contract_number}</td><td>{row.vehicle_number || "—"}</td><td>{row.merchant_name}<small className="fuel-location">{[row.merchant_city,row.merchant_state].filter(Boolean).join(", ")}</small></td><td>{row.product_description}</td><td>{number(row.unit_gallons,2)}</td><td>{currency(row.price_per_unit)}</td><td><strong>{currency(row.net_cost)}</strong></td></tr>)}</tbody></table></div> : <div className="location-empty">No gasoline purchases match the selected filters.</div>}</section>}

      {view === "spend-alerts" && <section className="panel overflow-hidden"><div className="panel-heading"><div><h2>Monthly spending alerts</h2><span>Employees whose selected-month spending exceeded their saved limit.</span></div></div>{data.spend_alerts.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Month</th><th>Employee</th><th>Monthly spend</th><th>Limit</th><th>Over limit</th></tr></thead><tbody>{data.spend_alerts.map((row) => <tr className="fuel-policy-alert-row" key={`${row.person_name}-${row.period_start}`}><td>{displayDate(row.period_start)}</td><td className="font-semibold text-navy">{row.person_name}</td><td>{currency(row.total_spend)}</td><td>{currency(row.monthly_spend_limit)}</td><td><strong>{currency(row.overage)}</strong></td></tr>)}</tbody></table></div> : <div className="location-empty">No employees exceeded a saved monthly limit in this date range.</div>}</section>}

      {view === "controls" && <section className="panel fuel-controls-panel"><div className="panel-heading"><div><h2>Employee fuel controls</h2><span>Mark legitimate gasoline users and set optional monthly spending limits.</span></div></div>{canUpload && <div className="fuel-rule-form"><label>Employee<select value={rulePerson} onChange={(event) => selectRulePerson(event.target.value)}><option value="">Select employee</option>{options.people.map((item) => <option key={item}>{item}</option>)}</select></label><label className="fuel-rule-check"><input type="checkbox" checked={gasolineAuthorized} onChange={(event) => setGasolineAuthorized(event.target.checked)} /> Authorized to purchase gasoline</label><label>Monthly spending limit<input type="number" min="0" step="25" placeholder="No limit" value={monthlyLimit} onChange={(event) => setMonthlyLimit(event.target.value)} /></label><label>Notes<input type="text" placeholder="Car, route, or approval details" value={ruleNotes} onChange={(event) => setRuleNotes(event.target.value)} /></label><button className="primary-link" disabled={!rulePerson || savingRule} onClick={() => void saveEmployeeRule()}>{savingRule ? "Saving…" : "Save controls"}</button></div>}<div className="table-scroll"><table className="data-table"><thead><tr><th>Employee</th><th>Gasoline</th><th>Monthly limit</th><th>Notes</th></tr></thead><tbody>{employeeRules.map((rule) => <tr key={rule.person_name}><td className="font-semibold text-navy">{rule.person_name}</td><td>{rule.gasoline_authorized ? "Authorized" : "Not authorized"}</td><td>{rule.monthly_spend_limit == null ? "No limit" : currency(rule.monthly_spend_limit)}</td><td>{rule.notes || "—"}</td></tr>)}</tbody></table></div></section>}
    </>}
  </div>;
}
