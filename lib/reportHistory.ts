import type { ProcessedReport, SummaryRow, Totals } from "./processors/reportProcessor";

export const REPORT_HISTORY_KEY = "dt-usps-report-history-v1";

export type ReportSnapshot = {
  id: string;
  fileName: string;
  periodStart: string;
  periodEnd: string;
  savedAt: string;
  uniqueLoadCount: number;
  totals: Totals;
  daily: SummaryRow[];
  contracts: SummaryRow[];
  supervisors: SummaryRow[];
  duplicateCount: number;
  outsidePeriodCount: number;
};

export function getReportHistory(): ReportSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(REPORT_HISTORY_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveReportSnapshot(report: ProcessedReport) {
  const snapshot: ReportSnapshot = {
    id: `${report.periodStart}_${report.periodEnd}`,
    fileName: report.fileName,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    savedAt: new Date().toISOString(),
    uniqueLoadCount: report.reportLoads.length,
    totals: report.totals,
    daily: report.daily,
    contracts: report.contracts,
    supervisors: report.supervisors,
    duplicateCount: report.duplicateLoadNumbers.length,
    outsidePeriodCount: report.outsidePeriodCount,
  };
  const history = getReportHistory().filter((item) => item.id !== snapshot.id);
  history.push(snapshot);
  history.sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  window.localStorage.setItem(REPORT_HISTORY_KEY, JSON.stringify(history));
}
