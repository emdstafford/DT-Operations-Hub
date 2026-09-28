import * as XLSX from "xlsx";

export type WorkbookContractSummary = {
  sheet: string;
  contract: string;
  annualMiles: number | null;
  annualHours: number | null;
  scheduledPayment: number | null;
  activeTrips: number;
  excludedTrips: number;
  earliestExpiration: string;
  termStart: string;
  termMiles: number | null;
  termDays: number | null;
  issue: string;
  tripRows: WorkbookTrip[];
};
export type WorkbookTrip = {
  trip_number: string;
  effective_start: string;
  expiration_date: string;
  frequency_code: string;
  frequency_description: string;
  equipment_type: string;
  annual_trip_count: number;
  per_trip_miles: number;
  per_trip_hours: number;
  annual_miles: number;
  annual_hours: number;
  unit_cost: number;
  scheduled_trip_payment: number;
};

const required = ["Effective Date*", "Expiration Date", "HCR*", "Trip*", "Unit Cost*", "Annual Trip Cost (Calculated)", "Annual Trip Count*", "Per Trip Miles*", "Annual Miles (Calculated)", "Annual Hours (Calculated)"];
const label = (value: unknown) => String(value ?? "").trim();
const value = (raw: unknown) => raw === "" || raw == null ? NaN : Number(String(raw).replaceAll(",", ""));
const date = (raw: unknown) => {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 20000 && raw < 100000
    ? new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000).toISOString().slice(0, 10) : "";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const result = label(raw).slice(0, 10);
  return /^20\d{2}-\d{2}-\d{2}$/.test(result) ? result : "";
};
const round = (n: number, places: number) => Number(n.toFixed(places));

export async function parseUspsContractWorkbook(file: File, asOf: string): Promise<WorkbookContractSummary[]> {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(asOf)) throw new Error("Choose the date these contract totals should represent.");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const summaries: WorkbookContractSummary[] = [];
  for (const sheet of workbook.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, defval: "", raw: true, blankrows: true });
    const headerRow = grid.slice(0, 10).findIndex((cells) => required.every((name) => cells.some((cell) => label(cell) === name)));
    if (headerRow < 0) continue;
    const columns = new Map(grid[headerRow].map((cell, index) => [label(cell), index]));
    const field = (row: unknown[], name: string) => row[columns.get(name) ?? -1];
    const validRows = grid.slice(headerRow + 1).filter((row) =>
      /^[0-9A-Z]{5,6}$/i.test(label(field(row, "HCR*"))) && label(field(row, "Trip*")) !== "");
    const contracts = [...new Set(validRows.map((row) => label(field(row, "HCR*")).toUpperCase()))];
    const contract = contracts.length === 1 ? contracts[0] : "";
    const active = validRows.filter((row) => date(field(row, "Effective Date*")) <= asOf && date(field(row, "Expiration Date")) >= asOf);
    const tripIds = active.map((row) => label(field(row, "Trip*")));
    const hasDuplicateTrips = new Set(tripIds).size !== tripIds.length;
    let badNumbers = false;
    let badMath = false;
    let miles = 0, hours = 0, payment = 0;
    const tripRows: WorkbookTrip[] = [];
    for (const row of active) {
      const tripCount = value(field(row, "Annual Trip Count*"));
      const perTripMiles = value(field(row, "Per Trip Miles*"));
      const unitCost = value(field(row, "Unit Cost*"));
      const perTripHours = value(field(row, "Per Trip Hours*"));
      const annualMiles = value(field(row, "Annual Miles (Calculated)"));
      const annualHours = value(field(row, "Annual Hours (Calculated)"));
      const annualCost = value(field(row, "Annual Trip Cost (Calculated)"));
      if (![tripCount, perTripMiles, perTripHours, unitCost, annualMiles, annualHours, annualCost].every(Number.isFinite) ||
          [tripCount, perTripMiles, perTripHours, unitCost, annualMiles, annualHours, annualCost].some((n) => n < 0)) { badNumbers = true; continue; }
      if (Math.abs(tripCount * perTripMiles - annualMiles) > 0.11 || Math.abs(tripCount * perTripHours - annualHours) > 0.11 || Math.abs(tripCount * unitCost - annualCost) > 0.11) badMath = true;
      miles += annualMiles; hours += annualHours; payment += annualCost;
      tripRows.push({ trip_number: label(field(row, "Trip*")), effective_start: date(field(row, "Effective Date*")),
        expiration_date: date(field(row, "Expiration Date")), frequency_code: label(field(row, "Frequency Code")),
        frequency_description: label(field(row, "Frequency Description")), equipment_type: label(field(row, "Equipment Type*")),
        annual_trip_count: tripCount, per_trip_miles: perTripMiles, per_trip_hours: perTripHours,
        annual_miles: annualMiles, annual_hours: annualHours, unit_cost: unitCost,
        scheduled_trip_payment: annualCost });
    }
    const earliestExpiration = active.map((row) => date(field(row, "Expiration Date"))).sort()[0] || "";
    const termStart = active.map((row) => date(field(row, "Effective Date*"))).sort()[0] || "";
    // Short term rows can label a 45-day total "Annual Miles". That is not an
    // annual mileage plan; it needs its own time basis before fuel comparison.
    const termDays = termStart && earliestExpiration
      ? Math.round((Date.parse(`${earliestExpiration}T12:00:00Z`) - Date.parse(`${termStart}T12:00:00Z`)) / 86400000) + 1 : null;
    const shortTerm = active.length > 0 && termDays != null && termDays > 0 && termDays <= 60 &&
      active.every((row) => value(field(row, "Annual Trip Count*")) === termDays) &&
      active.every((row) => date(field(row, "Effective Date*")) === termStart && date(field(row, "Expiration Date")) === earliestExpiration);
    const unsupportedShortTerm = active.length > 0 && active.every((row) => value(field(row, "Annual Trip Count*")) <= 60) && !shortTerm;
    const issue = contracts.length !== 1 ? "Multiple or missing HCR numbers in this sheet" :
      !active.length ? `No trips active on ${asOf}` : hasDuplicateTrips ? "Duplicate trip numbers in the active rows" :
      badNumbers ? "A trip has a missing or invalid number" : badMath ? "Calculated trip miles or payment do not match the source inputs" :
      unsupportedShortTerm ? "Short-term trip counts have different dates or counts; review the contract period manually" : "";
    const yearDays = new Date(`${asOf}T12:00:00Z`).getUTCFullYear() % 4 === 0 ? 366 : 365;
    summaries.push({ sheet, contract, annualMiles: issue ? null : round(shortTerm ? miles * yearDays / termDays! : miles, 1), annualHours: issue ? null : round(hours, 2),
      scheduledPayment: issue ? null : round(payment, 2), activeTrips: active.length,
      excludedTrips: validRows.length - active.length, earliestExpiration, termStart,
      termMiles: shortTerm ? round(miles, 1) : null, termDays: shortTerm ? termDays : null,
      tripRows: issue ? [] : tripRows, issue });
  }
  if (!summaries.length) throw new Error("No USPS contract trip tables were found. Check the worksheet headers.");
  return summaries;
}
