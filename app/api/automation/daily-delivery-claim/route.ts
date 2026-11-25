import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { automationDatabase } from "@/lib/server/saveAutomatedFourKitesReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const expected = process.env.AUTOMATION_INGEST_SECRET;
  const actual = request.headers.get("x-dt-ingest-secret");
  if (!expected || !actual) return false;
  const a = Buffer.from(expected), b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}
function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const time = new Date(date + "T00:00:00Z");
  return Number.isFinite(time.valueOf()) && time.toISOString().slice(0, 10) === date;
}
type Key = {
  date: string; reportType: "company" | "individual"; supervisor: string; recipient: string;
};
function parseKey(input: Record<string, unknown>): Key | null {
  const date = String(input.date ?? "").trim();
  const reportType = String(input.reportType ?? "");
  const supervisor = String(input.supervisor ?? "").trim();
  const recipient = String(input.recipient ?? "").trim().toLowerCase();
  if (!validDate(date) || !["company","individual"].includes(reportType) ||
      (reportType === "company" && supervisor !== "") ||
      (reportType === "individual" && (!supervisor || supervisor.length > 150)) ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient) || recipient.length > 254) return null;
  if (/tonya\s*(capps|owens?)/i.test(supervisor) || recipient === "tocapps@bellsouth.net") return null;
  return { date, reportType: reportType as Key["reportType"], supervisor, recipient };
}
function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
async function validateRecipient(key: Key) {
  const db = automationDatabase();
  const { data, error } = await db.from("daily_report_recipients")
    .select("name,email,recipient_type,enabled").eq("enabled", true).eq("email", key.recipient);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.some(row => /tonya\s*(capps|owens?)/i.test(String(row.name)))) return false;
  if (key.reportType === "company") return rows.some(row => ["supervisor","distribution","cc","bcc"].includes(String(row.recipient_type)));
  // Individual review recipients: their own supervisor or the four approved
  // oversight contacts; never allow arbitrary directory addresses.
  return rows.some(row =>
    (row.recipient_type === "supervisor" && String(row.name).toLowerCase() === key.supervisor.toLowerCase()) ||
    (row.recipient_type === "distribution" && ["gary","chasity cochran","emily stafford","amber smith"].includes(String(row.name).toLowerCase())));
}
async function certified(date: string) {
  const db = automationDatabase();
  const { data, error } = await db.from("report_history")
    .select("data,period_start,period_end,source_file")
    .eq("report_type","usps_loads").eq("period_start",date).eq("period_end",date).limit(1);
  if (error) throw error;
  const snapshot = data?.[0];
  return Boolean(snapshot && String(snapshot.source_file).startsWith("TQ_DAILY_") &&
    snapshot.data?.sourceVerification?.provenance === "authorized_fourkites_signed_workbook" &&
    snapshot.data?.sourceVerification?.passed === true);
}
export async function POST(request: Request) {
  if (!authorized(request)) return response({ ok:false, error:"Unauthorized" },401);
  let input: Record<string,unknown>;
  try { input = await request.json() as Record<string,unknown>; }
  catch { return response({ok:false,error:"JSON required"},400); }
  const key = parseKey(input);
  if (!key) return response({ok:false,error:"Invalid delivery key"},400);
  // TEMPORARY CONTROLLED TEST ONLY: deny all other addresses and report types at the server.
  // Do not remove this guard until the authorized single-mailbox test passes.
  if (key.recipient !== "estafford@dtexpress.net" ||
      (key.reportType !== "company" && !(key.reportType === "individual" && key.supervisor === "Jerry Bradwell")))
    return response({ok:true,claimed:false,reason:"Temporary single-mailbox test restriction"});
  try {
    const db = automationDatabase();
    const {data: settings, error: settingsError} = await db.from("daily_email_settings")
      .select("delivery_enabled,company_enabled,individual_enabled").eq("id",1).single();
    if (settingsError || !settings) return response({ok:false,error:"Email settings unavailable"},503);
    if (!settings.delivery_enabled ||
        (key.reportType === "company" && !settings.company_enabled) ||
        (key.reportType === "individual" && !settings.individual_enabled))
      return response({ok:true,claimed:false,reason:"Delivery held in DT Hub"});
    if (!await validateRecipient(key)) return response({ok:true,claimed:false,reason:"Recipient is on hold or no longer authorized"});
    if (!await certified(key.date)) return response({ok:true,claimed:false,reason:"Workbook not certified"});
    // Atomic ON CONFLICT DO NOTHING. Two flow runs cannot both claim the
    // same date/report/supervisor/recipient.
    const { data, error } = await db.from("daily_report_deliveries")
      .upsert({
        operating_date:key.date, report_type:key.reportType, supervisor:key.supervisor,
        recipient_email:key.recipient, status:"pending",
      }, { onConflict:"operating_date,report_type,supervisor,recipient_email", ignoreDuplicates:true })
      .select("id,claim_token,status");
    if (error) throw error;
    const row = data?.[0];
    return response({ok:true,claimed:Boolean(row),deliveryId:row?.id ?? null,
      claimToken:row?.claim_token ?? null,
      reason:row ? "Reserved for sending" : "Already reserved or delivered"});
  } catch { return response({ok:false,error:"Delivery claim unavailable"},503); }
}
export async function PATCH(request: Request) {
  if (!authorized(request)) return response({ok:false,error:"Unauthorized"},401);
  let input: Record<string,unknown>;
  try { input = await request.json() as Record<string,unknown>; }
  catch { return response({ok:false,error:"JSON required"},400); }
  const id = Number(input.deliveryId);
  const token = String(input.claimToken ?? "");
  const status = String(input.status ?? "");
  if (!Number.isSafeInteger(id) || id <= 0 || !/^[a-f0-9-]{36}$/i.test(token) ||
      !["sent","failed"].includes(status))
    return response({ok:false,error:"Invalid completion data"},400);
  try {
    const db = automationDatabase();
    // A send status is marked only after the corresponding Outlook action
    // reports success. Failed/pending claims never retry automatically.
    const {data,error} = await db.from("daily_report_deliveries")
      .update({status, sent_at:status === "sent" ? new Date().toISOString():null})
      .eq("id",id).eq("claim_token",token).eq("status","pending")
      .select("id,status");
    if (error) throw error;
    return response({ok:true,updated:Boolean(data?.length)});
  } catch { return response({ok:false,error:"Delivery completion unavailable"},503); }
}
