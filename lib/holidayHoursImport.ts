export type HolidayHoursImportRow = {
  companyCode: string;
  fileNumber: string;
  totalHours: number;
  holidayHours: number;
  sourceRows: number;
};

export type HolidayHoursImportResult = {
  rows: HolidayHoursImportRow[];
  sourceRowCount: number;
  totalSourceHours: number;
  totalHolidayHours: number;
  cappedEmployeeCount: number;
};

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function parseHoursHundredths(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function csvValue(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export async function holidaySourceFingerprint(contents: string) {
  const normalized = contents.replace(/^\uFEFF/, "");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createHolidayHoursImport(sourceCsv: string, holidayCount: 1 | 2 = 1): HolidayHoursImportResult {
  const data = parseCsv(sourceCsv.replace(/^\uFEFF/, ""));
  if (!data.length) throw new Error("The selected CSV is empty.");

  const headers = data[0].map((header) => header.trim());
  const headerIndex = new Map(headers.map((header, index) => [header.toLowerCase(), index]));
  const companyIndex = headerIndex.get("company code");
  const fileIndex = headerIndex.get("file number");
  const hoursIndex = headerIndex.get("hours");

  if (companyIndex === undefined || fileIndex === undefined || hoursIndex === undefined) {
    throw new Error("This file must contain Company Code, File Number, and Hours columns.");
  }

  const totals = new Map<string, {
    companyCode: string;
    fileNumber: string;
    hoursHundredths: number;
    sourceRows: number;
  }>();
  let sourceRowCount = 0;
  let totalSourceHundredths = 0;

  data.slice(1).forEach((sourceRow, rowOffset) => {
    if (!sourceRow.some((value) => value.trim())) return;
    const rowNumber = rowOffset + 2;
    const companyCode = sourceRow[companyIndex]?.trim();
    const fileNumber = sourceRow[fileIndex]?.trim();
    const hoursValue = sourceRow[hoursIndex]?.trim();
    if (!companyCode || !fileNumber) {
      throw new Error(`Row ${rowNumber} is missing Company Code or File Number.`);
    }
    const hoursHundredths = parseHoursHundredths(hoursValue);
    if (hoursHundredths === null) {
      throw new Error(`Row ${rowNumber} has an invalid Hours value: ${hoursValue || "blank"}.`);
    }

    sourceRowCount += 1;
    totalSourceHundredths += hoursHundredths;
    const key = `${companyCode}\u0000${fileNumber}`;
    const current = totals.get(key) ?? { companyCode, fileNumber, hoursHundredths: 0, sourceRows: 0 };
    current.hoursHundredths += hoursHundredths;
    current.sourceRows += 1;
    totals.set(key, current);
  });

  const rows = [...totals.values()]
    .sort((left, right) => left.companyCode.localeCompare(right.companyCode)
      || left.fileNumber.localeCompare(right.fileNumber, undefined, { numeric: true }))
    .map((employee) => {
      // Formula: total hours / 2 / 40 * 8, equivalent to total hours / 10.
      // Integer arithmetic gives payroll-style half-up rounding at two decimals.
      const singleHolidayHundredths = Math.min(800, Math.floor((employee.hoursHundredths + 5) / 10));
      const holidayHundredths = singleHolidayHundredths * holidayCount;
      return {
        companyCode: employee.companyCode,
        fileNumber: employee.fileNumber,
        totalHours: employee.hoursHundredths / 100,
        holidayHours: holidayHundredths / 100,
        sourceRows: employee.sourceRows,
      };
    });

  return {
    rows,
    sourceRowCount,
    totalSourceHours: totalSourceHundredths / 100,
    totalHolidayHours: rows.reduce((total, employee) => total + employee.holidayHours, 0),
    cappedEmployeeCount: rows.filter((employee) => employee.holidayHours === 8 * holidayCount).length,
  };
}

export function holidayHoursImportCsv(rows: HolidayHoursImportRow[]) {
  const output = [
    ["Co Code", "Batch ID", "File #", "Hours 3 Code", "Hours 3 Amount"],
    ...rows.map((row) => ["HNE", "Holiday", row.fileNumber, "HOL", row.holidayHours.toFixed(2)]),
  ];
  return `${output.map((row) => row.map(csvValue).join(",")).join("\r\n")}\r\n`;
}
