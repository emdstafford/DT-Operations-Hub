"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import TimecardComparisons, { type SavedReport, type TimecardSummaryEntry } from "@/components/TimecardComparisons";
import * as XLSX from "xlsx";

type Field = "last" | "first" | "contract" | "inTime" | "outTime" | "hours" | "payCode";
type Columns = Record<Field, number>;
type Source = { name: string; sheets: Record<string, string[][]>; sheet: string; headerRow: number; columns: Columns; employeeIdColumn: number };
type Shift = { contract: string; last: string; first: string; employeeId: string; date: string; inTime: string; outTime: string; payCode: string; hundredths: number };
type Result = { rows: Shift[]; invalid: number; pto: number };
type Assignment = { contract_number: string; supervisor: string; start_date: string; end_date: string | null };
type CurrentAssignment = { contract_number: string; supervisor: string };
const fields: Field[] = ["last", "first", "contract", "inTime", "outTime", "hours", "payCode"];
const aliases: Record<Field, string[]> = {
  last: ["last name", "surname"], first: ["first name", "given name"], contract: ["worked department", "contract", "contract number"],
  inTime: ["in time", "time in", "in punch"], outTime: ["out time", "time out", "out punch"], hours: ["hours", "worked hours"], payCode: ["pay code", "paycode"],
};
const normalize = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const detect = (headings: string[], field: Field) => headings.findIndex((name) => aliases[field].includes(normalize(name)));
const detectColumns = (headings: string[]): Columns => Object.fromEntries(fields.map((field) => [field, detect(headings, field)])) as Columns;
const validColumns = (source: Source) => {
  const width = source.sheets[source.sheet]?.[source.headerRow]?.length ?? 0;
  return fields.every((field) => source.columns[field] >= 0 && source.columns[field] < width) && new Set(Object.values(source.columns)).size === fields.length;
};
const hoursLabel = (hundredths: number) => (hundredths / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoursChange = (current: number, earlier: number) => `${current - earlier > 0 ? "+" : ""}${hoursLabel(current - earlier)}`;
const dateLabel = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
function workDate(value: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec(value.trim()) ?? /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(value.trim());
  if (!match) return null;
  const iso = match[1].length === 4;
  const year = Number(iso ? match[1] : match[3]);
  const month = Number(iso ? match[2] : match[1]);
  const day = Number(iso ? match[3] : match[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function parse(source: Source | null): Result {
  const rows: Shift[] = [];
  let invalid = 0, pto = 0;
  if (!source || !validColumns(source)) return { rows, invalid, pto };
  const col = source.columns;
  for (const cells of source.sheets[source.sheet].slice(source.headerRow + 1)) {
    if (!cells.some((cell) => cell.trim())) continue;
    if ((cells[col.payCode] ?? "").trim().toUpperCase() === "PTO") { pto++; continue; }
    const date = workDate(cells[col.inTime] ?? "");
    const hourText = (cells[col.hours] ?? "").trim().replaceAll(",", "");
    const hours = Number(hourText);
    const contract = (cells[col.contract] ?? "").trim();
    const last = (cells[col.last] ?? "").trim();
    const first = (cells[col.first] ?? "").trim();
    if (!date || !contract || !last || !first || !hourText || !/^[-+]?\d+(?:\.\d{1,2})?$/.test(hourText) || !Number.isFinite(hours)) { invalid++; continue; }
    const employeeId = (cells[source.employeeIdColumn] ?? "").trim() || `name:${last.toLowerCase()}|${first.toLowerCase()}`;
    rows.push({ contract, last, first, employeeId, date, inTime: (cells[col.inTime] ?? "").trim(), outTime: (cells[col.outTime] ?? "").trim(), payCode: (cells[col.payCode] ?? "").trim(), hundredths: Math.round(hours * 100) });
  }
  return { rows, invalid, pto };
}
const total = (rows: Shift[]) => rows.reduce((sum, row) => sum + row.hundredths, 0);
const approvedWithoutSupervisor = new Set(["01SHDR", "011VAN"]);
const omitFromTimecardPrint = (contract: string) => contract.trim().replace(/^0+(?=\d)/, "") === "30512";

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
function HoursInline({ current, first, previous, currentName, showCurrent = true }: { current: number; first: { name: string; hours: number } | null; previous: { name: string; hours: number } | null; currentName: string; showCurrent?: boolean }) {
  if (!first && !previous) return null;
  return <span className="timecard-compare-inline">{first && <span>First {first.name}: <b>{hoursLabel(first.hours)}</b></span>}{previous && <span>Previous {previous.name}: <b>{hoursLabel(previous.hours)}</b></span>}{showCurrent && <span>Current {currentName}: <b>{hoursLabel(current)}</b></span>}{previous && <span className={current < previous.hours ? "timecard-hours-down" : current > previous.hours ? "timecard-hours-up" : ""}>Change: <b>{hoursChange(current, previous.hours)}</b></span>}</span>;
}

export default function TimecardPacket() {
  const [file, setFile] = useState<Source | null>(null);
  const [payrollName, setPayrollName] = useState("");
  const [confirmedPayrollName, setConfirmedPayrollName] = useState("");
  const [error, setError] = useState("");
  const result = useMemo(() => parse(file), [file]);
  const ready = !!file && validColumns(file) && result.invalid === 0 && result.rows.length > 0;
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [currentAssignments, setCurrentAssignments] = useState<CurrentAssignment[]>([]);
  const [supervisorStatus, setSupervisorStatus] = useState<"loading" | "ready" | "error">("loading");
  const [assignmentName, setAssignmentName] = useState<Record<string, string>>({});
  const [assignmentSaving, setAssignmentSaving] = useState("");
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
    try {
      if (!/\.(csv|xlsx|xls)$/i.test(upload.name)) throw new Error("Choose an Excel or CSV timecard report.");
      const workbook = XLSX.read(await upload.arrayBuffer(), { type: "array", cellDates: false });
      const sheets: Record<string, string[][]> = {};
      for (const name of workbook.SheetNames) sheets[name] = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "", raw: false }).map((row) => row.map((value) => String(value ?? "")));
      const choices = workbook.SheetNames.flatMap((sheet) => sheets[sheet].slice(0, 20).map((row, headerRow) => ({ sheet, headerRow, score: fields.filter((field) => detect(row, field) >= 0).length })));
      const best = choices.sort((a, b) => b.score - a.score)[0];
      if (!best || best.score !== fields.length) throw new Error("The report needs Last Name, First Name, Worked Department, In time, Out time, Hours, and Pay Code columns.");
      const headings = sheets[best.sheet][best.headerRow];
      const employeeIdColumn = headings.findIndex((name) => ["position id", "employee id", "file number", "file #"].includes(normalize(name)));
      setFile({ name: upload.name, sheets, sheet: best.sheet, headerRow: best.headerRow, columns: detectColumns(headings), employeeIdColumn });
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
  const unassigned = supervisorStatus === "ready" ? printContracts.filter(({ contract, people }) => !approvedWithoutSupervisor.has(contract.trim().toUpperCase()) && !supervisorsFor(contract, people.flatMap((person) => person.rows)).length) : [];
  async function assignSupervisor(contract: string, rows: Shift[]) {
    const supervisor = (assignmentName[contract] || "").trim();
    const dates = rows.map((row) => row.date).sort();
    if (!supervisor || !dates.length) { setError("Enter the supervisor's name to save an assignment."); return; }
    setAssignmentSaving(contract); setError("");
    const result = await supabase.rpc("assign_timecard_contract_supervisor", { p_contract: contract, p_supervisor: supervisor, p_start: dates[0], p_end: dates[dates.length - 1] });
    if (result.error) setError(result.error.code === "PGRST202" ? "Run supabase/timecard_supervisor_assignments.sql in Supabase to enable date-specific assignments." : result.error.message);
    else {
      setAssignments((current) => [...current, { contract_number: contract, supervisor, start_date: dates[0], end_date: dates[dates.length - 1] }]);
      setAssignmentName((current) => ({ ...current, [contract]: "" }));
    }
    setAssignmentSaving("");
  }
  return <div className="report-stack timecard-stack">
    <section className="panel timecard-intro no-print"><strong>One report, grouped by contract</strong><p>Choose the timecard report for this pay period. The file stays in this browser tab and clears when you refresh or close it. The printed packet can be compared with notes from the previous pay period.</p></section>
    {error && <div className="alert alert-error no-print">{error}</div>}
    <section className="panel timecard-settings no-print">
      <div className="panel-heading"><div><h2>Timecard report</h2><span>{file?.name || "Choose a report"}</span></div><label className="primary-link timecard-file-button">Choose report<input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void readFile(event.target.files?.[0])} /></label></div>
      <div className="timecard-payroll-fields"><label>Payroll name or number<input type="text" value={payrollName} maxLength={100} placeholder="Example: #39" onChange={(event) => { setPayrollName(event.target.value); setConfirmedPayrollName(""); }} onBlur={() => setConfirmedPayrollName(payrollName.trim())} /></label><span>Use the same number when uploading corrected timecards. The report dates are read from the file.</span></div>
      {file && <div className="timecard-status"><span>{result.rows.length.toLocaleString()} rows · {hoursLabel(total(result.rows))} hours</span><span>{result.pto} PTO rows excluded</span>{comparisonStatus === "loading" && <span>Looking up previous payroll hours…</span>}{comparisonStatus === "ready" && !firstPayroll && previousPayroll && <strong>To show the first ADP payroll, select it under “First payroll in the new system” on Timecard Comparisons.</strong>}{comparisonStatus === "error" && <strong>Saved payroll comparisons are unavailable. The time entries can still print.</strong>}{file.employeeIdColumn < 0 && <strong>No employee ID column found. Comparisons will match drivers by name.</strong>}{result.invalid > 0 && <strong>{result.invalid} rows need a readable name, contract, In time, or Hours. Correct the file before printing.</strong>}{supervisorStatus === "error" && <strong>Supervisor assignments could not be loaded; contract headings will show “Supervisor unavailable.”</strong>}{unassigned.length > 0 && <details className="timecard-unassigned"><summary>{unassigned.length} contract{unassigned.length === 1 ? " has" : "s have"} no supervisor assignment for these dates. Review contracts →</summary><p>Assign a supervisor for only the dates found in this file. Existing assignments outside those dates stay in place.</p>{unassigned.map(({contract,people}) => { const rows = people.flatMap((person) => person.rows); const dates = rows.map((row) => row.date).sort(); return <div className="timecard-unassigned-row" key={contract}><strong>{contract} · {dateLabel(dates[0])} – {dateLabel(dates[dates.length-1])}</strong><input aria-label={`Supervisor for ${contract}`} placeholder="Supervisor name" value={assignmentName[contract] || ""} onChange={(event) => setAssignmentName((current) => ({ ...current, [contract]: event.target.value }))} /><button type="button" disabled={!!assignmentSaving} onClick={() => void assignSupervisor(contract, rows)}>{assignmentSaving === contract ? "Saving…" : "Save assignment"}</button></div>; })}</details>}</div>}
    </section>
    <section className="panel timecard-actions no-print"><button className="primary-link" disabled={!ready || !printContracts.length || supervisorStatus === "loading" || comparisonStatus === "loading"} onClick={() => window.print()}>Print by contract</button><span>{ready ? `${printContracts.length} contracts. Each starts on a new page. Contract 030512 is omitted from this packet.` : "Choose one report. All rows must be readable before printing."}</span></section>
    {ready && confirmedPayrollName ? <TimecardComparisons entries={historyEntries} start={periodStart} end={periodEnd} sourceName={file?.name || "Timecard report"} payrollName={confirmedPayrollName} /> : ready && <section className="panel no-print timecard-comparisons"><h2>Save and compare payrolls</h2><p>Enter the payroll name or number above, such as #39, to save the hour totals. Reuse it for a corrected report. You can print the timecards now.</p></section>}
    {ready && <div className="timecard-packet"><div className="timecard-screen-heading no-print"><h2>Packet preview</h2><p>Check the hours and contract assignments before printing the packet.</p></div>{printContracts.map(({ contract, people }) => {
      const contractRows = people.flatMap((person) => person.rows);
      const supervisors = supervisorsFor(contract, contractRows);
      return <section className="timecard-contract" key={contract}><header><div><p>Davenport Transportation · Timecard review</p><h2>Contract {contract}</h2><span>{payrollName.trim() ? `${payrollName.trim()} · ` : ""}{dateLabel(periodStart)} – {dateLabel(periodEnd)}</span></div><div className="timecard-supervisor-heading"><span>{approvedWithoutSupervisor.has(contract.trim().toUpperCase()) && !supervisors.length ? "No supervisor required" : `Supervisor${supervisors.length === 1 ? "" : "s"}`}</span><strong>{supervisors.length ? supervisors.join(", ") : approvedWithoutSupervisor.has(contract.trim().toUpperCase()) ? "Approved" : supervisorStatus === "loading" ? "Loading…" : supervisorStatus === "error" ? "Unavailable" : "Not assigned"}</strong><small>{people.length} employees</small></div></header>
        <div className="timecard-contract-totals"><div className="timecard-contract-hours"><span>Contract hours</span><strong>{hoursLabel(total(contractRows))}</strong><HoursInline current={total(contractRows)} currentName={payrollName.trim() || "this report"} showCurrent={false} first={firstPayroll ? { name: firstPayroll.payroll_name, hours: savedHours(firstPayroll, contract) } : null} previous={previousPayroll ? { name: previousPayroll.payroll_name, hours: savedHours(previousPayroll, contract) } : null} /></div><div><span>Employees</span><strong>{people.length}</strong></div><div><span>Time entries</span><strong>{contractRows.length.toLocaleString()}</strong></div></div>
        {people.map((person) => <div className="timecard-person" key={person.name}><h3>{person.name} <span>Total hours = {hoursLabel(total(person.rows))}</span><HoursInline current={total(person.rows)} currentName={payrollName.trim() || "this report"} first={firstPayroll ? { name: firstPayroll.payroll_name, hours: savedHours(firstPayroll, contract, person.employeeId, person.name) } : null} previous={previousPayroll ? { name: previousPayroll.payroll_name, hours: savedHours(previousPayroll, contract, person.employeeId, person.name) } : null} /></h3><TimecardRows rows={person.rows} /></div>)}
        <footer><strong>Contract total: {hoursLabel(total(contractRows))} hours</strong><span>Reviewed by: ____________________ &nbsp; Date: ______________</span></footer>
      </section>;
    })}</div>}
  </div>;
}
