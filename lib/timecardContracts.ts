/** Canonical contract labels across payroll exports with optional zero padding. */
export function normalizeTimecardContract(value: string): string {
  const key = value.trim().toUpperCase().replace(/^0+(?=\d)/, "");
  // These two system departments intentionally retain their zero-prefixed labels.
  if (key === "1SHDR") return "01SHDR";
  if (key === "11VAN") return "011VAN";
  return key;
}
