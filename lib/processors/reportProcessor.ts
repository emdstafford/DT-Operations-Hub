import * as XLSX from "xlsx";
import { getContracts } from "../getContracts";
import { isTonyaTrip } from "../tonyaTrips";

export type Totals = {
  totalStops: number;
  completedStops: number;
  incompleteStops: number;
  percentComplete: number;
};

export type ProcessedLoad = {
  loadNumber: string;
  operatingDate: string;
  contract: string;
  trip: string | null;
  totalStops: number;
  completedStops: number;
  incompleteStops: number;
  supervisors: string[];
  tags: string;
};

export type SummaryRow = Totals & {
  key: string;
  label: string;
  loadCount: number;
};

export type ProcessedReport = {
  fileName: string;
  periodStart: string;
  periodEnd: string;
  reportLoads: ProcessedLoad[];
  historicalLoads: ProcessedLoad[];
  totals: Totals;
  daily: SummaryRow[];
  contracts: SummaryRow[];
  supervisors: SummaryRow[];
  duplicateLoadNumbers: string[];
  outsidePeriodCount: number;
  unmatchedContractCount: number;
  unmatchedSupervisorCount: number;
};

type ContractAssignment = {
  contract_number: string | null;
  supervisor?: string | null;
};

function toIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseReportDate(value: string) {
  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const match = value.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})$/);
  if (!match) return "";
  const yearNumber = Number(match[3]);
  const year = yearNumber < 100 ? 2000 + yearNumber : yearNumber;
  return toIsoDate(year, months[match[2].toLowerCase()], Number(match[1]));
}

function getReportPeriod(fileName: string, workbook: XLSX.WorkBook) {
  const fileDates = fileName.match(/(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/);
  if (fileDates) {
    return { periodStart: fileDates[1], periodEnd: fileDates[2] };
  }
  const summary = workbook.Sheets.Summary;
  if (!summary) return { periodStart: "", periodEnd: "" };
  const rows = XLSX.utils.sheet_to_json<unknown[]>(summary, { header: 1, defval: "" });
  const text = rows.flat().map(String).find((value) => value.includes("Analysis from")) ?? "";
  const match = text.match(/Analysis from\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})\s+-\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})/i);
  return {
    periodStart: match ? parseReportDate(match[1]) : "",
    periodEnd: match ? parseReportDate(match[2]) : "",
  };
}

function getOperatingDate(tags: string) {
  return tags.match(/(?:^|,)(\d{4}-\d{2}-\d{2})(?:,|$)/)?.[1] ?? "";
}

function normalizeTrip(value: string) {
  const extra = value.match(/FEV[\s#-]*(\d+)/i);
  if (extra) return `FEV${Number(extra[1])}`;
  return /^\d+$/.test(value.trim()) ? String(Number(value)) : value.trim().toUpperCase();
}

export function getTripInfo(tags: string) {
  const scheduled = tags.match(/LDT-([A-Z0-9]+)-((?:FEV[\s#-]*\d+)|\d+)/i)
    ?? tags.match(/(?:^|,)\s*([A-Z0-9]+)-((?:FEV[\s#-]*\d+)|\d+)(?=,|$)/i);
  if (scheduled) return { contract: scheduled[1].toUpperCase(), trip: normalizeTrip(scheduled[2]) };
  const extra = tags.match(/(?:^|[,\s])FEV[\s#-]*(\d+)(?=,|\s|$)/i);
  return { contract: "", trip: extra ? `FEV${Number(extra[1])}` : null };
}

function findContract(tags: string, assignments: ContractAssignment[]) {
  const tripInfo = getTripInfo(tags);
  if (tripInfo.contract) return tripInfo;
  const tagSet = new Set(tags.toUpperCase().split(",").map((tag) => tag.trim()));
  const assignment = assignments.find((row) => {
    const contract = String(row.contract_number ?? "").trim().toUpperCase();
    return contract && tagSet.has(contract);
  });
  return {
    contract: String(assignment?.contract_number ?? "").trim().toUpperCase(),
    trip: tripInfo.trip,
  };
}

function createTotals(rows: ProcessedLoad[]): Totals {
  const totals = rows.reduce(
    (sum, row) => ({
      totalStops: sum.totalStops + row.totalStops,
      completedStops: sum.completedStops + row.completedStops,
      incompleteStops: sum.incompleteStops + row.incompleteStops,
    }),
    { totalStops: 0, completedStops: 0, incompleteStops: 0 },
  );
  return {
    ...totals,
    percentComplete: totals.totalStops > 0
      ? totals.completedStops / totals.totalStops
      : 0,
  };
}

function summarize(
  rows: ProcessedLoad[],
  keyFor: (row: ProcessedLoad) => string,
  labelFor: (key: string) => string = (key) => key,
) {
  const groups = new Map<string, ProcessedLoad[]>();
  rows.forEach((row) => {
    const key = keyFor(row);
    if (!key) return;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });
  return Array.from(groups.entries()).map(([key, group]): SummaryRow => ({
    key,
    label: labelFor(key),
    loadCount: group.length,
    ...createTotals(group),
  }));
}

function supervisorNames(value: string | null | undefined) {
  return String(value ?? "")
    .split("/")
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => name !== "Candi Tanner");
}

function resolveSupervisors(row: Pick<ProcessedLoad, "contract" | "trip">, assignments: ContractAssignment[]) {
  if (isTonyaTrip(row.contract, row.trip)) return ["Tonya Capps-Owen"];
  const assignment = assignments.find(
    (item) => String(item.contract_number ?? "").trim().toUpperCase() === row.contract,
  );
  return supervisorNames(assignment?.supervisor)
    .filter((name) => name !== "Tonya Capps-Owen" && name !== "Tonya Owens");
}

function buildSupervisorSummary(rows: ProcessedLoad[], assignments: ContractAssignment[]) {
  const assignedRows: Array<ProcessedLoad & { supervisor: string }> = [];
  rows.forEach((row) => {
    const resolved = row.supervisors;
    (resolved.length ? resolved : ["Unassigned"]).forEach((supervisor) => {
      assignedRows.push({ ...row, supervisor });
    });
  });
  return summarize(
    assignedRows,
    (row) => (row as ProcessedLoad & { supervisor: string }).supervisor,
  );
}

export async function processReport(file: File): Promise<ProcessedReport> {
  const workbook = XLSX.read(await file.arrayBuffer());
  const loadDetails = workbook.Sheets["Load Details"];
  if (!loadDetails) throw new Error('This workbook does not contain a "Load Details" sheet.');

  let assignments: ContractAssignment[] = [];
  try {
    assignments = await getContracts();
  } catch {
    assignments = [];
  }

  const { periodStart, periodEnd } = getReportPeriod(file.name, workbook);
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(loadDetails, {
    range: 4,
    defval: "",
  });
  const seen = new Set<string>();
  const duplicateLoadNumbers: string[] = [];
  const historicalLoads: ProcessedLoad[] = [];

  rawRows.forEach((row) => {
    const loadNumber = String(row["Load Number"] ?? "").trim();
    if (!loadNumber) return;
    if (seen.has(loadNumber)) {
      duplicateLoadNumbers.push(loadNumber);
      return;
    }
    seen.add(loadNumber);
    const tags = String(row.Tags ?? "");
    const { contract, trip } = findContract(tags, assignments);
    const baseLoad = {
      loadNumber,
      operatingDate: getOperatingDate(tags),
      contract,
      trip,
      totalStops: Number(row["Stops Count"] || 0),
      completedStops: Number(row["Stops With Timestamp"] || 0),
      incompleteStops: Number(row["Incomplete Stops"] || 0),
      tags,
    };
    historicalLoads.push({ ...baseLoad, supervisors: resolveSupervisors(baseLoad, assignments) });
  });

  const reportLoads = historicalLoads.filter((row) =>
    (!periodStart || row.operatingDate >= periodStart) &&
    (!periodEnd || row.operatingDate <= periodEnd),
  );
  const dayNames = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
  const daily = summarize(
    reportLoads,
    (row) => row.operatingDate,
    (date) => `${dayNames.format(new Date(`${date}T12:00:00Z`))}, ${date}`,
  ).sort((a, b) => a.key.localeCompare(b.key));
  const contracts = summarize(reportLoads, (row) => row.contract)
    .sort((a, b) => a.percentComplete - b.percentComplete);
  const supervisors = buildSupervisorSummary(reportLoads, assignments)
    .sort((a, b) => b.percentComplete - a.percentComplete);

  return {
    fileName: file.name,
    periodStart,
    periodEnd,
    reportLoads,
    historicalLoads,
    totals: createTotals(reportLoads),
    daily,
    contracts,
    supervisors,
    duplicateLoadNumbers: Array.from(new Set(duplicateLoadNumbers)),
    outsidePeriodCount: historicalLoads.length - reportLoads.length,
    unmatchedContractCount: historicalLoads.filter((row) => !row.contract).length,
    unmatchedSupervisorCount: supervisors.find((row) => row.key === "Unassigned")?.loadCount ?? 0,
  };
}
