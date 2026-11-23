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

    // Prefer date-effective DT Hub assignments, then current assignments only
    // where no dated assignment is recorded for that contract.
    const [{ data: assignmentPeriods, error: periodsError }, { data: activeAssignments, error: assignmentsError },
      { data: recipientRows, error: recipientsError }] = await Promise.all([
      db.from("contract_assignment_periods").select("contract_number,supervisor,start_date,end_date")
        .lte("start_date", day).or(`end_date.is.null,end_date.gte.${day}`),
      db.from("contract_supervisors").select("contract_number,supervisor").eq("active", true),
      db.from("daily_report_recipients").select("name,email,recipient_type,enabled").eq("enabled", true),
    ]);
    if (periodsError || assignmentsError || recipientsError) throw new Error("Could not read reporting assignments");
    const normalizeContract = (value: string | null) => (value || "").trim().toUpperCase().replace(/^0+(?=[0-9])/, "");
    const recipientByName = new Map<string, string>();
    for (const row of recipientRows ?? []) {
      if (row.recipient_type === "supervisor" && row.email) recipientByName.set(String(row.name).trim().toLowerCase(), String(row.email).trim().toLowerCase());
    }
    const splitAssignment = (value: string) => {
      const label = value.trim();
      if (recipientByName.has(label.toLowerCase())) return [label];
      return label.split("/").map(name => name.trim()).filter(Boolean);
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
    for (const name of supervisors.keys()) {
      if (name === "Unassigned") continue;
      const email = recipientByName.get(name.trim().toLowerCase());
      if (email) supervisorEmails[name] = email;
      else unmatchedSupervisorNames.add(name);
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
    const completionTable = (rows: Array<{ name: string; regular: string; extra: string; overall: string }>) =>
      table(["Supervisor / Contract", "Regular Trips %", "Extra Trips %", "Overall Completion %"],
        rows.map(row => tr([row.name, row.regular, row.extra, row.overall])).join(""));
    const supervisorPerformance = supervisorRows.map((s, i) => tr(
      [s.supervisor, fmt(s.totalStops), fmt(s.incompleteStops), pct(s.completionPercent)],
      i < 5 ? "#c9e7cf" : "")).join("");
    const contractPerformance = contractRows.map((s) => tr(
      [s.contract, fmt(s.totalStops), fmt(s.completedStops), fmt(s.incompleteStops), pct(s.completionPercent)],
      s.totalStops > 0 && s.completionPercent < 95 ? "#f0c8cd" : "")).join("");
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
      '<h4>Supervisors</h4>' + completionTable(supervisorRows.map(s => {
        const pair = tripPair(supervisorTripStats.get(s.supervisor));
        return { name: s.supervisor, regular: pair[0], extra: pair[1], overall: pct(s.completionPercent) };
      })) +
      '<h4>Contracts</h4>' + completionTable(contractRows.map(s => {
        const pair = tripPair(contractTripStats.get(s.contract));
        return { name: s.contract, regular: pair[0], extra: pair[1], overall: pct(s.completionPercent) };
      })));
    const individualReviews = supervisorRows
      .filter(s => s.supervisor !== "Unassigned" && s.totalStops > 0)
      .map(s => {
        if (s.supervisor.trim().toLowerCase() === "tonya capps owen") return null;
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
          subject: "Performance Review — " + s.supervisor + " — " + prettyDate,
          html: shell("Supervisor Performance Review — " + s.supervisor,
            summary(s.completionPercent) +
            '<p style="color:#742430;font-weight:bold">' + esc(overallBelow95 ? "Overall below 95%." : "At least one assigned contract below 95%.") + "</p>" +
            h3("All Assigned Contracts") +
            table(["Contract", "Total Stops", "Completed", "Missed Stops", "Regular Trips %", "Extra Trips %", "% Complete"],
              assigned.map(x => tr([x.contract, fmt(x.totalStops), fmt(x.completedStops), fmt(x.incompleteStops),
                x.regularTrips.totalStops ? pct(x.regularTrips.completionPercent) : "N/A",
                x.extraTrips.totalStops ? pct(x.extraTrips.completionPercent) : "N/A", pct(x.completionPercent)],
                x.below95 ? "#f0c8cd" : "")).join("")),
          ),
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
          ].join("\n"),
        };
      }).filter((review): review is NonNullable<typeof review> => review !== null);
    const oversight = ["Gary", "Chasity Cochran", "Emily Stafford", "Amber Smith"];
    const emailByName = new Map((recipientRows ?? []).map(row => [String(row.name).trim().toLowerCase(), String(row.email).trim().toLowerCase()]));
    const missingOversightRecipients = oversight.filter(name => !emailByName.has(name.toLowerCase()));
    const reviewDeliveryPreview = individualReviews.map(review => ({
      supervisor: review.supervisor,
      to: [...new Set([supervisorEmails[review.supervisor], ...oversight.map(name => emailByName.get(name.toLowerCase()))].filter((address): address is string => Boolean(address)))],
      subject: review.subject,
      html: review.html,
      failingContracts: review.failingContracts,
    }));
    const isTonya = (name: string) => name.trim().toLowerCase() === "tonya capps owen";
    const distributionRecipients = (recipientRows ?? []).filter(row => !isTonya(String(row.name)) && ["supervisor", "distribution"].includes(row.recipient_type))
      .map(row => String(row.email).trim().toLowerCase());
    const companyCcRecipients = (recipientRows ?? []).filter(row => !isTonya(String(row.name)) && row.recipient_type === "cc")
      .map(row => String(row.email).trim().toLowerCase());
    const companyBccRecipients = (recipientRows ?? []).filter(row => !isTonya(String(row.name)) && row.recipient_type === "bcc")
      .map(row => String(row.email).trim().toLowerCase());
    // Read-only preparation. These diagnostics must all be zero and upstream
    // completeness must be separately certified before future unattended sends.
    const routingValidated = assignmentFallbackContracts.size === 0 &&
      unmatchedSupervisorNames.size === 0 && missingOversightRecipients.length === 0;
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
