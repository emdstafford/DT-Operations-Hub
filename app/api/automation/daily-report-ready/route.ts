import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { automationDatabase } from "@/lib/server/saveAutomatedFourKitesReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.AUTOMATION_INGEST_SECRET;
  const provided = request.headers.get("x-dt-ingest-secret");
  if (!secret || !provided) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function validDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(day + "T00:00:00.000Z");
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === day;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, ready: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const day = url.searchParams.get("date") ?? "";
  if (!validDay(day)) {
    return NextResponse.json({ ok: false, ready: false, error: "Valid date (yyyy-MM-dd) required" }, { status: 400 });
  }
  try {
    const db = automationDatabase();
    // Only an import whose declared reporting period ENDS on this operating
    // date qualifies. Arbitrary historical rows are not a readiness signal.
    const { data: reports, error: reportError } = await db.from("report_history")
      .select("period_start,period_end,source_file,updated_at,data")
      .eq("report_type", "usps_loads")
      .eq("period_end", day)
      .lte("period_start", day)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (reportError) throw reportError;
    const report = reports?.[0];
    const daily = Array.isArray(report?.data?.daily) ? report.data.daily : [];
    const selected = daily.find((row: { key?: unknown }) => row.key === day);
    const expected = Number(selected?.loadCount ?? 0);
    if (!report || !report.source_file || !Number.isSafeInteger(expected) || expected <= 0) {
      return NextResponse.json({
        ok: true, ready: false, date: day,
        reason: "No verified dated daily import snapshot is available",
      }, { headers: { "Cache-Control": "no-store" } });
    }
    // Verify the source-specific rows persisted; avoid accepting rows from
    // an earlier upload or other file as completion of the current report.
    const { count, error: countError } = await db.from("usps_loads")
      .select("load_number", { head: true, count: "exact" })
      .eq("operating_date", day)
      .eq("source_file", report.source_file)
      .eq("source_period_end", day);
    if (countError) throw countError;
    const actual = count ?? 0;
    const ready = actual === expected;
    return NextResponse.json({
      ok: true, ready, date: day,
      status: ready ? "import_verified" : "import_incomplete",
      expectedLoads: expected, savedLoads: actual,
      // This verifies a dated import, NOT whether FourKites issued every
      // expected file or whether the email-delivery process has succeeded.
      sourceCompletenessCertified: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { ok: false, ready: false, error: "Unable to verify daily report readiness" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
