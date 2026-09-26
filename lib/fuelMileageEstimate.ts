export type MileagePlan = {
  contract_number: string;
  effective_start: string;
  effective_end: string | null;
  annual_miles: number;
  assumed_mpg: number;
  tractor_count?: number | null;
  straight_truck_count?: number | null;
  van_count?: number | null;
  alert_above_percent: number;
};

export type MileageEstimate = {
  plannedMiles: number;
  expectedGallons: number;
  mileageCoveredDays: number;
  gallonsCoveredDays: number;
  coveredDays: number;
  totalDays: number;
  alertAbovePercent: number;
};

const DAY = 86400000;
const utcDay = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function estimateContractMileage(plans: MileagePlan[], start: string, end: string): MileageEstimate {
  const first = utcDay(start);
  const last = utcDay(end);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) {
    return { plannedMiles: 0, expectedGallons: 0, mileageCoveredDays: 0, gallonsCoveredDays: 0, coveredDays: 0, totalDays: 0, alertAbovePercent: 0 };
  }

  const ordered = [...plans].sort((a, b) => b.effective_start.localeCompare(a.effective_start));
  let plannedMiles = 0;
  let expectedGallons = 0;
  let mileageCoveredDays = 0;
  let gallonsCoveredDays = 0;
  let alertAbovePercent = 0;

  for (let date = first; date <= last; date += DAY) {
    const day = new Date(date).toISOString().slice(0, 10);
    const plan = ordered.find((item) => item.effective_start <= day && (!item.effective_end || day <= item.effective_end));
    if (!plan || Number(plan.annual_miles) <= 0) continue;

    const year = new Date(date).getUTCFullYear();
    const daysInYear = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY;
    const dailyMiles = Number(plan.annual_miles) / daysInYear;
    plannedMiles += dailyMiles;
    mileageCoveredDays++;

    if (Number(plan.assumed_mpg) > 0) {
      expectedGallons += dailyMiles / Number(plan.assumed_mpg);
      gallonsCoveredDays++;
      alertAbovePercent = Number(plan.alert_above_percent);
    }
  }

  return {
    plannedMiles,
    expectedGallons,
    mileageCoveredDays,
    gallonsCoveredDays,
    coveredDays: mileageCoveredDays,
    totalDays: Math.round((last - first) / DAY) + 1,
    alertAbovePercent,
  };
}
