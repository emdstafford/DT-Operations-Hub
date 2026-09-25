import * as XLSX from "xlsx";

export type FuelCategory = "diesel" | "gasoline" | "def" | "fee" | "adjustment" | "other";

export type FuelTransactionInput = {
  unique_key: string;
  transaction_group_key: string;
  account_code: string;
  customer_id: string;
  invoice_number: string;
  transaction_number: string;
  transaction_date: string;
  transaction_time: string;
  posted_date: string | null;
  person_name: string;
  contract_number: string;
  merchant_name: string;
  merchant_city: string;
  merchant_state: string;
  merchant_postal_code: string;
  vehicle_number: string;
  employee_number: string;
  product_description: string;
  product_category: FuelCategory;
  unit_gallons: number;
  price_per_unit: number;
  gross_cost: number;
  discount: number;
  net_cost: number;
  odometer: number | null;
  miles_driven: number | null;
};

export type ProcessedFuelReport = {
  fileName: string;
  fileHash: string;
  periodStart: string;
  periodEnd: string;
  sourceRows: number;
  duplicateRowsRemoved: number;
  transactionCount: number;
  totalFuelGallons: number;
  totalNetCost: number;
  gasolineRows: number;
  suspectContractRows: number;
  rows: FuelTransactionInput[];
};

type SourceRow = Record<string, unknown>;

const text = (value: unknown) => String(value ?? "").trim();
const numberValue = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

function isoDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  const raw = text(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function timeValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(11, 19);
  if (typeof value === "number") {
    const fraction = value - Math.floor(value);
    const seconds = Math.round(fraction * 86400) % 86400;
    return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return text(value);
}

export function categorizeFuelProduct(value: unknown): FuelCategory {
  const product = text(value).toUpperCase();
  if (/TRANSACTION FEE/.test(product)) return "fee";
  if (/ADJUSTMENT|DISCOUNT/.test(product)) return "adjustment";
  if (/EXHAUST FLUID|\bDEF\b/.test(product)) return "def";
  if (/DIESEL|\bD1\b|\bD2\b|ULSD/.test(product)) return "diesel";
  if (/UNL|GAS|E85|LEADED|OCTANE/.test(product)) return "gasoline";
  return "other";
}

function personName(row: SourceRow) {
  const assigned = text(row["Misc 1"]);
  if (assigned) return assigned;
  const pos = `${text(row["POS First Name"])} ${text(row["POS Last Name"])}`.trim();
  return pos || "Unassigned";
}

function canonical(parts: unknown[]) {
  return parts.map((part) => text(part).toUpperCase().replace(/\s+/g, " ")).join("¦");
}

async function sha256(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function processFuelReport(file: File): Promise<ProcessedFuelReport> {
  const buffer = await file.arrayBuffer();
  // Keep Excel dates as serial numbers. Some Comdata exports carry a timezone-
  // shifted style that makes SheetJS Date objects land on the prior calendar day.
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false, cellStyles: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("The Comdata workbook does not contain a readable worksheet.");
  const source = XLSX.utils.sheet_to_json<SourceRow>(sheet, { defval: "", raw: true });
  const required = ["Transaction Number", "Transaction Date", "Merchant Name", "Misc 1", "Misc 2", "Product Description", "Net Cost"];
  const headers = new Set(Object.keys(source[0] ?? {}));
  const missing = required.filter((header) => !headers.has(header));
  if (missing.length) throw new Error(`This does not match the Comdata Transaction Listing. Missing: ${missing.join(", ")}.`);

  const uniqueRows = new Set<string>();
  const transactionGroups = new Set<string>();
  const rows: FuelTransactionInput[] = [];
  let duplicateRowsRemoved = 0;
  let suspectContractRows = 0;

  for (const row of source) {
    const transactionDate = isoDate(row["Transaction Date"]);
    const transactionNumber = text(row["Transaction Number"]);
    const productDescription = text(row["Product Description"]) || "Unknown";
    if (!transactionDate || (!transactionNumber && productDescription === "Unknown")) continue;
    const accountCode = text(row["Account Code"]);
    const customerId = text(row["Customer ID"]);
    const groupKey = canonical([accountCode, customerId, transactionDate, transactionNumber, row["Vehicle Number"], row["Employee Number"]]);
    const uniqueKey = canonical([
      groupKey, row["Invoice Number"], productDescription, row["Unit/Gallons"], row["PPU/PPG"], row["Net Cost"], row["Merchant Name"], row["Odometer"],
    ]);
    if (uniqueRows.has(uniqueKey)) {
      duplicateRowsRemoved += 1;
      continue;
    }
    uniqueRows.add(uniqueKey);
    transactionGroups.add(groupKey);
    if (!/^[0-9][A-Z0-9]{4,5}$/.test(text(row["Misc 2"]).toUpperCase())) suspectContractRows++;
    const odometer = text(row["Odometer"]) ? numberValue(row["Odometer"]) : null;
    const milesDriven = text(row["Miles Driven"]) ? numberValue(row["Miles Driven"]) : null;
    rows.push({
      unique_key: uniqueKey,
      transaction_group_key: groupKey,
      account_code: accountCode,
      customer_id: customerId,
      invoice_number: text(row["Invoice Number"]),
      transaction_number: transactionNumber,
      transaction_date: transactionDate,
      transaction_time: timeValue(row["Transaction Time"]),
      posted_date: isoDate(row["Posted Date"]) || null,
      person_name: personName(row),
      contract_number: text(row["Misc 2"]) || "Unassigned",
      merchant_name: text(row["Merchant Name"]) || "Unknown station",
      merchant_city: text(row["Merchant City"]),
      merchant_state: text(row["Merchant State"]),
      merchant_postal_code: text(row["MRCH POSTAL CD"]),
      vehicle_number: text(row["Vehicle Number"]),
      employee_number: text(row["Employee Number"]),
      product_description: productDescription,
      product_category: categorizeFuelProduct(productDescription),
      unit_gallons: numberValue(row["Unit/Gallons"]),
      price_per_unit: numberValue(row["PPU/PPG"]),
      gross_cost: numberValue(row["Gross Cost"]),
      discount: numberValue(row["Discount"]),
      net_cost: numberValue(row["Net Cost"]),
      odometer,
      miles_driven: milesDriven,
    });
  }

  if (!rows.length) throw new Error("No Comdata transaction rows were found.");
  const dates = rows.map((row) => row.transaction_date).sort();
  return {
    fileName: file.name,
    fileHash: await sha256(buffer),
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    sourceRows: source.length,
    duplicateRowsRemoved,
    transactionCount: transactionGroups.size,
    totalFuelGallons: rows.filter((row) => row.product_category === "diesel" || row.product_category === "gasoline").reduce((sum, row) => sum + row.unit_gallons, 0),
    totalNetCost: rows.reduce((sum, row) => sum + row.net_cost, 0),
    gasolineRows: rows.filter((row) => row.product_category === "gasoline").length,
    suspectContractRows,
    rows,
  };
}
