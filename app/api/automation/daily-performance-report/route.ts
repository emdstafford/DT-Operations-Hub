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
type PriorLoad = Load & { operating_date: string };
type PriorAudit = {
  id: number; load_number: string; operating_date: string; reported_period_end: string;
  source_file: string; event_type: "newly_observed" | "revised";
  previous_total_stops: number | null; previous_completed_stops: number | null;
  previous_incomplete_stops: number | null; current_total_stops: number;
  current_completed_stops: number; current_incomplete_stops: number;
};
type PriorUpdate = {
  load: PriorLoad;
  firstBefore: PriorAudit | null;
  lastAfter: PriorAudit | null;
};
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

    // Every previous-day row in the source workbook is visible as context,
    // even when no earlier version exists. Separately captured audit events
    // prove before/after changes; never infer "new credit" from arrival alone.
    const priorLoads: PriorLoad[] = [];
    const priorAudit: PriorAudit[] = [];
    for (let offset = 0; offset < 25000; offset += 1000) {
      const { data, error } = await db.from("usps_loads")
        .select("load_number,operating_date,contract_number,trip_number,supervisors,total_stops,completed_stops,incomplete_stops")
        .eq("source_file", snapshot.source_file).eq("source_period_end", day)
        .lt("operating_date", day).order("load_number").range(offset, offset + 999);
      if (error) throw error;
      priorLoads.push(...(data ?? []) as PriorLoad[]);
      if ((data ?? []).length < 1000) break;
      if (offset === 24000) throw new Error("Too many previous-day loads to safely render");
    }
    for (let offset = 0; offset < 25000; offset += 1000) {
      const { data, error } = await db.from("fourkites_prior_day_updates")
        .select("id,load_number,operating_date,reported_period_end,source_file,event_type,previous_total_stops,previous_completed_stops,previous_incomplete_stops,current_total_stops,current_completed_stops,current_incomplete_stops")
        .eq("reported_period_end", day).eq("source_file", snapshot.source_file)
        .order("id", { ascending: true }).range(offset, offset + 999);
      if (error) throw error;
      priorAudit.push(...(data ?? []) as PriorAudit[]);
      if ((data ?? []).length < 1000) break;
      if (offset === 24000) throw new Error("Too many previous-day updates to safely render");
    }
    const eventsByLoad = new Map<string, { first: PriorAudit; last: PriorAudit }>();
    for (const event of priorAudit) {
      const found = eventsByLoad.get(event.load_number);
      eventsByLoad.set(event.load_number, {
        first: found?.first ?? event, last: event,
      });
    }
    // Prefer date-effective DT Hub assignments, then current assignments only
    // where no dated assignment is recorded for that contract.
    const [{ data: assignmentPeriods, error: periodsError }, { data: activeAssignments, error: assignmentsError },
      { data: recipientRows, error: recipientsError }, { data: tripRows, error: tripError },
      { data: notesRows, error: notesError }] = await Promise.all([
      db.from("contract_assignment_periods").select("contract_number,supervisor,start_date,end_date")
        .lte("start_date", day).or(`end_date.is.null,end_date.gte.${day}`),
      db.from("contract_supervisors").select("contract_number,supervisor").eq("active", true),
      db.from("daily_report_recipients").select("name,email,recipient_type,enabled"),
      db.from("trip_supervisor_assignments").select("contract_number,trip_number,supervisor")
        .in("contract_number", ["296B8", "296C2"]),
      db.from("operational_notes").select("contract_number,trip_number,status,note,requested_on,effective_start,effective_end")
        .lte("effective_start", day).or(`effective_end.is.null,effective_end.gte.${day}`),
    ]);
    if (periodsError || assignmentsError || recipientsError || tripError || notesError) throw new Error("Could not read reporting assignments or operational notes");
    const {data: settingsRow, error: settingsError} = await db.from("daily_email_settings")
      .select("delivery_enabled,company_enabled,individual_enabled,threshold_percent").eq("id",1).single();
    if (settingsError || !settingsRow) throw new Error("Daily email settings unavailable");
    const threshold = Number(settingsRow.threshold_percent);
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100) throw new Error("Invalid email threshold");
    const thresholdLabel = String(threshold).replace(/\\.0+$/, "") + "%";
    const normalizeContract = (value: string | null) => (value || "").trim().toUpperCase().replace(/^0+(?=[0-9])/, "");
    const recipientByName = new Map<string, string>();
    for (const row of recipientRows ?? []) {
      if (row.enabled && row.recipient_type === "supervisor" && row.email) recipientByName.set(String(row.name).trim().toLowerCase(), String(row.email).trim().toLowerCase());
    }
    // Tonya's separate Monday-only email is never part of this daily workflow.
    // Recognize historical spellings when assigning the performance records.
    const isTonya = (name: string, email?: string) => {
      const normalized = name.trim().toLowerCase().replace(/[^a-z]/g, "");
      return ["tonyacappsowen", "tonyacappsowens", "tonyaowen", "tonyaowens", "tonyacapps"].includes(normalized)
        || String(email ?? "").trim().toLowerCase() === "tocapps@bellsouth.net";
    };
    const cleanSupervisor = (name: string) => isTonya(name) ? "Tonya Capps-Owens" : name.trim();
    const tripAssignments = new Map<string, string[]>();
    for (const row of tripRows ?? []) {
      const key = normalizeContract(row.contract_number) + "|" + String(row.trip_number ?? "").trim();
      const found = tripAssignments.get(key) ?? [];
      const name = cleanSupervisor(String(row.supervisor ?? ""));
      if (name && !found.includes(name)) found.push(name);
      tripAssignments.set(key, found);
    }
    const splitAssignment = (value: string) => {
      const label = value.trim();
      if (recipientByName.has(label.toLowerCase())) return [cleanSupervisor(label)];
      return label.split("/").map(cleanSupervisor).filter(Boolean);
    };
    const datedByContract = new Map<string, Set<string>>();
    const activeByContract = new Map<string, Set<string>>();
    for (const row of assignmentPeriods ?? []) {
      const key = normalizeContract(row.contract_number);
      const names = datedByContract.get(key) ?? new Set<string>();
      for (const name of splitAssignment(row.supervisor || "")) names.add(name);
      datedByContract.set(key, names);
    }
    for (const row of activeAssignments ?? []) {
      const key = normalizeContract(row.contract_number);
      const names = activeByContract.get(key) ?? new Set<string>();
      for (const name of splitAssignment(row.supervisor || "")) names.add(name);
      activeByContract.set(key, names);
    }
    const assignmentFallbackContracts = new Set<string>();
    const unmatchedSupervisorNames = new Set<string>();
    const resolvedSupervisors = (load: Load) => {
      const key = normalizeContract(load.contract_number);
      // Tonya owns only her explicitly assigned trips. The remainder of
      // 296B8 belongs to Eric; 296C2 is jointly supervised by Kevin and Bruce.
      // Reporting shared ownership is intentional (not an additional USPS load).
      if (key === "296B8" || key === "296C2") {
        const assigned = tripAssignments.get(key + "|" + String(load.trip_number ?? "").trim());
        if (assigned?.length) return assigned;
        return key === "296B8" ? ["Eric Grant"] : ["Kevin Shields", "Bruce Stevens"];
      }
      const dated = datedByContract.get(key);
      if (dated?.size) return [...dated];
      // Missing historical coverage: current mapping is provisional, never
      // proof that a supervisor held this contract on a past operating day.
      assignmentFallbackContracts.add(key);
      const current = activeByContract.get(key);
      if (current?.size) return [...current];
      // Last resort for the preview only. It must not drive unattended mail.
      return [...new Set((load.supervisors ?? []).flatMap(splitAssignment).filter(Boolean))];
    };
    type MissedTripDetail = {
      contract: string; trip: string; loadNumbers: string[]; missed: number; loads: number;
    };
    const supervisorMissedTrips = new Map<string, Map<string, MissedTripDetail>>();
    // Keep supervisor attribution identical to the official daily summary.
    // A shared trip can appear in both supervisors' reviews without adding
    // extra loads or stops to the company-wide totals.
    const previousDayBySupervisor = new Map<string, PriorUpdate[]>();
    for (const load of priorLoads) {
      const contract = normalizeContract(load.contract_number);
      // For shared trip ownership, preserve the same Tonya / Kevin / Bruce
      // and Eric mapping used in the daily report. Other contracts use the
      // historical assignment saved with the original operating-day load.
      const names = contract === "296B8" || contract === "296C2"
        ? resolvedSupervisors(load)
        : [...new Set((load.supervisors ?? []).flatMap(splitAssignment).filter(Boolean))];
      const event = eventsByLoad.get(load.load_number);
      const update: PriorUpdate = {
        load, firstBefore: event?.first ?? null, lastAfter: event?.last ?? null,
      };
      for (const name of names) {
        const list = previousDayBySupervisor.get(name) ?? [];
        list.push(update);
        previousDayBySupervisor.set(name, list);
      }
    }
    const operationalNotes = (notesRows ?? []).map(row => ({
      contract: normalizeContract(row.contract_number),
      trip: String(row.trip_number ?? "").trim(),
      status: String(row.status ?? ""),
      note: String(row.note ?? ""),
      requestedOn: row.requested_on ? String(row.requested_on) : "",
    }));
    const overall = zero(), regular = zero(), extra = zero(), unclassified = zero();
    const supervisors = new Map<string, Stats>();
    const contracts = new Map<string, Stats>();
    const supervisorContracts = new Map<string, Stats>();
    const supervisorTripStats = new Map<string, { regular: Stats; extra: Stats; unclassified: Stats }>();
    const contractTripStats = new Map<string, { regular: Stats; extra: Stats; unclassified: Stats }>();
    const supervisorContractsByTrip = new Map<string, { regular: Stats; extra: Stats; unclassified: Stats }>();
    for (const load of loads) {
      add(overall, load);
      const type = tripType(load.trip_number);
      add(type === "regular" ? regular : type === "extra" ? extra : unclassified, load);
      const contract = normalizeContract(load.contract_number) || "Unassigned contract";
      group(contracts, contract, load);
      const contractBuckets = contractTripStats.get(contract) ?? { regular: zero(), extra: zero(), unclassified: zero() };
      add(contractBuckets[type], load);
      contractTripStats.set(contract, contractBuckets);
      const names = resolvedSupervisors(load);
      for (const name of names.length ? names : ["Unassigned"]) {
        if (Number(load.incomplete_stops) > 0) {
          const byTrip = supervisorMissedTrips.get(name) ?? new Map<string, MissedTripDetail>();
          const trip = String(load.trip_number ?? "").trim() || "Unassigned";
          const tripKey = contract + "|" + trip;
          const item = byTrip.get(tripKey) ?? { contract, trip, loadNumbers: [], missed: 0, loads: 0 };
          item.loads++;
          item.missed += Number(load.incomplete_stops) || 0;
          item.loadNumbers.push(String(load.load_number));
          byTrip.set(tripKey, item);
          supervisorMissedTrips.set(name, byTrip);
        }
        group(supervisors, name, load);
        const supervisorBuckets = supervisorTripStats.get(name) ?? { regular: zero(), extra: zero(), unclassified: zero() };
        add(supervisorBuckets[type], load);
        supervisorTripStats.set(name, supervisorBuckets);
        const key = name + " | " + contract;
        group(supervisorContracts, key, load);
        const buckets = supervisorContractsByTrip.get(key) ?? { regular: zero(), extra: zero(), unclassified: zero() };
        add(buckets[type], load);
        supervisorContractsByTrip.set(key, buckets);
      }
    }
    const supervisorEmails: Record<string, string> = {};
    const configuredSupervisors = new Set((recipientRows ?? []).filter(row => row.recipient_type === "supervisor").map(row => String(row.name).trim().toLowerCase()));
    for (const name of new Set([...supervisors.keys(), ...previousDayBySupervisor.keys()])) {
      if (name === "Unassigned" || isTonya(name)) continue;
      const email = recipientByName.get(name.trim().toLowerCase());
      if (email) supervisorEmails[name] = email;
      else if (!configuredSupervisors.has(name.trim().toLowerCase())) unmatchedSupervisorNames.add(name);
    }
    const supervisorRows = ranked(supervisors, "supervisor");
    // Include Tonya's performance in the company report; exclude her only
    // from DAILY RECIPIENTS and individual daily email dispatch.
    // James Bowling and Sidney Williams share the same loads. Display one
    // jointly attributed row only when their computed values actually match.
    const james = supervisorRows.find(row => row.supervisor === "James Bowling");
    const sidney = supervisorRows.find(row => row.supervisor === "Sidney Williams");
    const sameSharedPerformance = Boolean(james && sidney &&
      ["loads", "totalStops", "completedStops", "incompleteStops", "completionPercent"].every(
        key => (james as unknown as Record<string, unknown>)[key] === (sidney as unknown as Record<string, unknown>)[key]));
    const kevin = supervisorRows.find(row => row.supervisor === "Kevin Shields");
    const bruce = supervisorRows.find(row => row.supervisor === "Bruce Stevens");
    const sameKevinBrucePerformance = Boolean(kevin && bruce &&
      ["loads", "totalStops", "completedStops", "incompleteStops", "completionPercent"].every(
        key => (kevin as unknown as Record<string, unknown>)[key] === (bruce as unknown as Record<string, unknown>)[key]));
    const dailyEmailSupervisorRows = supervisorRows
      .filter(row =>
        (!sameSharedPerformance || row.supervisor !== "Sidney Williams") &&
        (!sameKevinBrucePerformance || row.supervisor !== "Bruce Stevens"))
      .map(row => sameSharedPerformance && row.supervisor === "James Bowling"
        ? { ...row, supervisor: "James Bowling / Sidney Williams" }
        : sameKevinBrucePerformance && row.supervisor === "Kevin Shields"
          ? { ...row, supervisor: "Kevin Shields / Bruce Stevens" } : row);
    // Email presentation ranking only: highest supervisor first, lowest contract first.
    // Official totals, thresholds, and individual review eligibility are unchanged.
    const rankedDailySupervisors = [...dailyEmailSupervisorRows].sort((a, b) =>
      b.completionPercent - a.completionPercent || a.supervisor.localeCompare(b.supervisor));
    const contractRows = ranked(contracts, "contract");
    const rankedDailyContracts = [...contractRows].sort((a, b) =>
      a.completionPercent - b.completionPercent || a.contract.localeCompare(b.contract, undefined, { numeric: true }));
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
        below95: stats.totalStops > 0 && stats.completionPercent < threshold,
      };
    });
    const under95 = supervisorRows.filter(row => row.supervisor !== "Unassigned" && row.totalStops > 0 && row.completionPercent < threshold);
    const fmt = (value: number) => value.toLocaleString("en-US");
    const pct = (value: number) => value.toFixed(2) + "%";
    const contractLine = (c: typeof detailedContracts[number]) =>
      [c.contract, pct(c.completionPercent), fmt(c.totalStops), fmt(c.completedStops), fmt(c.incompleteStops),
       pct(c.regularTrips.completionPercent), pct(c.extraTrips.completionPercent), c.below95 ? "BELOW " + thresholdLabel : ""].join(" | ");
    const companyBody = [
      "Davenport Transportation — USPS Daily Performance Report",
      "Operating date: " + day,
      "Official overall completion: " + pct(result(overall).completionPercent),
      "Regular Trips: " + pct(result(regular).completionPercent),
      "Extra Trips: " + pct(result(extra).completionPercent),
      "",
      "Supervisor | Overall | Total stops | Completed | Incomplete",
      ...rankedDailySupervisors.map(s => [s.supervisor,pct(s.completionPercent),fmt(s.totalStops),fmt(s.completedStops),fmt(s.incompleteStops)].join(" | ")),
      "",
      "Contract | Overall | Total stops | Completed | Incomplete",
      ...rankedDailyContracts.map(s => [s.contract,pct(s.completionPercent),fmt(s.totalStops),fmt(s.completedStops),fmt(s.incompleteStops),
        s.totalStops > 0 && s.completionPercent < threshold ? "BELOW " + thresholdLabel : ""].join(" | ")),
      "", "DT Hub: https://dt-intelligence-hub.vercel.app/daily-reports",
    ].join("\n");

    // Outlook-compatible HTML, modeled on the dashboard Copy Email Report's
    // navy headers / green rankings / red needs-attention rows.
    // Both unassigned-trip sections and columns are deliberately omitted.
    const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const prettyDate = new Intl.DateTimeFormat("en-US", {
      month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
    }).format(new Date(day + "T12:00:00Z"));
    const htmlHeader = "background-color:#123b61;color:#ffffff;padding:9px;border:1px solid #d6dde3;text-align:left;font-family:Arial,sans-serif";
    const htmlCell = "padding:8px;border:1px solid #d6dde3;font-family:Arial,sans-serif;font-size:12px";
    const head = (headers: string[]) => "<thead><tr>" + headers.map(h => '<th bgcolor="#123b61" style="' + htmlHeader + '">' + esc(h) + "</th>").join("") + "</tr></thead>";
    const tr = (cells: string[], background = "") => "<tr" + (background ? ' bgcolor="' + background + '"' : "") + ">" +
      cells.map((value, i) => '<td style="' + htmlCell + (i === 0 ? ";font-weight:600" : ";text-align:right") + '">' + esc(value) + "</td>").join("") + "</tr>";
    const table = (headers: string[], rows: string) => '<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-bottom:16px">' +
      head(headers) + "<tbody>" + rows + "</tbody></table>";
    const shell = (heading: string, body: string) => '<div style="max-width:900px;margin:0 auto;background:#fff;color:#243746;font-family:Arial,sans-serif">' +
      '<div style="background:#123b61;color:#fff;padding:24px 28px"><div style="font-size:12px;font-weight:bold;letter-spacing:1px;color:#d7e2ec">DAVENPORT TRANSPORTATION</div>' +
      '<h2 style="margin:8px 0;color:#fff">' + esc(heading) + '</h2><div>' + esc(prettyDate) + ' - ' + esc(prettyDate) + '</div></div>' +
      '<div style="padding:24px 28px">' + body + '<p style="color:#6b7c8c;font-size:12px">Prepared in DT Intelligence Hub</p></div></div>';
    const h3 = (value: string) => '<h3 style="margin:26px 0 8px;color:#123b61">' + esc(value) + "</h3>";
    const summary = (value: number) => '<div style="display:inline-block;background:#eef2f5;border-left:5px solid #123b61;padding:12px 18px">' +
      '<span style="font-size:13px">Total Overall</span><br><strong style="font-size:26px;color:#123b61">' + pct(value) + '</strong></div>';
    const tripPair = (buckets: { regular: Stats; extra: Stats; unclassified: Stats } | undefined) =>
      [buckets?.regular.totalStops ? pct(result(buckets.regular).completionPercent) : "N/A",
       buckets?.extra.totalStops ? pct(result(buckets.extra).completionPercent) : "N/A"];
    const completionTable = (
      rows: Array<{ name: string; regular: string; extra: string; overall: string }>,
      highlight: "top5" | "bottom10",
    ) =>
      table(["Supervisor / Contract", "Regular Trips %", "Extra Trips %", "Overall Completion %"],
        rows.map((row, i) => tr(
          [row.name, row.regular, row.extra, row.overall],
          highlight === "top5" ? (i < 5 ? "#c9e7cf" : "") : (i < 10 ? "#f0c8cd" : ""),
        )).join(""));
    const supervisorPerformance = rankedDailySupervisors.map((s, i) => tr(
      [s.supervisor, fmt(s.totalStops), fmt(s.incompleteStops), pct(s.completionPercent)],
      i < 5 ? "#c9e7cf" : "")).join("");
    const contractPerformance = rankedDailyContracts.map((s, i) => tr(
      [s.contract, fmt(s.totalStops), fmt(s.completedStops), fmt(s.incompleteStops), pct(s.completionPercent)],
      i < 10 ? "#f0c8cd" : "")).join("");
    const companyHtml = shell("USPS Completion Report",
      summary(result(overall).completionPercent) +
      h3("Supervisor Performance") +
      table(["Supervisor", "Total Stops", "Missed Stops", "% Complete"], supervisorPerformance) +
      h3("All Contract Performance") +
      table(["Contract", "Total Stops", "Completed", "Missed Stops", "% Complete"], contractPerformance) +
      h3("Completion by Trip Type") +
      '<p style="font-size:12px">Regular and extra rates are based on completed stops divided by total stops for each category. Overall remains the official metric for rankings and thresholds.</p>' +
      '<p style="background:#eef2f5;padding:12px"><strong>Regular Trips: ' +
        (regular.totalStops ? pct(result(regular).completionPercent) : "N/A") + ' &nbsp; Extra Trips: ' +
        (extra.totalStops ? pct(result(extra).completionPercent) : "N/A") + ' &nbsp; Overall Completion: ' +
        pct(result(overall).completionPercent) + '</strong></p>' +
      '<h4>Supervisors</h4>' + completionTable(rankedDailySupervisors.map(s => {
        // The display-only James/Sidney combined label must use their shared
        // underlying stats, not a nonexistent map key.
        const statsKey = sameSharedPerformance && s.supervisor === "James Bowling / Sidney Williams"
          ? "James Bowling"
          : sameKevinBrucePerformance && s.supervisor === "Kevin Shields / Bruce Stevens"
            ? "Kevin Shields" : s.supervisor;
        const pair = tripPair(supervisorTripStats.get(statsKey));
        return { name: s.supervisor, regular: pair[0], extra: pair[1], overall: pct(s.completionPercent) };
      }), "top5") +
      '<h4>Contracts</h4>' + completionTable(rankedDailyContracts.map(s => {
        const pair = tripPair(contractTripStats.get(s.contract));
        return { name: s.contract, regular: pair[0], extra: pair[1], overall: pct(s.completionPercent) };
      }), "bottom10"));
    // Supervisors whose only activity is a historical correction still
    // deserve the update. Do not mislabel them as 0% for the current day.
    const reviewCandidates = [
      ...supervisorRows,
      ...[...previousDayBySupervisor.keys()]
        .filter(name => !supervisors.has(name))
        .map(supervisor => ({ ...result(zero()), supervisor })),
    ];
    const individualReviews = reviewCandidates
      .filter(s => s.supervisor !== "Unassigned" &&
        (s.totalStops > 0 || (previousDayBySupervisor.get(s.supervisor)?.length ?? 0) > 0))
      .map(s => {
        if (isTonya(s.supervisor)) return null;
        const assigned = detailedContracts.filter(c => c.supervisor === s.supervisor)
          .sort((a,b) => a.completionPercent - b.completionPercent || a.contract.localeCompare(b.contract));
        const failing = assigned.filter(c => c.below95);
        const overallBelow95 = s.totalStops > 0 && s.completionPercent < threshold;
        const priorUpdates = [...(previousDayBySupervisor.get(s.supervisor) ?? [])]
          .sort((a,b) => a.load.operating_date.localeCompare(b.load.operating_date) ||
            normalizeContract(a.load.contract_number).localeCompare(normalizeContract(b.load.contract_number), undefined, { numeric: true }) ||
            a.load.load_number.localeCompare(b.load.load_number));
        if (!overallBelow95 && failing.length === 0 && priorUpdates.length === 0) return null;
        const scoreExplanation = "Weekly % = total completed stops ÷ total stops. " +
          "Do not average daily percentages. Late FourKites updates count toward the original operating date.";
        const priorDescription = "FourKites reported these earlier-day loads on " + prettyDate +
          ". Dates and latest stop counts are below. Only verified changes show additional credit; " +
          "these stops are not added to today's total.";
        const priorRows = priorUpdates.map(({load, firstBefore, lastAfter}) => {
          const before = firstBefore?.event_type === "revised"
            ? fmt(Number(firstBefore.previous_completed_stops ?? 0)) + "/" + fmt(Number(firstBefore.previous_total_stops ?? 0))
            : "Not available";
          const after = fmt(load.completed_stops) + "/" + fmt(load.total_stops);
          const delta = firstBefore?.event_type === "revised"
            ? Number(lastAfter?.current_completed_stops ?? load.completed_stops) - Number(firstBefore.previous_completed_stops ?? 0)
            : null;
          const description = delta === null
            ? "Earlier-day load in latest FourKites report; no previous saved comparison"
            : delta > 0 ? "+" + fmt(delta) + " completed since previous saved result"
            : delta < 0 ? fmt(delta) + " completed after revision"
            : "Revised; completed count unchanged";
          return {
            originalDate: load.operating_date, contract: normalizeContract(load.contract_number),
            trip: String(load.trip_number ?? "") || "Unassigned", number: load.load_number,
            before, after, description,
          };
        });
        const priorHtml = priorRows.length
          ? h3("Previous-Day FourKites Updates") +
            '<p style="font-size:12px;line-height:1.5">' + esc(priorDescription) + '</p>' +
            table(["Original Operating Date", "FourKites Report Date", "Contract / Trip", "Load Number", "Previously Completed / Total", "Latest Completed / Total", "Update"],
              priorRows.map(row => tr([
                row.originalDate, day, row.contract + " / " + row.trip,
                row.number, row.before, row.after, row.description,
              ])).join(""))
          : "";
        const missedTrips = [...(supervisorMissedTrips.get(s.supervisor)?.values() ?? [])]
          .sort((a, b) => a.contract.localeCompare(b.contract, undefined, { numeric: true }) ||
            a.trip.localeCompare(b.trip, undefined, { numeric: true }));
        const notesForTrip = (item: MissedTripDetail) =>
          operationalNotes.filter(note => note.contract === item.contract && (!note.trip || note.trip === item.trip));
        const tripStatus = (item: MissedTripDetail) => {
          const notes = notesForTrip(item);
          return notes.some(note => note.status === "waiting_on_usps") ? "Waiting on USPS"
            : notes.some(note => note.status === "monitoring") ? "Monitoring"
            : notes.length ? "Documented context" : "Supervisor review";
        };
        const tripHtml = missedTrips.map(item => {
          const notes = notesForTrip(item);
          const noteHtml = notes.length
            ? '<tr><td colspan="6" style="background:#eef2f5;padding:8px;border:1px solid #d6dde3;font-size:11px">' +
              notes.map(note => '<strong>' + esc(note.status.replace(/_/g, " ")) + '</strong>: ' +
                esc(note.note) + (note.requestedOn ? ' (USPS request: ' + esc(note.requestedOn) + ')' : '')).join('<hr>') + '</td></tr>'
            : '';
          return tr([day, item.contract, item.trip, fmt(item.missed), tripStatus(item), item.loadNumbers.join(", ")]) + noteHtml;
        }).join("");
        return {
          supervisor: s.supervisor,
          overallCompletionPercent: s.totalStops ? s.completionPercent : null,
          overallBelow95,
          failingContractCount: failing.length,
          failingContracts: failing.map(c => c.contract),
          // The complete contract list is intentional, even for passing contracts.
          contracts: assigned,
          subject: "Performance Review — " + s.supervisor + " — " + prettyDate,
          html: shell("Supervisor Performance Review — " + s.supervisor,
            (s.totalStops ? summary(s.completionPercent) : '<p><strong>No current-day loads; this review is for prior-day FourKites updates.</strong></p>') +
            '<p style="font-size:12px;padding:11px 13px;background:#eef2f5;border-left:4px solid #123b61;line-height:1.5"><strong>How your percentage works:</strong> ' + esc(scoreExplanation) + '</p>' +
            '<p style="color:#742430;font-weight:bold">' + esc(overallBelow95 ? "Overall below " + thresholdLabel + "." : failing.length ? "At least one assigned contract below " + thresholdLabel + "." : "Prior-day update notice; no current-day performance issue triggered this review.") + "</p>" +
            h3("All Assigned Contracts") +
            table(["Contract", "Total Stops", "Completed", "Missed Stops", "Regular Trips %", "Extra Trips %", "% Complete"],
              assigned.map(x => tr([x.contract, fmt(x.totalStops), fmt(x.completedStops), fmt(x.incompleteStops),
                x.regularTrips.totalStops ? pct(x.regularTrips.completionPercent) : "N/A",
                x.extraTrips.totalStops ? pct(x.extraTrips.completionPercent) : "N/A", pct(x.completionPercent)],
                x.below95 ? "#f0c8cd" : "")).join("")) +
            h3("Incomplete Stops by Trip") +
            '<p style="font-size:12px">This is the affected trip and load detail from the Performance Review. A saved operational note provides context, not an independently verified cause.</p>' +
            (missedTrips.length
              ? table(["Operating Date", "Contract", "Trip", "Incomplete Stops", "Focus", "Load Numbers"], tripHtml)
              : '<p>No incomplete stops were recorded for this supervisor.</p>') +
            priorHtml,
          ),
          body: [
            "Davenport Transportation — Daily Supervisor Performance Review",
            "Operating date: " + day,
            "Supervisor: " + s.supervisor,
            "Official overall completion: " + (s.totalStops ? pct(s.completionPercent) : "No current-day loads"),
            "", "IMPORTANT — PERFORMANCE CALCULATION", scoreExplanation,
            "Reasons for review: " + [
              ...(overallBelow95 ? ["overall supervisor below " + thresholdLabel] : []),
              ...(failing.length ? ["contract(s) below " + thresholdLabel + ": " + failing.map(c => c.contract).join(", ")] : []),
              ...(priorRows.length ? ["earlier operating-day records appeared in this FourKites report"] : []),
            ].join("; "),
            "",
            "ALL ASSIGNED CONTRACTS (including those at or above " + thresholdLabel + ")",
            "Contract | Overall | Total stops | Completed | Incomplete | Regular Trips | Extra Trips | Review",
            ...assigned.map(contractLine),
            "", "INCOMPLETE STOPS BY TRIP",
            "Date | Contract | Trip | Incomplete Stops | Focus | Load Numbers",
            ...missedTrips.flatMap(item => [
              [day, item.contract, item.trip, String(item.missed), tripStatus(item), item.loadNumbers.join(", ")].join(" | "),
              ...notesForTrip(item).map(note => "Operational note (" + note.status + "): " + note.note),
            ]),
            ...(priorRows.length ? [
              "", "PREVIOUS-DAY FOURKITES UPDATES", priorDescription,
              "Original Date | FourKites Report Date | Contract / Trip | Load | Previous Completed / Total | Latest Completed / Total | Update",
              ...priorRows.map(row => [row.originalDate, day, row.contract + " / " + row.trip, row.number, row.before, row.after, row.description].join(" | ")),
            ] : []),
            "", "See DT Hub for detailed stop explanations and missing-load reviews.",
            "https://dt-intelligence-hub.vercel.app/missed-load-reviews",
          ].join("\n"),
        };
      }).filter((review): review is NonNullable<typeof review> => review !== null);
    const oversight = ["Gary", "Chasity Cochran", "Emily Stafford", "Amber Smith"];
    const emailByName = new Map((recipientRows ?? []).filter(row => row.enabled).map(row => [String(row.name).trim().toLowerCase(), String(row.email).trim().toLowerCase()]));
    const configuredOversightNames = new Set((recipientRows ?? []).map(row => String(row.name).trim().toLowerCase()));
    const missingOversightRecipients = oversight.filter(name => !configuredOversightNames.has(name.toLowerCase()));
    // STRICT DENYLIST: Tonya receives no daily, company-wide, or standard
    // supervisor emails. Her separately approved Monday-only report must use
    // a different, explicitly allowlisted workflow.
    const reviewDeliveryPreview = individualReviews.filter(review => !isTonya(review.supervisor, supervisorEmails[review.supervisor])).map(review => ({
      supervisor: review.supervisor,
      to: [...new Set([supervisorEmails[review.supervisor], ...oversight.map(name => emailByName.get(name.toLowerCase()))].filter((address): address is string => Boolean(address)))],
      subject: review.subject,
      html: review.html,
      failingContracts: review.failingContracts,
    }));
    const distributionRecipients = (recipientRows ?? []).filter(row => row.enabled && !isTonya(String(row.name), String(row.email)) && ["supervisor", "distribution"].includes(row.recipient_type))
      .map(row => String(row.email).trim().toLowerCase());
    const companyCcRecipients = (recipientRows ?? []).filter(row => row.enabled && !isTonya(String(row.name), String(row.email)) && row.recipient_type === "cc")
      .map(row => String(row.email).trim().toLowerCase());
    const companyBccRecipients = (recipientRows ?? []).filter(row => row.enabled && !isTonya(String(row.name), String(row.email)) && row.recipient_type === "bcc")
      .map(row => String(row.email).trim().toLowerCase());
    // Read-only preparation. These diagnostics must all be zero and upstream
    // completeness must be separately certified before future unattended sends.
    const routingValidated = assignmentFallbackContracts.size === 0 &&
      unmatchedSupervisorNames.size === 0 && missingOversightRecipients.length === 0;
    const workbookEvidence = snapshot.data?.sourceVerification;
    const workbookVerified = Boolean(
      workbookEvidence?.provenance === "authorized_fourkites_signed_workbook" &&
      workbookEvidence?.passed === true &&
      /^[a-f0-9]{64}$/.test(String(workbookEvidence?.sha256 ?? "")) &&
      workbookEvidence?.periodStart === day &&
      workbookEvidence?.periodEnd === day &&
      Number.isSafeInteger(workbookEvidence?.rawLoadRows) &&
      workbookEvidence.rawLoadRows >= expectedLoads &&
      Number(workbookEvidence?.targetDateRows) >= expectedLoads &&
      Number(workbookEvidence?.datedLoadRows) === Number(workbookEvidence?.rawLoadRows) &&
      String(snapshot.source_file).startsWith("TQ_DAILY_") &&
      snapshot.period_start === day && snapshot.period_end === day &&
      Number(matchingDay?.totalStops) === overall.totalStops &&
      Number(matchingDay?.completedStops) === overall.completedStops &&
      Number(matchingDay?.incompleteStops) === overall.incompleteStops &&
      loads.length === expectedLoads &&
      loads.every(load => {
        const total = Number(load.total_stops), completed = Number(load.completed_stops),
          incomplete = Number(load.incomplete_stops);
        return Number.isSafeInteger(total) && total >= 0 &&
          Number.isSafeInteger(completed) && completed >= 0 &&
          Number.isSafeInteger(incomplete) && incomplete >= 0 &&
          completed + incomplete === total;
      })
    );
    return NextResponse.json({
      ok: true, ready: true, date: day,
      importVerified: true,
      // Certifies the received, signed FourKites workbook and saved daily
      // contents agree. Does NOT guarantee every expected upstream trip
      // appeared in FourKites or that its tracking is accurate.
      sourceCompletenessCertified: workbookVerified,
      sourceCertificationScope: "received_signed_fourkites_workbook_only",
      sourceIntegrity: {
        dailyFile: String(snapshot.source_file).includes("TQ_DAILY_"),
        oneDayPeriod: snapshot.period_start === day && snapshot.period_end === day,
        importedLoadsMatchSnapshot: loads.length === expectedLoads,
        signedWorkbookEvidenceVerified: workbookVerified,
      },
      // Data is for an internal test preview only, not an authorization to send.
      sendAuthorized: false,
      emailSettings: { deliveryEnabled: settingsRow.delivery_enabled, companyEnabled: settingsRow.company_enabled, individualEnabled: settingsRow.individual_enabled, thresholdPercent: threshold },
      expectedLoads,
      overall: result(overall),
      regularTrips: result(regular),
      extraTrips: result(extra),
      unclassifiedTrips: result(unclassified),
      supervisors: supervisorRows,
      contracts: contractRows,
      supervisorContracts: supervisorContractsRows,
      below95Supervisors: under95.map(row => row.supervisor),
      companyEmail: { subject: "USPS Completion Report " + prettyDate + " - " + prettyDate, body: companyBody, html: companyHtml },
      individualReviews,
      individualReviewCount: individualReviews.length,
      // The reporting endpoint never authorizes delivery. Use a separate gated send workflow.
      recipientsValidated: routingValidated,
      routingChecks: {
        missingDatedAssignments: [...assignmentFallbackContracts].sort(),
        missingSupervisorEmails: [...unmatchedSupervisorNames].sort(),
        missingOversightRecipients,
      },
      companyDeliveryPreview: { to: [...new Set(distributionRecipients)], cc: [...new Set(companyCcRecipients)], bcc: [...new Set(companyBccRecipients)] },
      reviewDeliveryPreview,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, ready: false, error: "Could not produce verified daily report" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
