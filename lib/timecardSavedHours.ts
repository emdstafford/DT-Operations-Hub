type Entry = { contract: string; employeeId: string; name: string; hundredths: number };
import { normalizeTimecardContract } from "@/lib/timecardContracts";

const contractKey = normalizeTimecardContract;
const idKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^0+(?=\d)/, "");
const normalizeName = (value: string) => value.trim().toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const nameKey = (value: string) => normalizeName(value);
// Payroll exports sometimes omit or add middle initials. Use the last name
// and first given-name token only as a fallback, and only when it is unique
// on both payrolls.
const firstLastKey = (value: string) => {
  const [last = "", given = ""] = value.split(",", 2);
  const first = normalizeName(given).split(" ")[0] ?? "";
  const surname = normalizeName(last);
  return first && surname ? `${surname}|${first}` : "";
};
const sum = (rows: Entry[]) => rows.reduce((total, row) => total + row.hundredths, 0);

// A missing match is unknown, not proof that the employee worked zero hours.
export function timecardSavedHours(rows: Entry[], contract: string, employeeId?: string, name?: string, currentRows: Entry[] = []): number | null {
  const entries = rows.filter((entry) => contractKey(entry.contract) === contractKey(contract));
  if (!entries.length) return null;
  if (!employeeId) return sum(entries);
  const id = idKey(employeeId);
  const byId = entries.filter((entry) => idKey(entry.employeeId) === id);
  if (byId.length) return sum(byId);

  // Exports can switch between ADP position IDs, file numbers and name keys.
  // Only use an exact full name when it identifies one employee in each report.
  if (!name?.trim()) return null;
  const key = nameKey(name);
  let byName = entries.filter((entry) => nameKey(entry.name) === key);
  let currentNames = currentRows.filter((entry) => contractKey(entry.contract) === contractKey(contract) && nameKey(entry.name) === key);
  if (!byName.length) {
    const relaxedKey = firstLastKey(name);
    if (!relaxedKey) return null;
    byName = entries.filter((entry) => firstLastKey(entry.name) === relaxedKey);
    currentNames = currentRows.filter((entry) => contractKey(entry.contract) === contractKey(contract) && firstLastKey(entry.name) === relaxedKey);
  }
  if (!byName.length || new Set(byName.map((entry) => idKey(entry.employeeId))).size !== 1 || new Set(currentNames.map((entry) => idKey(entry.employeeId))).size > 1) return null;
  return sum(byName);
}
