import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { processReport } from "@/lib/processors/reportProcessor";
import { automationDatabase, saveAutomatedFourKitesReport } from "@/lib/server/saveAutomatedFourKitesReport";

export const runtime = "nodejs";
export const maxDuration = 60;

const INKY_HOST = "shared.outlook.inky.com";
const S3_HOST = "production-files-backup.s3.amazonaws.com";
const S3_PATH = "/dwh/hadoop/subscriptions/";
const MAX_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 25000;

function authorized(request: Request) {
  const secret = process.env.AUTOMATION_INGEST_SECRET;
  const given = request.headers.get("x-dt-ingest-secret");
  if (!secret || !given) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isInkyLink(url: URL) {
  return url.protocol === "https:" &&
    url.hostname === INKY_HOST &&
    url.port === "" &&
    url.pathname === "/link" &&
    url.searchParams.get("domain") === S3_HOST &&
    Boolean(url.searchParams.get("t")) &&
    !url.username && !url.password;
}

function isApprovedWorkbookLink(url: URL) {
  return url.protocol === "https:" &&
    url.hostname === S3_HOST &&
    url.port === "" &&
    url.pathname.startsWith(S3_PATH) &&
    url.pathname.toLowerCase().endsWith(".xlsx") &&
    !url.username && !url.password &&
    Boolean(url.searchParams.get("Signature")) &&
    Boolean(url.searchParams.get("Expires"));
}

async function boundedBody(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error("Report exceeds the 20 MB limit");
  if (!response.body) throw new Error("Download returned no file body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error("Report exceeds the 20 MB limit");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return NextResponse.json({ ok: false, error: "JSON required" }, { status: 415 });
  }

  let input: { reportUrl?: unknown; mode?: unknown };
  try {
    input = await request.json() as { reportUrl?: unknown; mode?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof input.reportUrl !== "string" || input.reportUrl.length > 12000) {
    return NextResponse.json({ ok: false, error: "Report URL required" }, { status: 400 });
  }
  let original: URL;
  try {
    original = new URL(input.reportUrl.replace(/&amp;/g, "&"));
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid report URL" }, { status: 400 });
  }
  if (!isInkyLink(original)) {
    return NextResponse.json({ ok: false, error: "Link is not an approved FourKites INKY URL" }, { status: 422 });
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    const first = await fetch(original, {
      redirect: "manual",
      cache: "no-store",
      signal: abort.signal,
      headers: { "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*" },
    });
    if (first.status !== 303 && first.status !== 302) {
      return NextResponse.json({ ok: false, error: "The report link did not return an expected redirect", redirectStatus: first.status }, { status: 422 });
    }
    const location = first.headers.get("location");
    if (!location) {
      return NextResponse.json({ ok: false, error: "The redirect has no download destination" }, { status: 422 });
    }
    let destination: URL;
    try {
      destination = new URL(location);
    } catch {
      return NextResponse.json({ ok: false, error: "The download destination is malformed" }, { status: 422 });
    }
    if (!isApprovedWorkbookLink(destination)) {
      return NextResponse.json({ ok: false, error: "The redirect did not point to approved FourKites Excel storage" }, { status: 422 });
    }
    const expires = Number(destination.searchParams.get("Expires"));
    if (!Number.isFinite(expires) || expires * 1000 <= Date.now()) {
      return NextResponse.json({ ok: false, error: "The report link has expired" }, { status: 410 });
    }

    const fileResponse = await fetch(destination, { redirect: "manual", cache: "no-store", signal: abort.signal });
    if (fileResponse.status !== 200) {
      return NextResponse.json({ ok: false, error: "The workbook download did not succeed", downloadStatus: fileResponse.status }, { status: 422 });
    }
    const bytes = await boundedBody(fileResponse);
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
      return NextResponse.json({ ok: false, error: "The response is not an XLSX ZIP workbook" }, { status: 422 });
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(bytes, { type: "buffer" });
    } catch {
      return NextResponse.json({ ok: false, error: "Unable to read Excel workbook" }, { status: 422 });
    }
    const sheet = workbook.Sheets["Load Details"];
    if (!sheet) {
      return NextResponse.json({ ok: false, error: 'Workbook does not contain "Load Details"' }, { status: 422 });
    }
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { range: 4, defval: "" });
    const dates = new Map<string, number>();
    let validLoads = 0;
    for (const row of rows) {
      if (!String(row["Load Number"] ?? "").trim()) continue;
      validLoads++;
      const tags = String(row.Tags ?? "");
      const day = tags.match(/(?:^|,)(\d{4}-\d{2}-\d{2})(?:,|$)/)?.[1];
      if (day) dates.set(day, (dates.get(day) ?? 0) + 1);
    }
    if (validLoads === 0 || dates.size === 0) {
      return NextResponse.json({ ok: false, error: "No dated FourKites loads found" }, { status: 422 });
    }
    const filename = decodeURIComponent(destination.pathname.split("/").at(-1) ?? "fourkites.xlsx");
    const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
    // Count every dated source load by declared operating day. Prior-day
    // rows are expected and remain attributed to their own operating dates.
    const rawLoadRows = validLoads;
    const datedLoadRows = [...dates.values()].reduce((sum, count) => sum + count, 0);
    if (input.mode === "import") {
      if (process.env.AUTOMATION_IMPORT_ENABLED !== "true") {
        return NextResponse.json({ ok: false, error: "Automated database import is not enabled" }, { status: 409 });
      }
      const automationUserId = process.env.AUTOMATION_USER_ID;
      if (!automationUserId) {
        return NextResponse.json({ ok: false, error: "Automation importer identity is not configured" }, { status: 503 });
      }
      const db = automationDatabase();
      const { data: actor, error: actorError } = await db.auth.admin.getUserById(automationUserId);
      if (actorError || !actor.user || !actor.user.email?.toLowerCase().endsWith("@dtexpress.net")) {
        return NextResponse.json({ ok: false, error: "Automation importer must be an existing DT user" }, { status: 403 });
      }
      const [{ data: assignments, error: assignmentsError }, { data: periods, error: periodsError }] = await Promise.all([
        db.from("contract_supervisors").select("contract_number,supervisor"),
        db.from("contract_assignment_periods").select("contract_number,supervisor,start_date,end_date"),
      ]);
      if (assignmentsError || periodsError) {
        return NextResponse.json({ ok: false, error: "Unable to load supervisor assignments" }, { status: 503 });
      }
      const file = new File([new Uint8Array(bytes)], filename, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const parsed = await processReport(file, {
        assignments: (assignments ?? []) as Array<{contract_number:string|null;supervisor:string|null}>,
        assignmentPeriods: (periods ?? []) as Array<{contract_number:string;supervisor:string;start_date:string;end_date:string|null}>,
      });
      const sameFile = parsed.fileName === filename;
      const dailyNamed = filename.startsWith("TQ_DAILY_");
      const isOneDay = parsed.periodStart === parsed.periodEnd && Boolean(parsed.periodStart);
      const expectedDay = parsed.periodEnd;
      const dayInRawWorkbook = dates.get(expectedDay) ?? 0;
      const parsedDaily = parsed.daily.find(row => row.key === expectedDay);
      // Duplicates may occur in received workbooks; deduped load IDs must
      // reconcile with all source rows. We do not treat prior-day rows as
      // today's loads, or require the workbook to contain a single date.
      const parsedLoadCountMatches = parsed.historicalLoads.length + parsed.duplicateLoadNumbers.length === rawLoadRows;
      const parsedDayMatches = Boolean(parsedDaily && parsedDaily.loadCount > 0 &&
        parsedDaily.loadCount <= dayInRawWorkbook &&
        parsed.reportLoads.length === parsedDaily.loadCount);
      const allLoadMathValid = parsed.historicalLoads.every(load =>
        Number.isSafeInteger(load.totalStops) && load.totalStops >= 0 &&
        Number.isSafeInteger(load.completedStops) && load.completedStops >= 0 &&
        Number.isSafeInteger(load.incompleteStops) && load.incompleteStops >= 0 &&
        load.completedStops + load.incompleteStops === load.totalStops);
      const sourceVerified = sameFile && dailyNamed && isOneDay &&
        parsedLoadCountMatches && parsedDayMatches && allLoadMathValid &&
        rawLoadRows === datedLoadRows;
      const result = await saveAutomatedFourKitesReport(db, parsed, automationUserId, {
        sha256: sourceSha256, rawLoadRows, datedLoadRows,
        targetDateRows: dayInRawWorkbook, duplicateCount: parsed.duplicateLoadNumbers.length,
        periodStart: parsed.periodStart, periodEnd: parsed.periodEnd,
        passed: sourceVerified,
      });
      return NextResponse.json({
        ok: true,
        ...result,
        filename,
        loadCount: validLoads,
        loadsByOperatingDate: Object.fromEntries([...dates.entries()].sort(([a], [b]) => a.localeCompare(b))),
        // This establishes completeness relative to the received workbook,
        // not an independent guarantee of upstream FourKites coverage.
        receivedWorkbookVerified: sourceVerified,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({
      ok: true,
      status: "validated_not_imported",
      filename,
      bytes: bytes.length,
      loadCount: validLoads,
      loadsByOperatingDate: Object.fromEntries([...dates.entries()].sort(([a], [b]) => a.localeCompare(b))),
      message: "Downloaded and validated. No DT Hub records were modified.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("20 MB") ? "Report exceeds size limit" :
      "Unable to retrieve or validate the report";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
