"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import TimecardComparisons, { type TimecardSummaryEntry } from "@/components/TimecardComparisons";
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
  const historyEntries = useMemo<TimecardSummaryEntry[]>(() => contracts.flatMap(({ contract, people }) => people.map((person) => ({
    contract, employeeId: person.employeeId, name: person.name, hundredths: total(person.rows),
  })).filter((entry) => entry.hundredths > 0)), [contracts]);
  const unassigned = supervisorStatus === "ready" ? contracts.filter(({ contract, people }) => !supervisorsFor(contract, people.flatMap((person) => person.rows)).length).length : 0;
  return <div className="report-stack timecard-stack">
    <section className="panel timecard-intro no-print"><strong>One report, grouped by contract</strong><p>Choose the timecard report for this pay period. The file stays in this browser tab and clears when you refresh or close it. The printed packet can be compared with notes from the previous pay period.</p></section>
    {error && <div className="alert alert-error no-print">{error}</div>}
    <section className="panel timecard-settings no-print">
      <div className="panel-heading"><div><h2>Timecard report</h2><span>{file?.name || "Choose a report"}</span></div><label className="primary-link timecard-file-button">Choose report<input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void readFile(event.target.files?.[0])} /></label></div>
      <div className="timecard-payroll-fields"><label>Payroll name or number<input type="text" value={payrollName} maxLength={100} placeholder="Example: #39" onChange={(event) => { setPayrollName(event.target.value); setConfirmedPayrollName(""); }} onBlur={() => setConfirmedPayrollName(payrollName.trim())} /></label><span>Use the same number when uploading corrected timecards. The report dates are read from the file.</span></div>
      {file && <div className="timecard-status"><span>{result.rows.length.toLocaleString()} rows · {hoursLabel(total(result.rows))} hours</span><span>{result.pto} PTO rows excluded</span>{file.employeeIdColumn < 0 && <strong>No employee ID column found. Comparisons will match drivers by name.</strong>}{result.invalid > 0 && <strong>{result.invalid} rows need a readable name, contract, In time, or Hours. Correct the file before printing.</strong>}{supervisorStatus === "error" && <strong>Supervisor assignments could not be loaded; contract headings will show “Supervisor unavailable.”</strong>}{unassigned > 0 && <strong>{unassigned} contract{unassigned === 1 ? " has" : "s have"} no supervisor assignment for these dates.</strong>}</div>}
    </section>
    <section className="panel timecard-actions no-print"><button className="primary-link" disabled={!ready || supervisorStatus === "loading"} onClick={() => window.print()}>Print by contract</button><span>{ready ? `${contracts.length} contracts. Each starts on a new page.` : "Choose one report. All rows must be readable before printing."}</span></section>
    {ready && confirmedPayrollName ? <TimecardComparisons entries={historyEntries} start={periodStart} end={periodEnd} sourceName={file?.name || "Timecard report"} payrollName={confirmedPayrollName} /> : ready && <section className="panel no-print timecard-comparisons"><h2>Save and compare payrolls</h2><p>Enter the payroll name or number above, such as #39, to save the hour totals. Reuse it for a corrected report. You can print the timecards now.</p></section>}
    {ready && <div className="timecard-packet"><div className="timecard-screen-heading no-print"><h2>Packet preview</h2><p>Check the hours and contract assignments before printing the packet.</p></div>{contracts.map(({ contract, people }) => {
      const contractRows = people.flatMap((person) => person.rows);
      const supervisors = supervisorsFor(contract, contractRows);
      return <section className="timecard-contract" key={contract}><header><div><p>Davenport Transportation · Timecard review</p><h2>Contract {contract}</h2><span>Supervisor{supervisors.length === 1 ? "" : "s"}: {supervisors.length ? supervisors.join(", ") : supervisorStatus === "loading" ? "Loading…" : supervisorStatus === "error" ? "Unavailable" : "Not assigned for this period"}</span><br /><span>{payrollName.trim() ? `${payrollName.trim()} · ` : ""}{dateLabel(periodStart)} – {dateLabel(periodEnd)}</span></div><strong>{people.length} employees</strong></header>
        <div className="timecard-contract-totals"><div><span>Contract hours</span><strong>{hoursLabel(total(contractRows))}</strong></div><div><span>Employees</span><strong>{people.length}</strong></div><div><span>Time entries</span><strong>{contractRows.length.toLocaleString()}</strong></div></div>
        {people.map((person) => <div className="timecard-person" key={person.name}><h3>{person.name} <span>Total hours = {hoursLabel(total(person.rows))}</span></h3><TimecardRows rows={person.rows} /></div>)}
        <footer><strong>Contract total: {hoursLabel(total(contractRows))} hours</strong><span>Reviewed by: ____________________ &nbsp; Date: ______________</span></footer>
      </section>;
    })}</div>}
  </div>;
}
