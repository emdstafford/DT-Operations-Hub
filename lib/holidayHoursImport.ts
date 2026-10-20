export type HolidayHoursImportRow = {
  companyCode: string;
  fileNumber: string;
  employeeName: string;
  payClass: string;
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
  excludedEmployeeCount: number;
  holidayTotals: number[];
  holidayEmployeeCounts: number[];
  holidayAtEightEmployeeCounts: number[];
  fullTimeExcludedEmployeeCount: number;
};

function normalizePayClass(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isExcludedPayClass(payClass: string) {
  const normalized = normalizePayClass(payClass);
  return normalized === "salary" || normalized === "salarymanager" || normalized === "managersalary";
}

function hasFixedEightHourHoliday(payClass: string) {
  const normalized = normalizePayClass(payClass);
  return normalized === "mechanicft" || normalized === "mechanicsft" || normalized === "officeft" || normalized === "officestaffft";
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

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

export function createHolidayHoursImport(
  sourceCsv: string,
  holidayCount: 1 | 2 = 1,
  excludeFullTimeForHoliday: boolean[] = [],
): HolidayHoursImportResult {
  const data = parseCsv(sourceCsv.replace(/^\uFEFF/, ""));
  if (!data.length) throw new Error("The selected CSV is empty.");

  const headers = data[0].map(normalizeHeader);
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const companyIndex = headerIndex.get("companycode");
  const fileIndex = headerIndex.get("filenumber");
  const hoursIndex = headerIndex.get("hours");
  const payClassIndex = headerIndex.get("payclass");
  const employeeNameIndex = ["employeename", "employeefullname", "employeedisplayname", "fullname", "name"]
    .map((header) => headerIndex.get(header)).find((index) => index !== undefined);
  const firstNameIndex = headerIndex.get("employeefirstname") ?? headerIndex.get("firstname");
  const lastNameIndex = headerIndex.get("employeelastname") ?? headerIndex.get("lastname");
  const hasNameFields = employeeNameIndex !== undefined || (firstNameIndex !== undefined && lastNameIndex !== undefined);

  if (companyIndex === undefined || fileIndex === undefined || hoursIndex === undefined || payClassIndex === undefined || !hasNameFields) {
    throw new Error("This file must contain Company Code, File Number, Hours, Pay Class, and Employee Name columns (or First Name and Last Name columns).");
  }

  const totals = new Map<string, {
    companyCode: string;
    fileNumber: string;
    employeeName: string;
    payClass: string;
    normalizedPayClass: string;
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
    const payClassValue = sourceRow[payClassIndex]?.trim() ?? "";
    const employeeName = employeeNameIndex !== undefined
      ? sourceRow[employeeNameIndex]?.trim() ?? ""
      : `${sourceRow[firstNameIndex!]?.trim() ?? ""} ${sourceRow[lastNameIndex!]?.trim() ?? ""}`.trim();
    if (!companyCode || !fileNumber) {
      throw new Error(`Row ${rowNumber} is missing Company Code or File Number.`);
    }
    if (!employeeName) {
      throw new Error(`Row ${rowNumber} is missing the employee name.`);
    }
    const normalizedPayClass = normalizePayClass(payClassValue);
    if (!normalizedPayClass) {
      throw new Error(`Row ${rowNumber} is missing Pay Class.`);
    }
    const hoursHundredths = parseHoursHundredths(hoursValue);
    if (hoursHundredths === null) {
      throw new Error(`Row ${rowNumber} has an invalid Hours value: ${hoursValue || "blank"}.`);
    }

    sourceRowCount += 1;
    totalSourceHundredths += hoursHundredths;
    const key = `${companyCode}\u0000${fileNumber}`;
    const current = totals.get(key);
    if (current && current.normalizedPayClass !== normalizedPayClass) {
      throw new Error(`Employee ${fileNumber} has more than one Pay Class in the source file.`);
    }
    const employee = current ?? { companyCode, fileNumber, employeeName, payClass: payClassValue, normalizedPayClass, hoursHundredths: 0, sourceRows: 0 };
    employee.hoursHundredths += hoursHundredths;
    employee.sourceRows += 1;
    totals.set(key, employee);
  });

  const allEmployees = [...totals.values()];
  const excludedEmployeeCount = allEmployees.filter((employee) => isExcludedPayClass(employee.payClass)).length;
  const includedEmployees = allEmployees.filter((employee) => !isExcludedPayClass(employee.payClass));
  const excludedFullTimeClass = (employee: typeof allEmployees[number]) =>
    hasFixedEightHourHoliday(employee.payClass) && excludeFullTimeForHoliday.length >= holidayCount
      && excludeFullTimeForHoliday.slice(0, holidayCount).some(Boolean);
  const fullTimeExcludedEmployeeCount = includedEmployees.filter(excludedFullTimeClass).length;
  const holidayTotalsHundredths = Array.from({ length: holidayCount }, () => 0);
  const holidayEmployeeCounts = Array.from({ length: holidayCount }, () => 0);
  const holidayAtEightEmployeeCounts = Array.from({ length: holidayCount }, () => 0);
  const rows = includedEmployees
    .sort((left, right) => left.companyCode.localeCompare(right.companyCode)
      || left.fileNumber.localeCompare(right.fileNumber, undefined, { numeric: true }))
    .map((employee) => {
      // Mechanics FT and Office FT receive a full 8 hours. Other included classes
      // use PTO-inclusive timecard hours with the existing formula and 8-hour cap.
      // Integer arithmetic gives payroll-style half-up rounding at two decimals.
      const baseHolidayHundredths = hasFixedEightHourHoliday(employee.payClass)
        ? 800
        : Math.min(800, Math.floor((employee.hoursHundredths + 5) / 10));
      const perHolidayHundredths = Array.from({ length: holidayCount }, (_, index) =>
        hasFixedEightHourHoliday(employee.payClass) && excludeFullTimeForHoliday[index]
          ? 0
          : baseHolidayHundredths);
      perHolidayHundredths.forEach((hours, index) => {
        if (hours > 0) holidayEmployeeCounts[index] += 1;
        if (hours === 800) holidayAtEightEmployeeCounts[index] += 1;
        holidayTotalsHundredths[index] += hours;
      });
      const holidayHundredths = perHolidayHundredths.reduce((sum, hours) => sum + hours, 0);
      return {
        companyCode: employee.companyCode,
        fileNumber: employee.fileNumber,
        employeeName: employee.employeeName,
        payClass: employee.payClass,
        totalHours: employee.hoursHundredths / 100,
        holidayHours: holidayHundredths / 100,
        sourceRows: employee.sourceRows,
      };
    })
    .filter((employee) => employee.holidayHours > 0);

  return {
    rows,
    sourceRowCount,
    totalSourceHours: totalSourceHundredths / 100,
    totalHolidayHours: rows.reduce((total, employee) => total + employee.holidayHours, 0),
    cappedEmployeeCount: rows.filter((employee) => employee.holidayHours === 8 * holidayCount).length,
    excludedEmployeeCount,
    holidayTotals: holidayTotalsHundredths.map((hours) => hours / 100),
    holidayEmployeeCounts,
    holidayAtEightEmployeeCounts,
    fullTimeExcludedEmployeeCount,
  };
}

export function holidayHoursImportCsv(rows: HolidayHoursImportRow[]) {
  const output = [
    ["Co Code", "Batch ID", "File #", "Hours 3 Code", "Hours 3 Amount"],
    ...rows.map((row) => ["HNE", "Holiday", row.fileNumber, "HOL", row.holidayHours.toFixed(2)]),
  ];
  return `${output.map((row) => row.map(csvValue).join(",")).join("\r\n")}\r\n`;
}
