import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ProcessedReport } from "@/lib/processors/reportProcessor";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(name + " must be configured server-side");
  return value;
}

export function automationDatabase(): SupabaseClient {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Matches the data shape and upsert keys of lib/reportHistory.ts (manual upload).
// Not connected to any public endpoint until the download and import integration passes tests.
export async function saveAutomatedFourKitesReport(
  db: SupabaseClient,
  report: ProcessedReport,
  automationUserId: string,
  sourceVerification?: {
    sha256: string; rawLoadRows: number; datedLoadRows: number;
    targetDateRows: number; duplicateCount: number;
    periodStart: string; periodEnd: string;
    passed: boolean;
  },
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(automationUserId)) {
    throw new Error("A valid authorized automation user ID is required");
  }
  if (!report.periodStart || !report.periodEnd || report.periodStart > report.periodEnd) {
    throw new Error("Unable to establish report period from the workbook");
  }
  const rows = report.historicalLoads.filter((load) => load.loadNumber && load.operatingDate);
  if (!rows.length) throw new Error("No dated loads in FourKites workbook");
  const now = new Date().toISOString();

  // Keep the same load_number upsert semantics used by manual uploads;
  // include historical operating days even when outside the filename period.
  const records = rows.map((load) => ({
    load_number: load.loadNumber,
    operating_date: load.operatingDate,
    contract_number: load.contract || null,
    trip_number: load.trip,
    supervisors: load.supervisors,
    total_stops: load.totalStops,
    completed_stops: load.completedStops,
    incomplete_stops: load.incompleteStops,
    source_file: report.fileName,
    source_period_start: report.periodStart,
    source_period_end: report.periodEnd,
    uploaded_by: automationUserId,
    updated_at: now,
  }));

  // Check for more recent source periods to avoid an older replay overwriting newer values.
  let savedLoads = 0;
  let olderSkipped = 0;
  for (let index = 0; index < records.length; index += 250) {
    const batch = records.slice(index, index + 250);
    const { data: existing, error: readError } = await db.from("usps_loads")
      .select("load_number,source_period_end")
      .in("load_number", batch.map((row) => row.load_number));
    if (readError) throw new Error("Cannot check existing loads: " + readError.message);
    const newerByLoad = new Map((existing ?? []).map((row) => [String(row.load_number), String(row.source_period_end ?? "")]));
    const applicable = batch.filter((row) => {
      const newerEnd = newerByLoad.get(row.load_number);
      if (newerEnd && newerEnd > report.periodEnd) { olderSkipped++; return false; }
      return true;
    });
    if (!applicable.length) continue;
    const { error } = await db.from("usps_loads").upsert(applicable, { onConflict: "load_number" });
    if (error) throw new Error("Automated loads stopped near row " + (index + 1) + ": " + error.message);
    savedLoads += applicable.length;
  }

  const snapshot = {
    id: report.periodStart + "_" + report.periodEnd,
    fileName: report.fileName,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    savedAt: now,
    uniqueLoadCount: report.reportLoads.length,
    totals: report.totals,
    daily: report.daily,
    contracts: report.contracts,
    supervisors: report.supervisors,
    duplicateCount: report.duplicateLoadNumbers.length,
    outsidePeriodCount: report.outsidePeriodCount,
    // Recorded only by the authorized server-side FourKites import route,
    // never inferred from a manual upload or the snapshot itself.
    sourceVerification: sourceVerification?.passed ? {
      ...sourceVerification, verifiedAt: now, provenance: "authorized_fourkites_signed_workbook",
    } : null,
  };
  const { error: historyError } = await db.from("report_history")
    .upsert({
      report_type: "usps_loads",
      period_start: report.periodStart,
      period_end: report.periodEnd,
      source_file: report.fileName,
      data: snapshot,
      uploaded_by: automationUserId,
      updated_at: now,
    }, { onConflict: "report_type,period_start,period_end" });
  if (historyError) throw new Error("Load records saved but report history failed: " + historyError.message);

  return {
    status: "imported",
    savedLoads,
    olderSkipped,
    totalDatedLoads: records.length,
    operatingDays: [...new Set(records.map((row) => row.operating_date))].sort(),
  };
}
