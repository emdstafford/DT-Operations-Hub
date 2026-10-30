type Entry = { contract: string; employeeId: string; name: string; hundredths: number };
const contractKey = (value: string) => value.trim().toUpperCase().replace(/^0+(?=\d)/, "");
const idKey = (value: string) => value.trim().toLowerCase().replace(/^0+(?=\d)/, "");
const nameKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*,\s*/g, ",");
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
  const byName = entries.filter((entry) => nameKey(entry.name) === key);
  const currentNames = currentRows.filter((entry) => contractKey(entry.contract) === contractKey(contract) && nameKey(entry.name) === key);
  if (!byName.length || new Set(byName.map((entry) => idKey(entry.employeeId))).size !== 1 || new Set(currentNames.map((entry) => idKey(entry.employeeId))).size > 1) return null;
  return sum(byName);
}
