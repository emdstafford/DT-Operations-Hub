# Daily FourKites → Outlook → Teams automation handoff

Status: **Microsoft 365 not connected; no unattended sends enabled**.

## Required Microsoft connection

The owner of `estafford@dtexpress.net` must authorize a Power Automate Office 365 Outlook connection. Sending uses **Send an email from a shared mailbox (V2)** with mailbox `it@dtexpress.net`, after verifying Send As permissions. The Teams connector must be authorized to post in a **group chat with Emily and Chasity** (not a private channel).

Microsoft reference:
- Outlook connector: https://learn.microsoft.com/en-us/connectors/office365/
- Teams group chat: https://learn.microsoft.com/en-us/power-automate/teams/send-a-message-in-teams
- Email trigger: https://learn.microsoft.com/en-us/power-automate/email-triggers

## Flow A — inbound FourKites

1. Trigger: **When a new email arrives (V3)** in Emily's Outlook Inbox. Require an attachment; filter using the **actual sender address and filename**, confirmed from a real FourKites message (not yet provided).
2. Get each Excel attachment with **Get Attachment (V2)**; require recognized FourKites `.xlsx`, **Load Details** and **Summary** sheets.
3. Validate operating dates and report completeness. File-arrival time alone does **not** prove completeness.
4. Import into DT Hub via a new authenticated server-side ingestion service preserving current `processReport`/historical and supervisor-assignment semantics. The present upload code runs **in the signed-in browser** and is **not** an unattended endpoint. This service has **not yet been implemented**.
5. Record email message ID + attachment ID/hash and report period to avoid reimport on retries.

## Flow B — 7 AM Eastern distribution

1. Recurrence: daily `07:00` **Eastern Standard Time** (automatically adjusts for daylight saving). Calculate previous calendar day in that timezone.
2. Await a **completed validated import** for previous day. Do not mistake nonzero historical rows for a complete daily file.
3. Build a single company-wide report (all enabled supervisors + Gary, Chasity, Emily, Sabrina as To; Rachelle and Cindy BCC), plus individual below-95% reports (the affected supervisor and Gary, Emily, Chasity).
4. Send from `it@dtexpress.net` using Outlook shared-mailbox action, **only after an internal test to Emily/Chasity**.
5. Record one row per recipient in `daily_report_deliveries` with actual success/failure from Outlook. This table is read-only from the browser; only a future authenticated server integration can write. Enforce idempotency using unique `(operating_date,report_type,supervisor,recipient_email)`.
6. Post a **Teams group chat** digest with date, company report accepted by Outlook, count of individual reports, supervisor names/percentages, failed-send counts, and link to `https://dt-intelligence-hub.vercel.app/daily-reports`. Never report `sent` unless the connector successfully accepted the send.
7. If import is absent or incomplete at 7 AM: skip sends, email + Teams alert to Emily and Chasity, and retry after a validated import. If email actions fail, record error and send Teams warning without claiming full success.
8. Do not send a weekly aggregate on Monday; the user's newer specification replaces the weekly report with a **daily previous-day report seven days a week**.

## Existing DT Hub artifacts

- `/daily-reports`: admin-only preview of one day, recipient directory, and **actual** delivery audit (empty until sender integration).
- `daily_report_recipients`: admin-accessible roster; confirm addresses with Emily, especially personal email accounts.
- `daily_report_deliveries`: admin-only read, no client writes. No send functionality here yet.
- `dashboard_hub_filtered`: calculate period-specific supervisor and contract results.
- `processReport` + `saveReportSnapshot`: browser upload; MUST be safely refactored and tested before any external import can be enabled.
- Payroll intentionally untouched.

## Activation gate

Do **not** enable an unattended flow until: a real inbound FourKites message and sample workbook are inspected, an authenticated import path exists, recipient mapping is verified, Outlook and Teams permissions work, end-to-end test sends to only Emily/Chasity, and duplicate/failure behavior is tested.
