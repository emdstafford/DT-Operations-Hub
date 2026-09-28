export type ContractPayRate = {
  contract_number: string;
  st_hourly: number | null;
  tt_hourly: number | null;
  fringe_hourly: number | null;
  car_hourly: number | null;
  daily_rate: number | null;
  needs_review: boolean;
};

function amount(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "" || /^-+$/.test(String(value).trim())) return null;
  const number = Number(String(value).replace(/[$,]/g, ""));
  if (!Number.isFinite(number) || number < 0 || number > 10000) throw new Error(`Unrecognized rate: ${String(value).slice(0, 40)}`);
  return number;
}

export function parseContractPayRates(rows: unknown[][]): { rates: ContractPayRate[]; warnings: string[] } {
  const header = rows[0]?.map((value) => String(value ?? "").trim().toLowerCase()) ?? [];
  if (header[0] !== "contract" || header[1] !== "st" || header[2] !== "fringe" || header[3] !== "tt" || header[4] !== "car" || header[5] !== "daily rate" || header[6] !== "daily rate") {
    throw new Error("Expected columns: Contract, ST, Fringe, TT, Car, Daily Rate, Daily Rate, Notes.");
  }
  const seen = new Set<string>();
  const rates: ContractPayRate[] = [];
  const warnings: string[] = [];
  rows.slice(1).forEach((row, index) => {
    const contract = String(row?.[0] ?? "").trim().toUpperCase();
    if (!contract && row.every((value) => value === null || value === undefined || String(value).trim() === "")) return;
    if (!/^[0-9A-Z]{5,6}$/.test(contract)) throw new Error(`Row ${index + 2} has an invalid contract number.`);
    if (seen.has(contract)) throw new Error(`Contract ${contract} appears more than once.`);
    seen.add(contract);
    const daily = [amount(row[5]), amount(row[6])];
    const note = String(row[7] ?? "").trim();
    const approvedDaily = new Set(["364A8", "36463", "378A5"]);
    const dailyRate = approvedDaily.has(contract) ? daily[0] : null;
    const needsReview = (!!note && note !== "------") || String(row[1] ?? "").trim().toLowerCase() === "varies";
    const st = String(row[1] ?? "").trim().toLowerCase() === "varies" ? null : amount(row[1]);
    if (needsReview) warnings.push(`${contract}: location-dependent amount needs a rule before calculation.`);
    if (approvedDaily.has(contract) && dailyRate === null) throw new Error(`${contract} is missing its confirmed daily rate.`);
    rates.push({ contract_number: contract, st_hourly: st, tt_hourly: amount(row[3]), fringe_hourly: amount(row[2]), car_hourly: amount(row[4]), daily_rate: dailyRate, needs_review: needsReview });
  });
  if (!rates.length) throw new Error("No contract rates found.");
  return { rates, warnings };
}
