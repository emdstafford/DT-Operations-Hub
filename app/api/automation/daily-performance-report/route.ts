import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { automationDatabase } from "@/lib/server/saveAutomatedFourKitesReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Load = {
  load_number: string;
  contract_number: string | null;
  trip_number: string | null;
  supervisors: string[] | null;
  total_stops: number;
  completed_stops: number;
  incomplete_stops: number;
};
type Stats = { loads: number; totalStops: number; completedStops: number; incompleteStops: number };
const zero = (): Stats => ({ loads: 0, totalStops: 0, completedStops: 0, incompleteStops: 0 });
function add(stats: Stats, load: Load) {
  stats.loads++;
  stats.totalStops += Number(load.total_stops) || 0;
  stats.completedStops += Number(load.completed_stops) || 0;
  stats.incompleteStops += Number(load.incomplete_stops) || 0;
}
function result(stats: Stats) {
  return { ...stats, completionPercent: stats.totalStops ? Math.round(stats.completedStops / stats.totalStops * 10000) / 100 : 0 };
}
function group(map: Map<string, Stats>, key: string, load: Load) {
  const item = map.get(key) ?? zero();
  add(item, load);
  map.set(key, item);
}
function ranked<K extends string>(map: Map<string, Stats>, key: K): Array<ReturnType<typeof result> & Record<K, string>> {
  return [...map.entries()].map(([name, stats]) => ({
    ...result(stats), [key]: name,
  } as ReturnType<typeof result> & Record<K, string>))
    .sort((a, b) => b.totalStops - a.totalStops || a[key].localeCompare(b[key]));
}
function authorized(request: Request) {
  const expected = process.env.AUTOMATION_INGEST_SECRET;
  const supplied = request.headers.get("x-dt-ingest-secret");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
function validDate(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(day + "T00:00:00Z");
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === day;
}
function tripType(trip: string | null): "regular" | "extra" | "unclassified" {
  const t = String(trip ?? "").trim();
  if (!t) return "unclassified";
  return /^\d+$/.test(t) ? "regular" : "extra";
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const day = new URL(request.url).searchParams.get("date") ?? "";
  if (!validDate(day)) return NextResponse.json({ ok: false, error: "Valid yyyy-MM-dd date required" }, { status: 400 });
  try {
    const db = automationDatabase();
    const { data: saved, error: savedError } = await db.from("report_history")
      .select("source_file,data,period_start,period_end,updated_at")
      .eq("report_type", "usps_loads").eq("period_end", day)
      .lte("period_start", day).order("updated_at", { ascending: false }).limit(1);
    if (savedError) throw savedError;
    const snapshot = saved?.[0];
    const daily = Array.isArray(snapshot?.data?.daily) ? snapshot.data.daily : [];
    const matchingDay = daily.find((entry: { key?: string }) => entry.key === day);
    const expectedLoads = Number(matchingDay?.loadCount ?? 0);
    if (!snapshot?.source_file || !Number.isSafeInteger(expectedLoads) || expectedLoads < 1) {
      return NextResponse.json({ ok: true, ready: false, date: day, reason: "Daily import snapshot unavailable" }, { headers: { "Cache-Control": "no-store" } });
    }
    if (expectedLoads > 25000) throw new Error("Daily data exceeds reporting limit");

    const loads: Load[] = [];
    for (let offset = 0; offset < expectedLoads + 1000; offset += 1000) {
      const { data, error } = await db.from("usps_loads")
        .select("load_number,contract_number,trip_number,supervisors,total_stops,completed_stops,incomplete_stops")
        .eq("operating_date", day).eq("source_file", snapshot.source_file).eq("source_period_end", day)
        .order("load_number").range(offset, offset + 999);
      if (error) throw error;
      loads.push(...(data ?? []) as Load[]);
      if ((data ?? []).length < 1000) break;
    }
    if (loads.length !== expectedLoads) {
      return NextResponse.json({ ok: true, ready: false, date: day, expectedLoads, savedLoads: loads.length, reason: "Imported loads do not match the saved report" }, { headers: { "Cache-Control": "no-store" } });
    }

    const overall = zero(), regular = zero(), extra = zero(), unclassified = zero();
    const supervisors = new Map<string, Stats>();
    const contracts = new Map<string, Stats>();
    const supervisorContracts = new Map<string, Stats>();
    const supervisorContractsByTrip = new Map<string, { regular: Stats; extra: Stats; unclassified: Stats }>();
    for (const load of loads) {
      add(overall, load);
      const type = tripType(load.trip_number);
      add(type === "regular" ? regular : type === "extra" ? extra : unclassified, load);
      const contract = load.contract_number || "Unassigned contract";
      group(contracts, contract, load);
      const names = [...new Set((load.supervisors ?? []).filter(Boolean))];
      for (const name of names.length ? names : ["Unassigned"]) {
        group(supervisors, name, load);
        const key = name + " | " + contract;
        group(supervisorContracts, key, load);
        const buckets = supervisorContractsByTrip.get(key) ?? { regular: zero(), extra: zero(), unclassified: zero() };
        add(buckets[type], load);
        supervisorContractsByTrip.set(key, buckets);
      }
    }
    const supervisorRows = ranked(supervisors, "supervisor");
    const contractRows = ranked(contracts, "contract");
    // A single consolidated review per supervisor is generated when either
    // their overall score OR any assigned contract falls below 95%.
    const supervisorContractsRows = ranked(supervisorContracts, "supervisorContract");
    const detailedContracts = supervisorContractsRows.map(({ supervisorContract, ...stats }) => {
      const separator = supervisorContract.indexOf(" | ");
      const supervisor = supervisorContract.slice(0, separator);
      const contract = supervisorContract.slice(separator + 3);
      const buckets = supervisorContractsByTrip.get(supervisorContract)!;
      return {
        supervisor, contract, ...stats,
        regularTrips: result(buckets.regular),
        extraTrips: result(buckets.extra),
        unclassifiedTrips: result(buckets.unclassified),
        below95: stats.totalStops > 0 && stats.completionPercent < 95,
      };
    });
    const under95 = supervisorRows.filter(row => row.supervisor !== "Unassigned" && row.totalStops > 0 && row.completionPercent < 95);
    const fmt = (value: number) => value.toLocaleString("en-US");
    const pct = (value: number) => value.toFixed(2) + "%";
    const contractLine = (c: typeof detailedContracts[number]) =>
      [c.contract, pct(c.completionPercent), fmt(c.totalStops), fmt(c.completedStops), fmt(c.incompleteStops),
       pct(c.regularTrips.completionPercent), pct(c.extraTrips.completionPercent), c.below95 ? "BELOW 95%" : ""].join(" | ");
    const companyBody = [
      "Davenport Transportation — USPS Daily Performance Report",
      "Operating date: " + day,
      "Official overall completion: " + pct(result(overall).completionPercent),
      "Regular Trips: " + pct(result(regular).completionPercent),
      "Extra Trips: " + pct(result(extra).completionPercent),
      "",
      "Supervisor | Overall | Total stops | Completed | Incomplete",
      ...supervisorRows.map(s => [s.supervisor,pct(s.completionPercent),fmt(s.totalStops),fmt(s.completedStops),fmt(s.incompleteStops)].join(" | ")),
      "",
      "Contract | Overall | Total stops | Completed | Incomplete",
      ...contractRows.map(s => [s.contract,pct(s.completionPercent),fmt(s.totalStops),fmt(s.completedStops),fmt(s.incompleteStops),
        s.totalStops > 0 && s.completionPercent < 95 ? "BELOW 95%" : ""].join(" | ")),
      "", "DT Hub: https://dt-intelligence-hub.vercel.app/daily-reports",
    ].join("\\n");
    const individualReviews = supervisorRows
      .filter(s => s.supervisor !== "Unassigned" && s.totalStops > 0)
      .map(s => {
        const assigned = detailedContracts.filter(c => c.supervisor === s.supervisor)
          .sort((a,b) => a.completionPercent - b.completionPercent || a.contract.localeCompare(b.contract));
        const failing = assigned.filter(c => c.below95);
        const overallBelow95 = s.completionPercent < 95;
        if (!overallBelow95 && failing.length === 0) return null;
        return {
          supervisor: s.supervisor,
          overallCompletionPercent: s.completionPercent,
          overallBelow95,
          failingContractCount: failing.length,
          failingContracts: failing.map(c => c.contract),
          // The complete contract list is intentional, even for passing contracts.
          contracts: assigned,
          subject: "Performance Review — " + s.supervisor + " — " + day,
          body: [
            "Davenport Transportation — Daily Supervisor Performance Review",
            "Operating date: " + day,
            "Supervisor: " + s.supervisor,
            "Official overall completion: " + pct(s.completionPercent),
            "Reasons for review: " + [
              ...(overallBelow95 ? ["overall supervisor below 95%"] : []),
              ...(failing.length ? ["contract(s) below 95%: " + failing.map(c => c.contract).join(", ")] : []),
            ].join("; "),
            "",
            "ALL ASSIGNED CONTRACTS (including those at or above 95%)",
            "Contract | Overall | Total stops | Completed | Incomplete | Regular Trips | Extra Trips | Review",
            ...assigned.map(contractLine),
            "", "See DT Hub for detailed stop explanations and missing-load reviews.",
            "https://dt-intelligence-hub.vercel.app/missed-load-reviews",
          ].join("\\n"),
        };
      }).filter((review): review is NonNullable<typeof review> => review !== null);
    return NextResponse.json({
      ok: true, ready: true, date: day,
      importVerified: true,
      sourceCompletenessCertified: false,
      // Data is for an internal test preview only, not an authorization to send.
      sendAuthorized: false,
      expectedLoads,
      overall: result(overall),
      regularTrips: result(regular),
      extraTrips: result(extra),
      unclassifiedTrips: result(unclassified),
      supervisors: supervisorRows,
      contracts: contractRows,
      supervisorContracts: supervisorContractsRows,
      below95Supervisors: under95.map(row => row.supervisor),
      companyEmail: { subject: "Davenport Transportation — Daily USPS Performance — " + day, body: companyBody },
      individualReviews,
      individualReviewCount: individualReviews.length,
      // The reporting endpoint never authorizes delivery. Use a separate gated send workflow.
      recipientsValidated: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, ready: false, error: "Could not produce verified daily report" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
