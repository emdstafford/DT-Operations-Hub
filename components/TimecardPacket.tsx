"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Period = "previous" | "current";
type Field = "last" | "first" | "contract" | "inTime" | "outTime" | "hours" | "payCode";
type Columns = Record<Field, number>;
type Source = { name: string; sheets: Record<string, string[][]>; sheet: string; headerRow: number; columns: Columns };
type Range = { start: string; end: string };
type Shift = { contract: string; last: string; first: string; date: string; inTime: string; outTime: string; payCode: string; hundredths: number };
type Result = { rows: Shift[]; invalid: number; outside: number; pto: number };
const fields: Field[] = ["last", "first", "contract", "inTime", "outTime", "hours", "payCode"];
const fieldLabels: Record<Field, string> = { last: "Last Name", first: "First Name", contract: "Worked Department (contract)", inTime: "In time", outTime: "Out time", hours: "Hours", payCode: "Pay Code" };
const aliases: Record<Field, string[]> = {
  last: ["last name", "surname"], first: ["first name", "given name"], contract: ["worked department", "contract", "contract number"],
  inTime: ["in time", "time in", "in punch"], outTime: ["out time", "time out", "out punch"], hours: ["hours", "worked hours"], payCode: ["pay code", "paycode"],
};
const emptyRange = (): Range => ({ start: "", end: "" });
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
function parse(source: Source | null, range: Range): Result {
  const rows: Shift[] = [];
  let invalid = 0, outside = 0, pto = 0;
  if (!source || !validColumns(source)) return { rows, invalid, outside, pto };
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
    if (range.start && date < range.start || range.end && date > range.end) { outside++; continue; }
    rows.push({ contract, last, first, date, inTime: (cells[col.inTime] ?? "").trim(), outTime: (cells[col.outTime] ?? "").trim(), payCode: (cells[col.payCode] ?? "").trim(), hundredths: Math.round(hours * 100) });
  }
  return { rows, invalid, outside, pto };
}
const total = (rows: Shift[]) => rows.reduce((sum, row) => sum + row.hundredths, 0);

function PeriodRows({ title, contract, employee, rows }: { title: string; contract: string; employee: string; rows: Shift[] }) {
  return <section className="timecard-period"><h4>{title} <span>{hoursLabel(total(rows))} hours</span></h4>{rows.length ? <table className="data-table"><thead><tr className="timecard-print-context"><th colSpan={4}>Contract {contract} · {employee} · {title}</th></tr><tr><th>In time</th><th>Out time</th><th>Hours</th><th>Pay Code</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.inTime}-${index}`}><td>{row.inTime}</td><td>{row.outTime || "—"}</td><td>{hoursLabel(row.hundredths)}</td><td>{row.payCode || "—"}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>{title} total</th><th>{hoursLabel(total(rows))}</th><th /></tr></tfoot></table> : <p>No hours for this contract in this period.</p>}</section>;
}

export default function TimecardPacket() {
  const [files, setFiles] = useState<Record<Period, Source | null>>({ previous: null, current: null });
  const [ranges, setRanges] = useState<Record<Period, Range>>({ previous: emptyRange(), current: emptyRange() });
  const [error, setError] = useState("");
  const results = useMemo(() => ({ previous: parse(files.previous, ranges.previous), current: parse(files.current, ranges.current) }), [files, ranges]);
  const ready = (["previous", "current"] as Period[]).every((period) => files[period] && validColumns(files[period]) && ranges[period].start && ranges[period].end && ranges[period].start <= ranges[period].end && results[period].invalid === 0 && results[period].rows.length > 0);
  const contracts = useMemo(() => {
    const groups = new Map<string, Map<string, { previous: Shift[]; current: Shift[] }>>();
    for (const period of ["previous", "current"] as Period[]) for (const row of results[period].rows) {
      if (!groups.has(row.contract)) groups.set(row.contract, new Map());
      const people = groups.get(row.contract)!;
      const person = `${row.last}\u0000${row.first}`;
      if (!people.has(person)) people.set(person, { previous: [], current: [] });
      people.get(person)![period].push(row);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([contract, people]) => ({
      contract,
      people: [...people].sort(([a], [b]) => a.localeCompare(b)).map(([name, periods]) => ({ name: name.replace("\u0000", ", "), previous: periods.previous.sort((a, b) => a.inTime.localeCompare(b.inTime)), current: periods.current.sort((a, b) => a.inTime.localeCompare(b.inTime)) })),
    }));
  }, [results]);
  function updateSource(period: Period, patch: Partial<Source>) { setFiles((state) => ({ ...state, [period]: state[period] ? { ...state[period], ...patch } : null })); }
  async function readFile(period: Period, file?: File) {
    if (!file) return;
    setError("");
    try {
      if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw new Error("Choose an Excel or CSV timecard report.");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const sheets: Record<string, string[][]> = {};
      for (const name of workbook.SheetNames) sheets[name] = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "", raw: false }).map((row) => row.map((value) => String(value ?? "")));
      const sheet = workbook.SheetNames.find((name) => sheets[name].some((row) => row.some((cell) => cell.trim())));
      if (!sheet) throw new Error("The report contains no readable rows.");
      const headerRow = sheets[sheet].slice(0, 20).map((row, index) => ({ index, matched: fields.filter((field) => detect(row, field) >= 0).length })).sort((a, b) => b.matched - a.matched)[0]?.index ?? 0;
      const source: Source = { name: file.name, sheets, sheet, headerRow, columns: detectColumns(sheets[sheet][headerRow]) };
      const all = parse(source, emptyRange()).rows.map((row) => row.date).sort();
      setFiles((state) => ({ ...state, [period]: source }));
      setRanges((state) => ({ ...state, [period]: all.length ? { start: all[0], end: all[all.length - 1] } : emptyRange() }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to read this report."); }
  }
  return <div className="report-stack timecard-stack">
    <section className="panel timecard-intro no-print"><strong>Compare two pay periods</strong><p>Choose the previous and current timecard reports. If a single report covers both periods, choose it in both places and adjust the dates. Files stay in this browser tab and clear when you refresh or close it.</p></section>
    {error && <div className="alert alert-error no-print">{error}</div>}
    {(["previous", "current"] as Period[]).map((period) => {
      const source = files[period];
      const grid = source?.sheets[source.sheet] ?? [];
      const headings = grid[source?.headerRow ?? 0] ?? [];
      return <section className="panel timecard-settings no-print" key={period}>
        <div className="panel-heading"><div><h2>{period === "previous" ? "Previous pay period" : "Current pay period"}</h2><span>{source?.name || "Choose a report"}</span></div><label className="primary-link timecard-file-button">Choose report<input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void readFile(period, event.target.files?.[0])} /></label></div>
        {source && <><div className="timecard-fields">
          <label>Worksheet<select value={source.sheet} onChange={(event) => updateSource(period, { sheet: event.target.value, headerRow: 0, columns: detectColumns(source.sheets[event.target.value][0] ?? []) })}>{Object.keys(source.sheets).map((name) => <option key={name}>{name}</option>)}</select></label>
          <label>Header row<select value={source.headerRow} onChange={(event) => { const headerRow = Number(event.target.value); updateSource(period, { headerRow, columns: detectColumns(grid[headerRow] ?? []) }); }}>{grid.slice(0, 20).map((row, index) => <option key={index} value={index}>Row {index + 1}: {row.filter(Boolean).slice(0, 3).join(" · ").slice(0, 70)}</option>)}</select></label>
          {fields.map((field) => <label key={field}>{fieldLabels[field]}<select value={source.columns[field]} onChange={(event) => updateSource(period, { columns: { ...source.columns, [field]: Number(event.target.value) } })}><option value={-1}>Choose column</option>{headings.map((name, index) => <option key={index} value={index}>{name || `Column ${index + 1}`}</option>)}</select></label>)}
          <label>Period from<input type="date" value={ranges[period].start} onChange={(event) => setRanges((state) => ({ ...state, [period]: { ...state[period], start: event.target.value } }))} /></label>
          <label>Period through<input type="date" value={ranges[period].end} onChange={(event) => setRanges((state) => ({ ...state, [period]: { ...state[period], end: event.target.value } }))} /></label>
        </div><div className="timecard-status"><span>{results[period].rows.length.toLocaleString()} rows · {hoursLabel(total(results[period].rows))} hours</span><span>{results[period].pto} PTO rows excluded</span>{results[period].outside > 0 && <span>{results[period].outside} rows outside selected dates</span>}{results[period].invalid > 0 && <strong>{results[period].invalid} rows need a readable name, contract, In time, or Hours. Check column choices before printing.</strong>}</div></>}
      </section>;
    })}
    <section className="panel timecard-actions no-print"><button className="primary-link" disabled={!ready} onClick={() => window.print()}>Print by contract</button><span>{ready ? `${contracts.length} contract packets. Each starts on a new page.` : "Choose both reports and confirm their columns and dates. Rows must be readable before printing."}</span></section>
    {ready && <div className="timecard-packet"><div className="timecard-screen-heading no-print"><h2>Packet preview</h2><p>Check the hours and contract assignments before giving the packet to Gary.</p></div>{contracts.map(({ contract, people }) => {
      const previous = people.flatMap((person) => person.previous);
      const current = people.flatMap((person) => person.current);
      return <section className="timecard-contract" key={contract}><header><div><p>Davenport Transportation · Timecard review</p><h2>Contract {contract}</h2><span>Previous: {dateLabel(ranges.previous.start)} – {dateLabel(ranges.previous.end)} · Current: {dateLabel(ranges.current.start)} – {dateLabel(ranges.current.end)}</span></div><strong>{people.length} employees</strong></header>
        <div className="timecard-contract-totals"><div><span>Current hours</span><strong>{hoursLabel(total(current))}</strong></div><div><span>Previous hours</span><strong>{hoursLabel(total(previous))}</strong></div><div><span>Change</span><strong>{hoursLabel(total(current) - total(previous))}</strong></div></div>
        {people.map((person) => <div className="timecard-person" key={person.name}><h3>{person.name} <span>Current {hoursLabel(total(person.current))} · Previous {hoursLabel(total(person.previous))} hours</span></h3><PeriodRows title="Current period" contract={contract} employee={person.name} rows={person.current} /><PeriodRows title="Previous period" contract={contract} employee={person.name} rows={person.previous} /></div>)}
        <footer>Reviewed by: ____________________ &nbsp; Date: ______________</footer>
      </section>;
    })}</div>}
  </div>;
}
