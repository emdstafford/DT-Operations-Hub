import type { ProcessedReport, SummaryRow, Totals } from "./processors/reportProcessor";
import type { MissedStopSummary } from "./processOperationalExceptions";
import { supabase } from "./supabase";

export const REPORT_HISTORY_KEY = "dt-usps-report-history-v1";
export const MISSED_STOPS_HISTORY_KEY = "dt-missed-stops-history-v1";

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

export type MissedStopsSnapshot = Omit<MissedStopSummary, "rows"> & {
  id: string;
  fileName: string;
  periodStart: string;
  periodEnd: string;
  savedAt: string;
  uniqueLoadCount: number;
};

export async function getReportHistory(): Promise<ReportSnapshot[]> {
  const { data, error } = await supabase.from("report_history").select("data").eq("report_type", "usps_loads").order("period_start", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => row.data as ReportSnapshot);
}

export async function saveReportSnapshot(report: ProcessedReport) {
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in with an approved DT Express account before uploading.");
  const { error } = await supabase.from("report_history").upsert({ report_type: "usps_loads", period_start: report.periodStart, period_end: report.periodEnd, source_file: report.fileName, data: snapshot, uploaded_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "report_type,period_start,period_end" });
  if (error) throw error;
}

export async function getMissedStopsHistory(): Promise<MissedStopsSnapshot[]> {
  const { data, error } = await supabase.from("report_history").select("data").eq("report_type", "missed_stops").order("period_start", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => row.data as MissedStopsSnapshot);
}

export async function saveMissedStopsSnapshot(fileName: string, summary: MissedStopSummary) {
  const dates = summary.byDate.map((row) => row.key).filter(Boolean).sort();
  const periodStart = dates[0] ?? "unknown";
  const periodEnd = dates.at(-1) ?? periodStart;
  const snapshot: MissedStopsSnapshot = {
    id: `${periodStart}_${periodEnd}`,
    fileName,
    periodStart,
    periodEnd,
    savedAt: new Date().toISOString(),
    uniqueLoadCount: summary.rows.length,
    duplicateLoadNumbers: summary.duplicateLoadNumbers,
    totalMissingStops: summary.totalMissingStops,
    geofenceNonCompliantLoads: summary.geofenceNonCompliantLoads,
    pingNonCompliantLoads: summary.pingNonCompliantLoads,
    unmappedLoads: summary.unmappedLoads,
    byDate: summary.byDate,
    byContract: summary.byContract,
    byLocation: summary.byLocation,
  };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in with an approved DT Express account before uploading.");
  const { error } = await supabase.from("report_history").upsert({ report_type: "missed_stops", period_start: periodStart, period_end: periodEnd, source_file: fileName, data: snapshot, uploaded_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "report_type,period_start,period_end" });
  if (error) throw error;
}
