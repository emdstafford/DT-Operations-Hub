"use client";

import type { ProcessedReport } from "./processors/reportProcessor";
import { supabase } from "./supabase";

type ClearRow = Record<string, unknown>;

function s(value: unknown) {
  return String(value ?? "").trim();
}

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = s(value);
  if (!text) return "";
  const direct = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function clearValue(row: ClearRow, names: string[]) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && s(row[name]) !== "") return row[name];
  }
  return null;
}

function normalizeCode(value: unknown) {
  const text = s(value).toUpperCase().replace(/\s+/g, "");
  if (!text) return "";
  return text.match(/^[A-Z]+/)?.[0] ?? "";
}

function inferCancellation(row: ClearRow) {
  const fields = ["STATUS", "LOAD STATUS", "TRIP STATUS", "REASON", "CANCEL REASON", "NOTES", "COMMENTS"];
  const text = fields.map((field) => s(row[field])).filter(Boolean).join(" | ");
  const cancelled = /cancel|weather|closure|closed|storm|snow|ice|hurricane|emergency/i.test(text);
  return { cancelled, text };
}

function sanitizeClearRow(row: ClearRow) {
  const blocked = /charge|bill|paid|payment|interest|discount|check|amount|dollar|rate|cost|revenue/i;
  return Object.fromEntries(Object.entries(row).filter(([key]) => !blocked.test(key)));
}

async function currentUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in with an approved DT Express account before importing loads.");
  return user.id;
}

async function serviceClass(serviceCode: string, trip: string) {
  if (serviceCode) {
    const { data } = await supabase.from("load_service_code_rules")
      .select("service_class")
      .eq("service_code", serviceCode)
      .eq("active", true)
      .maybeSingle();
    if (data?.service_class) return String(data.service_class);
  }
  if (/^\d+$/.test(trip)) return "regular";
  if (trip) return "needs_review";
  return "needs_review";
}

async function upsertLoad(row: {
  load_number: string;
  service_date: string;
  contract_number?: string | null;
  trip_number?: string | null;
  service_code?: string | null;
  service_class?: string;
  clear_present?: boolean;
  fourkites_present?: boolean;
  clear_miles?: number | null;
  operation_status?: string;
  cancellation_reason?: string | null;
}) {
  const { data: existing, error: readError } = await supabase.from("load_master")
    .select("*")
    .eq("load_number", row.load_number)
    .eq("service_date", row.service_date)
    .maybeSingle();
  if (readError) throw readError;

  const merged = {
    load_number: row.load_number,
    service_date: row.service_date,
    contract_number: row.contract_number || existing?.contract_number || null,
    trip_number: row.trip_number || existing?.trip_number || null,
    service_code: row.service_code || existing?.service_code || null,
    service_class: row.service_class || existing?.service_class || "needs_review",
    clear_present: Boolean(row.clear_present || existing?.clear_present),
    fourkites_present: Boolean(row.fourkites_present || existing?.fourkites_present),
    clear_miles: row.clear_miles ?? existing?.clear_miles ?? null,
    fourkites_miles: existing?.fourkites_miles ?? null,
    reconciled_miles: existing?.reconciled_miles ?? null,
    operation_status: row.operation_status || existing?.operation_status || "needs_review",
    cancellation_reason: row.cancellation_reason || existing?.cancellation_reason || null,
    payment_status: existing?.payment_status || "not_checked",
    expected_payment: existing?.expected_payment ?? null,
    actual_payment: existing?.actual_payment ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from("load_master")
    .upsert(merged, { onConflict: "load_number,service_date" })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}

export async function syncFourKitesReportToLoadMaster(report: ProcessedReport) {
  const userId = await currentUserId();
  let synced = 0;
  for (const load of report.historicalLoads) {
    if (!load.loadNumber || !load.operatingDate) continue;
    const trip = load.trip || "";
    const code = normalizeCode(trip);
    const klass = await serviceClass(code, trip);
    const loadId = await upsertLoad({
      load_number: load.loadNumber,
      service_date: load.operatingDate,
      contract_number: load.contract || null,
      trip_number: load.trip,
      service_code: code || null,
      service_class: klass,
      fourkites_present: true,
      operation_status: klass === "extra" ? "extra_service" : "operated",
    });
    const { error } = await supabase.from("load_source_records").insert({
      load_id: loadId,
      source_system: "fourkites",
      source_file: report.fileName,
      source_status: "present",
      source_service_code: code || null,
      source_contract_number: load.contract || null,
      source_trip_number: load.trip,
      raw_data: {
        total_stops: load.totalStops,
        completed_stops: load.completedStops,
        incomplete_stops: load.incompleteStops,
        tags: load.tags,
      },
      imported_by: userId,
    });
    if (error) throw error;
    synced += 1;
  }
  return synced;
}

export async function syncClearRowsToLoadMaster(rows: ClearRow[], sourceFile: string) {
  const userId = await currentUserId();
  let synced = 0;
  let skippedWithoutIdentity = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const loadNumber = s(clearValue(row, ["LOAD NUMBER", "LOAD #", "LOAD", "LOAD ID", "LOADNUMBER"]));
    const serviceDate = isoDate(clearValue(row, ["PLANNED START", "SERVICE DATE", "DATE", "TRIP DATE", "START DATE"]));
    if (!loadNumber || !serviceDate) {
      skippedWithoutIdentity += 1;
      continue;
    }
    const contract = s(clearValue(row, ["CONTRACT", "CONTRACT NUMBER", "HCR"])).toUpperCase();
    const trip = s(clearValue(row, ["SV TRIP ID", "TRIP", "TRIP ID", "SERVICE TRIP"])).toUpperCase();
    const code = normalizeCode(trip);
    const miles = n(clearValue(row, ["FINAL MILES", "ACTUAL MILES", "MILES"]));
    const status = inferCancellation(row);
    const klass = await serviceClass(code, trip);
    const operationStatus = status.cancelled ? "usps_cancelled" : klass === "extra" ? "extra_service" : "operated";
    const loadId = await upsertLoad({
      load_number: loadNumber,
      service_date: serviceDate,
      contract_number: contract || null,
      trip_number: trip || null,
      service_code: code || null,
      service_class: klass,
      clear_present: true,
      clear_miles: miles,
      operation_status: operationStatus,
      cancellation_reason: status.cancelled ? status.text || "USPS cancellation" : null,
    });
    const { error } = await supabase.from("load_source_records").insert({
      load_id: loadId,
      source_system: "clear",
      source_file: sourceFile,
      source_row_number: index + 1,
      source_status: status.cancelled ? "cancelled" : "present",
      source_service_code: code || null,
      source_contract_number: contract || null,
      source_trip_number: trip || null,
      source_miles: miles,
      raw_data: sanitizeClearRow(row),
      imported_by: userId,
    });
    if (error) throw error;
    if (status.cancelled) {
      const { error: eventError } = await supabase.from("load_status_events").insert({
        load_id: loadId,
        source_system: "clear",
        status: "usps_cancelled",
        reason: status.text || "USPS cancellation",
      });
      if (eventError) throw eventError;
    }
    synced += 1;
  }
  return { synced, skippedWithoutIdentity };
}
