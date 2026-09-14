import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type IntakeEnvelope = {
  sender?: string;
  subject?: string;
  messageId?: string;
  hasAttachments?: boolean;
};

const DAILY_SENDER = "fk-insights-subscriptions@fourkites.com";
const MISSED_STOPS_SENDER = "dev-alerts@fourkites.com";
const DAILY_SUBJECT = "fourkites insights subscription: davenport transportation inc - daily tracking quality report";
const MISSED_STOPS_SUBJECT = "usps carrier performance report - davenport transportation inc";

function authorized(request: Request) {
  const expected = process.env.AUTOMATION_INGEST_SECRET;
  const supplied = request.headers.get("x-dt-ingest-secret");
  if (!expected || !supplied) return false;

  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);
}

function normalizeSender(value: string) {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ accepted: false, error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json({ accepted: false, error: "JSON required" }, { status: 415 });
  }

  let envelope: IntakeEnvelope;
  try {
    envelope = await request.json() as IntakeEnvelope;
  } catch {
    return NextResponse.json({ accepted: false, error: "Invalid JSON" }, { status: 400 });
  }

  const sender = normalizeSender(String(envelope.sender ?? ""));
  const subject = String(envelope.subject ?? "").trim();
  const normalizedSubject = subject.toLowerCase();
  const messageId = String(envelope.messageId ?? "").trim();

  if (!messageId || messageId.length > 500) {
    return NextResponse.json({ accepted: false, error: "A valid message ID is required" }, { status: 400 });
  }

  if (sender === DAILY_SENDER && normalizedSubject.startsWith(DAILY_SUBJECT)) {
    return NextResponse.json({
      accepted: true,
      reportType: "usps_load_details",
      deliveryMethod: "verified_download_link",
      messageId,
      status: "recognized_only",
    });
  }

  if (sender === MISSED_STOPS_SENDER && normalizedSubject.startsWith(MISSED_STOPS_SUBJECT)) {
    if (!envelope.hasAttachments) {
      return NextResponse.json({
        accepted: false,
        error: "The missed-geofence email did not include an attachment",
      }, { status: 422 });
    }

    return NextResponse.json({
      accepted: true,
      reportType: "missed_geofences",
      deliveryMethod: "email_attachment",
      messageId,
      status: "recognized_only",
    });
  }

  return NextResponse.json({
    accepted: false,
    error: "Sender and subject are not on the approved report list",
  }, { status: 422 });
}
