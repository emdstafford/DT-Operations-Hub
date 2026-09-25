"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import TimecardComparisons, { type SavedReport, type TimecardSummaryEntry } from "@/components/TimecardComparisons";
import * as XLSX from "xlsx";

type Field = "last" | "first" | "contract" | "inTime" | "outTime" | "hours" | "payCode";
type Columns = Record<Field, number>;
type Source = { name: string; sheets: Record<string, string[][]>; sheet: string; headerRow: number; columns: Columns; dateColumn: number; employeeIdColumn: number; combinedNameColumn: number };
type Shift = { contract: string; last: string; first: string; employeeId: string; date: string; inTime: string; outTime: string; payCode: string; hundredths: number };
type InvalidRow = { line: number; name: string; contract: string; date: string; hours: string; reason: string };
type Result = { rows: Shift[]; invalid: number; invalidRows: InvalidRow[]; pto: number; subtotals: number; unassigned: number };
type Assignment = { contract_number: string; supervisor: string; start_date: string; end_date: string | null };
type CurrentAssignment = { contract_number: string; supervisor: string };
const fields: Field[] = ["last", "first", "contract", "inTime", "outTime", "hours", "payCode"];
const fieldLabels: Record<Field, string> = { last: "Last name", first: "First name", contract: "Worked department / contract", inTime: "In time", outTime: "Out time", hours: "Hours", payCode: "Pay code / earnings code (exclude PTO)" };
const aliases: Record<Field, string[]> = {
  last: ["last name", "surname"], first: ["first name", "given name"], contract: ["worked department", "contract", "contract number"],
  inTime: ["in time", "time in", "in punch"], outTime: ["out time", "time out", "out punch"], hours: ["hours", "worked hours"], payCode: ["pay code", "paycode", "earnings code"],
};
const normalize = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const detect = (headings: string[], field: Field) => headings.findIndex((name) => aliases[field].includes(normalize(name)));
const detectDate = (headings: string[]) => headings.findIndex((name) => ["pay date", "work date", "worked date", "date", "shift date"].includes(normalize(name)));
const detectEmployeeId = (headings: string[]) => headings.findIndex((name) => ["position id", "employee id", "file number", "file #"].includes(normalize(name)));
const detectCombinedName = (headings: string[]) => headings.findIndex((name) => ["payroll name", "employee name", "driver name", "full name"].includes(normalize(name)));
const detectColumns = (headings: string[]): Columns => Object.fromEntries(fields.map((field) => [field, detect(headings, field)])) as Columns;
const validColumns = (source: Source) => {
  const width = source.sheets[source.sheet]?.[source.headerRow]?.length ?? 0;
  const used = fields.filter((field) => field !== "last" && field !== "first").map((field) => source.columns[field]);
  const namesSeparate = source.columns.last >= 0 && source.columns.first >= 0;
  if (namesSeparate) used.push(source.columns.last, source.columns.first);
  else used.push(source.combinedNameColumn);
  return used.every((index) => index >= 0 && index < width) && new Set(used).size === used.length && (source.dateColumn < 0 || source.dateColumn < width);
};
const unassignedDepartment = "UNASSIGNED_DEPARTMENT";
const hoursLabel = (hundredths: number) => (hundredths / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoursChange = (current: number, earlier: number) => `${current - earlier > 0 ? "+" : ""}${hoursLabel(current - earlier)}`;
const dateLabel = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
function workDate(value: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s.*)?$/.exec(value.trim()) ?? /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(value.trim());
  if (!match) return null;
  const iso = match[1].length === 4;
  const yearText = iso ? match[1] : match[3];
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  const month = Number(iso ? match[2] : match[1]);
  const day = Number(iso ? match[3] : match[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function parse(source: Source | null): Result {
  const rows: Shift[] = [];
  const invalidRows: InvalidRow[] = [];
  let pto = 0, subtotals = 0, unassigned = 0;
  if (!source || !validColumns(source)) return { rows, invalid: 0, invalidRows, pto, subtotals, unassigned };
  const col = source.columns;
  for (const [index, cells] of source.sheets[source.sheet].slice(source.headerRow + 1).entries()) {
    if (!cells.some((cell) => cell.trim())) continue;
    const rawContract = (cells[col.contract] ?? "").trim();
    const rawName = source.combinedNameColumn >= 0 ? (cells[source.combinedNameColumn] ?? "").trim() : "";
    if (!rawName && !cells[col.last]?.trim() && !cells[col.first]?.trim() && !cells[col.inTime]?.trim() && !cells[col.outTime]?.trim() && / total$/i.test(rawContract)) { subtotals++; continue; }
    if ((cells[col.payCode] ?? "").trim().toUpperCase() === "PTO") { pto++; continue; }
    const date = workDate(cells[col.inTime] ?? "") ?? (source.dateColumn >= 0 ? workDate(cells[source.dateColumn] ?? "") : null);
    const hourText = (cells[col.hours] ?? "").trim().replaceAll(",", "");
    const hours = Number(hourText);
    const contract = rawContract || unassignedDepartment;
    const comma = rawName.indexOf(",");
    const separateNames = col.last >= 0 && col.first >= 0;
    const last = separateNames ? (cells[col.last] ?? "").trim() : comma >= 0 ? rawName.slice(0, comma).trim() : "";
    const first = separateNames ? (cells[col.first] ?? "").trim() : comma >= 0 ? rawName.slice(comma + 1).trim() : "";
    const reason = !last || !first ? "Name missing" : !date ? "Work date unreadable" : !hourText || !/^[-+]?\d+(?:\.\d{1,2})?$/.test(hourText) || !Number.isFinite(hours) ? "Hours unreadable" : "";
    if (reason) { invalidRows.push({ line: source.headerRow + index + 2, name: `${first} ${last}`.trim(), contract: rawContract, date: source.dateColumn >= 0 ? (cells[source.dateColumn] ?? "") : (cells[col.inTime] ?? ""), hours: hourText, reason }); continue; }
    if (!rawContract) unassigned++;
    const employeeId = (cells[source.employeeIdColumn] ?? "").trim() || `name:${last.toLowerCase()}|${first.toLowerCase()}`;
    rows.push({ contract, last, first, employeeId, date: date!, inTime: (cells[col.inTime] ?? "").trim(), outTime: (cells[col.outTime] ?? "").trim(), payCode: (cells[col.payCode] ?? "").trim(), hundredths: Math.round(hours * 100) });
  }
  return { rows, invalid: invalidRows.length, invalidRows, pto, subtotals, unassigned };
}
const total = (rows: Shift[]) => rows.reduce((sum, row) => sum + row.hundredths, 0);
const approvedWithoutSupervisor = new Set(["01SHDR", "011VAN"]);
const omitFromTimecardPrint = (contract: string) => {
  const key = contract.trim().toUpperCase();
  return approvedWithoutSupervisor.has(key) || key.replace(/^0+(?=\d)/, "") === "30512";
};
async function sourceFromFile(upload: File): Promise<Source> {
  if (!/\.(csv|xlsx|xls)$/i.test(upload.name)) throw new Error("Choose an Excel or CSV timecard report.");
  const workbook = XLSX.read(await upload.arrayBuffer(), { type: "array", cellDates: false });
  const sheets: Record<string, string[][]> = {};
  for (const name of workbook.SheetNames) sheets[name] = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "", raw: false }).map((row) => row.map((value) => String(value ?? "")));
  const choices = workbook.SheetNames.flatMap((sheet) => sheets[sheet].slice(0, 30).map((row, headerRow) => ({ sheet, headerRow, score: fields.filter((field) => detect(row, field) >= 0).length + (detectCombinedName(row) >= 0 ? 2 : 0) })));
  const best = choices.sort((a, b) => b.score - a.score)[0];
  if (!best) throw new Error("This report has no readable sheets or rows.");
  const headings = sheets[best.sheet][best.headerRow];
  return { name: upload.name, sheets, sheet: best.sheet, headerRow: best.headerRow, columns: detectColumns(headings), dateColumn: detectDate(headings), employeeIdColumn: detectEmployeeId(headings), combinedNameColumn: detectCombinedName(headings) };
}

function clock(value: string) {
  const match = /(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i.exec(value.trim());
  if (match) return `${Number(match[1])}:${match[2]} ${match[3].toUpperCase()}`;
  return value.trim() || "—";
}
function contractKeys(value: string) {
  const raw = value.trim().toUpperCase();
  return [...new Set([raw, raw.replace(/^0+(?=\d)/, "")])];
}
function TimecardRows({ rows }: { rows: Shift[] }) {
  return <section className="timecard-period"><table className="data-table"><thead><tr><th>Date</th><th>Time In</th><th>Time Out</th><th>Hours</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.inTime}-${index}`}><td>{dateLabel(row.date)}</td><td>{clock(row.inTime)}</td><td>{clock(row.outTime)}</td><td>{hoursLabel(row.hundredths)}</td></tr>)}</tbody></table></section>;
}
function HoursInline({ current, previous, currentName }: { current: number; previous: { name: string; hours: number } | null; currentName: string }) {
  return <span className="timecard-compare-inline">{previous && <span>Previous {previous.name}: <b>{hoursLabel(previous.hours)}</b></span>}<span>Current {currentName}: <b>{hoursLabel(current)}</b></span>{previous && <span className={current < previous.hours ? "timecard-hours-down" : current > previous.hours ? "timecard-hours-up" : ""}>Change from last payroll: <b>{hoursChange(current, previous.hours)}</b></span>}</span>;
}
export default function TimecardPacket() {
  const [file, setFile] = useState<Source | null>(null);
  const [payrollName, setPayrollName] = useState("");
  const [confirmedPayrollName, setConfirmedPayrollName] = useState("");
  const [error, setError] = useState("");
  const [excludeUnreadable, setExcludeUnreadable] = useState(false);
  const result = useMemo(() => parse(file), [file]);
  const ready = !!file && validColumns(file) && (result.invalid === 0 || excludeUnreadable) && result.rows.length > 0;
  useEffect(() => { setExcludeUnreadable(false); }, [file]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [currentAssignments, setCurrentAssignments] = useState<CurrentAssignment[]>([]);
  const [supervisorStatus, setSupervisorStatus] = useState<"loading" | "ready" | "error">("loading");
  const [assignmentName, setAssignmentName] = useState<Record<string, string>>({});
  const [assignmentSaving, setAssignmentSaving] = useState("");
  const [assignmentErrors, setAssignmentErrors] = useState<Record<string, string>>({});
  const [supervisorChoices, setSupervisorChoices] = useState<string[]>([]);
  const [previousPayroll, setPreviousPayroll] = useState<SavedReport | null>(null);
  const [firstPayroll, setFirstPayroll] = useState<SavedReport | null>(null);
  const [comparisonStatus, setComparisonStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const contracts = useMemo(() => {
    const groups = new Map<string, Map<string, Shift[]>>();
    for (const row of result.rows) {
      if (!groups.has(row.contract)) groups.set(row.contract, new Map());
      const people = groups.get(row.contract)!;
      const person = `${row.employeeId}\u0000${row.last}\u0000${row.first}`;
      if (!people.has(person)) people.set(person, []);
      people.get(person)!.push(row);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([contract, people]) => ({
      contract,
      people: [...people].sort(([a], [b]) => a.localeCompare(b)).map(([name, rows]) => ({ name: `${rows[0].last}, ${rows[0].first}`, employeeId: rows[0].employeeId, rows: rows.sort((a, b) => a.inTime.localeCompare(b.inTime)) })),
    }));
  }, [result.rows]);
  const printContracts = contracts.filter(({ contract }) => !omitFromTimecardPrint(contract));
  async function readFile(upload?: File) {
    if (!upload) return;
    setError("");
    setExcludeUnreadable(false);
    try {
      setFile(await sourceFromFile(upload));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to read this report."); }
  }
  useEffect(() => {
    let active = true;
    void (async () => {
      const [dated, current] = await Promise.all([
        supabase.from("contract_assignment_periods").select("contract_number,supervisor,start_date,end_date"),
        supabase.from("contract_supervisors").select("contract_number,supervisor"),
      ]);
      if (!active) return;
      if (dated.error || current.error) { setSupervisorStatus("error"); return; }
      setAssignments((dated.data ?? []) as Assignment[]);
      setCurrentAssignments((current.data ?? []) as CurrentAssignment[]);
      setSupervisorStatus("ready");
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    void supabase.rpc("supervisor_options").then(({ data }) => {
      if (active) setSupervisorChoices((data ?? []).map((row: { supervisor: string }) => row.supervisor));
    });
    return () => { active = false; };
  }, []);
  function supervisorsFor(contract: string, rows: Shift[]) {
    const keys = contractKeys(contract);
    const datedForContract = assignments.filter((item) => keys.includes(item.contract_number.trim().toUpperCase()));
    const datedNames = datedForContract.filter((item) => rows.some((row) => item.start_date <= row.date && (!item.end_date || row.date <= item.end_date))).map((item) => item.supervisor);
    // Fall back only when there is no dated history for the contract at all.
    const names = datedNames.length ? datedNames : datedForContract.length ? [] : currentAssignments.filter((item) => keys.includes(item.contract_number.trim().toUpperCase())).map((item) => item.supervisor);
    return [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }
  const allDates = result.rows.map((row) => row.date).sort();
  const periodStart = allDates[0] || "";
  const periodEnd = allDates[allDates.length - 1] || "";
  useEffect(() => {
    if (!periodStart || !periodEnd) { return; }
    let active = true;
    setComparisonStatus("loading");
    void (async () => {
      const [history, baseline] = await Promise.all([
        supabase.from("timecard_summary_history").select("id,payroll_name,pay_date,period_start,period_end,source_file,saved_at,summary")
          .is("archived_at", null).order("period_end", { ascending: false }).order("saved_at", { ascending: false }).limit(250),
        supabase.from("timecard_comparison_baseline").select("report_id").eq("id", true).maybeSingle(),
      ]);
      if (!active) return;
      if (history.error || baseline.error) { setPreviousPayroll(null); setFirstPayroll(null); setComparisonStatus("error"); return; }
      const reports = (history.data ?? []) as SavedReport[];
      setPreviousPayroll(reports.find((report) => report.period_end < periodStart) ?? null);
      let first = reports.find((report) => report.id === baseline.data?.report_id) ?? null;
      if (!first && baseline.data?.report_id) {
        const original = await supabase.from("timecard_summary_history").select("id,payroll_name,pay_date,period_start,period_end,source_file,saved_at,summary")
          .eq("id", baseline.data.report_id).is("archived_at", null).maybeSingle();
        if (!active) return;
        if (original.error) { setComparisonStatus("error"); return; }
        first = original.data as SavedReport | null;
      }
      setFirstPayroll(first);
      setComparisonStatus("ready");
    })();
    return () => { active = false; };
  }, [periodStart, periodEnd]);
  function savedHours(report: SavedReport | null, contract: string, employeeId?: string, name?: string) {
    if (!report) return 0;
    const entries = report.summary.filter((entry) => entry.contract.trim().toUpperCase() === contract.trim().toUpperCase());
    if (!employeeId) return entries.reduce((sum, entry) => sum + entry.hundredths, 0);
    const idRows = entries.filter((entry) => entry.employeeId === employeeId);
    if (idRows.length) return idRows.reduce((sum, entry) => sum + entry.hundredths, 0);
    if (employeeId.startsWith("name:") || entries.some((entry) => entry.employeeId.startsWith("name:")))
      return entries.filter((entry) => entry.name.trim().toLowerCase() === name?.trim().toLowerCase()).reduce((sum, entry) => sum + entry.hundredths, 0);
    return 0;
  }
  const historyEntries = useMemo<TimecardSummaryEntry[]>(() => contracts.flatMap(({ contract, people }) => people.map((person) => ({
    contract, employeeId: person.employeeId, name: person.name, hundredths: total(person.rows),
  })).filter((entry) => entry.hundredths > 0)), [contracts]);
  const unassigned = supervisorStatus === "ready" ? printContracts.filter(({ contract, people }) => contract !== unassignedDepartment && !approvedWithoutSupervisor.has(contract.trim().toUpperCase()) && !supervisorsFor(contract, people.flatMap((person) => person.rows)).length) : [];
  const knownSupervisors = [...new Set([...supervisorChoices, ...assignments.map((item) => item.supervisor), ...currentAssignments.map((item) => item.supervisor)].map((name) => name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  async function assignSupervisor(contract: string, rows: Shift[]) {
    const supervisor = (assignmentName[contract] || "").trim();
    const dates = rows.map((row) => row.date).sort();
    if (!knownSupervisors.includes(supervisor) || !dates.length) { setAssignmentErrors((current) => ({ ...current, [contract]: "Choose a supervisor from the list." })); return; }
    setAssignmentSaving(contract); setAssignmentErrors((current) => ({ ...current, [contract]: "" }));
    try {
      const result = await supabase.rpc("assign_timecard_contract_supervisor", { p_contract: contract, p_supervisor: supervisor, p_start: dates[0], p_end: dates[dates.length - 1] });
      if (result.error) setAssignmentErrors((current) => ({ ...current, [contract]: result.error.code === "42501" ? "Payroll access for historical assignments must be enabled in Supabase." : result.error.message }));
      else {
        setAssignments((current) => [...current, { contract_number: contract, supervisor, start_date: dates[0], end_date: dates[dates.length - 1] }]);
        setAssignmentName((current) => ({ ...current, [contract]: "" }));
      }
    } catch (reason) { setAssignmentErrors((current) => ({ ...current, [contract]: reason instanceof Error ? reason.message : "Could not save this assignment." })); }
    finally { setAssignmentSaving(""); }
  }
  return <div className="report-stack timecard-stack">
    <section className="panel timecard-intro no-print"><strong>One report, grouped by contract</strong><p>Choose the timecard report for this pay period. The file stays in this browser tab and clears when you refresh or close it. The printed packet can be compared with notes from the previous pay period.</p></section>
    {error && <div className="alert alert-error no-print">{error}</div>}
    <section className="panel timecard-settings no-print">
      <div className="panel-heading"><div><h2>Timecard report</h2><span>{file?.name || "Choose a report"}</span></div><label className="primary-link timecard-file-button">Choose report<input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void readFile(event.target.files?.[0])} /></label></div>
      {file && <details className="timecard-column-options" open={!validColumns(file)} key={`${file.name}-${file.sheet}-${file.headerRow}`}><summary>Match file columns {validColumns(file) ? "(review or change)" : "— action needed"}</summary><p>Select the sheet and header row, then match each required field to its column. The file stays in this browser tab.</p><div className="timecard-fields"><label>Sheet<select value={file.sheet} onChange={(event) => setFile((current) => { if (!current) return current; const sheet = event.target.value; const headerRow = 0; const headings = current.sheets[sheet]?.[headerRow] ?? []; return { ...current, sheet, headerRow, columns: detectColumns(headings), dateColumn: detectDate(headings), employeeIdColumn: detectEmployeeId(headings), combinedNameColumn: detectCombinedName(headings) }; })}>{Object.keys(file.sheets).map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}</select></label><label>Header row<select value={file.headerRow} onChange={(event) => setFile((current) => { if (!current) return current; const headerRow = Number(event.target.value); const headings = current.sheets[current.sheet][headerRow] ?? []; return { ...current, headerRow, columns: detectColumns(headings), dateColumn: detectDate(headings), employeeIdColumn: detectEmployeeId(headings), combinedNameColumn: detectCombinedName(headings) }; })}>{file.sheets[file.sheet].slice(0, 30).map((row, index) => <option key={index} value={index}>Row {index + 1}: {row.filter(Boolean).slice(0, 3).join(" · ").slice(0, 90) || "(blank)"}</option>)}</select></label><label>Combined name (Last, First; if separate names are missing)<select value={file.combinedNameColumn} onChange={(event) => setFile((current) => current && ({ ...current, combinedNameColumn: Number(event.target.value) }))}><option value={-1}>Use Last name and First name</option>{(file.sheets[file.sheet][file.headerRow] ?? []).map((heading, index) => <option key={index} value={index}>{heading.trim() || `(unnamed column ${index + 1})`}</option>)}</select></label><label>Work date (if separate from In time)<select value={file.dateColumn} onChange={(event) => setFile((current) => current && ({ ...current, dateColumn: Number(event.target.value) }))}><option value={-1}>Date is included in In time</option>{(file.sheets[file.sheet][file.headerRow] ?? []).map((heading, index) => <option key={index} value={index}>{heading.trim() || `(unnamed column ${index + 1})`} · {String.fromCharCode(65 + index)}</option>)}</select></label><label>Employee ID (optional)<select value={file.employeeIdColumn} onChange={(event) => setFile((current) => current && ({ ...current, employeeIdColumn: Number(event.target.value) }))}><option value={-1}>Match by name</option>{(file.sheets[file.sheet][file.headerRow] ?? []).map((heading, index) => <option key={index} value={index}>{heading.trim() || `(unnamed column ${index + 1})`} · {String.fromCharCode(65 + index)}</option>)}</select></label>{fields.map((field) => <label key={field}>{fieldLabels[field]}<select value={file.columns[field]} onChange={(event) => setFile((current) => current && ({ ...current, columns: { ...current.columns, [field]: Number(event.target.value) } }))}><option value={-1}>Choose column</option>{(file.sheets[file.sheet][file.headerRow] ?? []).map((heading, index) => <option key={index} value={index}>{heading.trim() || `(unnamed column ${index + 1})`} · {String.fromCharCode(65 + index)}</option>)}</select></label>)}</div>{!validColumns(file) && <p role="alert">Match the date, time, hours, department, earnings code, and either both name columns or a combined Payroll Name column.</p>}{validColumns(file) && result.rows.length === 0 && <p role="alert">No timecard rows were found. Check the sheet, Payroll Name or separate name columns, Work date, and Hours columns.</p>}{validColumns(file) && result.invalid > 0 && <p role="alert">{result.invalid} rows could not be read. Check the mapping and data before saving or printing.</p>}</details>}
      <div className="timecard-payroll-fields"><label>Payroll name or number<input type="text" value={payrollName} maxLength={100} placeholder="Example: #39" onChange={(event) => { setPayrollName(event.target.value); setConfirmedPayrollName(""); }} onBlur={() => setConfirmedPayrollName(payrollName.trim())} /></label><span>Use the same number when uploading corrected timecards. The report dates are read from the file.</span></div>
      {file && <div className="timecard-status"><span>{result.rows.length.toLocaleString()} rows · {hoursLabel(total(result.rows))} hours</span><span>{result.pto} PTO rows excluded</span><span>{result.subtotals} subtotal lines skipped</span>{result.unassigned > 0 && <strong>{result.unassigned} work entries have no department and are included under Unassigned department.</strong>}{comparisonStatus === "loading" && <span>Looking up previous payroll hours…</span>}{comparisonStatus === "ready" && !firstPayroll && previousPayroll && <strong>To show the first ADP payroll, select it under “First payroll in the new system” on Timecard Comparisons.</strong>}{comparisonStatus === "error" && <strong>Saved payroll comparisons are unavailable. The time entries can still print.</strong>}{file.employeeIdColumn < 0 && <strong>No employee ID column found. Comparisons will match drivers by name.</strong>}{result.invalid > 0 && <strong>{result.invalid} rows need review before they can be included.</strong>}{supervisorStatus === "error" && <strong>Supervisor assignments could not be loaded; contract headings will show “Supervisor unavailable.”</strong>}{unassigned.length > 0 && <details className="timecard-unassigned"><summary>{unassigned.length} historical contract{unassigned.length === 1 ? " has" : "s have"} no supervisor assignment for these dates. Review contracts →</summary><p>These contracts may be completed now. Choose who supervised them during the dates in this file. This is separate from reviewing unreadable rows.</p>{unassigned.map(({contract,people}) => { const rows = people.flatMap((person) => person.rows); const dates = rows.map((row) => row.date).sort(); return <div className="timecard-unassigned-row" key={contract}><strong>{contract} · {dateLabel(dates[0])} – {dateLabel(dates[dates.length-1])}</strong><select aria-label={`Supervisor for ${contract}`} value={assignmentName[contract] || ""} onChange={(event) => { setAssignmentName((current) => ({ ...current, [contract]: event.target.value })); setAssignmentErrors((current) => ({ ...current, [contract]: "" })); }}><option value="">Choose supervisor</option>{knownSupervisors.map((name) => <option key={name} value={name}>{name}</option>)}</select><button type="button" disabled={!!assignmentSaving} onClick={() => void assignSupervisor(contract, rows)}>{assignmentSaving === contract ? "Saving…" : "Save assignment"}</button>{assignmentErrors[contract] && <span className="timecard-assignment-error" role="alert">{assignmentErrors[contract]}</span>}</div>; })}</details>}</div>}
      {file && result.invalid > 0 && <details className="timecard-invalid-review"><summary>Review {result.invalid} unreadable rows before saving →</summary><p>These rows are separate from the supervisor assignments. Subtotal lines are skipped automatically; these rows still need review. Excluding them removes their hours from this report and its saved comparison.</p><div className="table-scroll"><table className="data-table"><thead><tr><th>File row</th><th>Reason</th><th>Employee</th><th>Contract</th><th>Work date</th><th>Hours</th></tr></thead><tbody>{result.invalidRows.slice(0, 100).map((row) => <tr key={row.line}><td>{row.line}</td><td>{row.reason}</td><td>{row.name || "—"}</td><td>{row.contract || "—"}</td><td>{row.date || "—"}</td><td>{row.hours || "—"}</td></tr>)}</tbody></table></div>{result.invalid > 100 && <p>Showing the first 100 rows. Correct the source file to review the rest.</p>}<label className="timecard-exclude-confirm"><input type="checkbox" checked={excludeUnreadable} onChange={(event) => setExcludeUnreadable(event.target.checked)} /> I reviewed these rows and want to exclude all {result.invalid} unreadable rows from this payroll packet and saved totals.</label></details>}
    </section>
    <section className="panel timecard-actions no-print"><button className="primary-link" disabled={!ready || !printContracts.length || supervisorStatus === "loading" || comparisonStatus === "loading"} onClick={() => window.print()}>Print by contract</button><span>{ready ? `${printContracts.length} contracts. Each starts on a new page. 030512, 01SHDR, and 011VAN are omitted from this packet.` : "Choose one report. All rows must be readable before printing."}</span></section>
    {ready && confirmedPayrollName ? <TimecardComparisons entries={historyEntries} start={periodStart} end={periodEnd} sourceName={file?.name || "Timecard report"} payrollName={confirmedPayrollName} /> : ready && <section className="panel no-print timecard-comparisons"><h2>Save and compare payrolls</h2><p>Enter the payroll name or number above, such as #39, to save the hour totals. Reuse it for a corrected report. You can print the timecards now.</p></section>}
    {ready && <div className="timecard-packet"><div className="timecard-screen-heading no-print"><h2>Packet preview</h2><p>Check the hours and contract assignments before printing the packet.</p></div>{printContracts.map(({ contract, people }) => {
      const contractRows = people.flatMap((person) => person.rows);
      const supervisors = supervisorsFor(contract, contractRows);
      return <section className="timecard-contract" key={contract}><header><div><h2>{contract === unassignedDepartment ? "Unassigned department" : `Contract ${contract}`}</h2><span>{payrollName.trim() ? `${payrollName.trim()} · ` : ""}{dateLabel(periodStart)} – {dateLabel(periodEnd)}</span></div><div className="timecard-supervisor-heading"><span>{approvedWithoutSupervisor.has(contract.trim().toUpperCase()) && !supervisors.length ? "No supervisor required" : `Supervisor${supervisors.length === 1 ? "" : "s"}`}</span><strong>{supervisors.length ? supervisors.join(", ") : approvedWithoutSupervisor.has(contract.trim().toUpperCase()) ? "Approved" : supervisorStatus === "loading" ? "Loading…" : supervisorStatus === "error" ? "Unavailable" : "Not assigned"}</strong><small>{people.length} employees</small></div></header>
        <div className="timecard-contract-totals"><div className="timecard-contract-hours"><strong>Contract hours</strong><HoursInline current={total(contractRows)} currentName={payrollName.trim() || "this report"} previous={previousPayroll ? { name: previousPayroll.payroll_name, hours: savedHours(previousPayroll, contract) } : null} /></div></div>
        {people.map((person) => <div className="timecard-person" key={person.name}><h3><span className="timecard-driver-name">{person.name}</span><HoursInline current={total(person.rows)} currentName={payrollName.trim() || "this report"} previous={previousPayroll ? { name: previousPayroll.payroll_name, hours: savedHours(previousPayroll, contract, person.employeeId, person.name) } : null} /></h3><TimecardRows rows={person.rows} /></div>)}
        <footer><span>Reviewed by: ____________________ &nbsp; Date: ______________</span></footer>
      </section>;
    })}</div>}
  </div>;
}
