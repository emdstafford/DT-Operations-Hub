# FourKites secure download — first-stage automation

This feature is **validation-only**, with no database writes or email sending. It does not change the manual FourKites importer or Payroll.

## Purpose

Power Automate's GET of an INKY-rewritten FourKites link returns HTTP 303 and surfaces the actual XLSX location in the `Location` header. This endpoint handles that redirect on the server with a restricted two-request sequence, then verifies the response is a real FourKites workbook.

## Required environment

- `AUTOMATION_INGEST_SECRET`: strong random secret in the **Vercel server-side environment**, not a `NEXT_PUBLIC_` variable. The existing `/api/automation/report-intake` also uses this secret. Do not add its value to GitHub or screenshots.
- HTTPS endpoint: `POST /api/automation/fourkites-download`.
- Header: `x-dt-ingest-secret: <secret>` and `Content-Type: application/json`.
- JSON: `{"reportUrl":"<dynamic Extract Report URL output>"}`.

Power Automate should enable **Secure Inputs and Secure Outputs** for the outgoing request, and should use the existing extracted original INKY link, not the sensitive S3 URL. Do not paste tokens into a test conversation.

## Expected response

`{ "ok": true, "status": "validated_not_imported", "filename": "...xlsx", "bytes": 12345, "loadCount": 1000, "loadsByOperatingDate": {"2026-11-19": 1000} }`

This confirms download and parsing only. **It does not add loads to DT Hub, change report history, or send emails.** Do not treat the response as a successful import, or update Teams wording to claim it was imported.

## Security restrictions

- Exact INKY host `shared.outlook.inky.com`, path `/link`, `domain` parameter matching the allowed S3 host, and a token.
- Expect only an HTTP 302/303 redirect.
- Exact destination host `production-files-backup.s3.amazonaws.com`, required `/dwh/hadoop/subscriptions/` prefix and `.xlsx` suffix, signed URL with unexpired `Expires`.
- No automatically followed redirect from S3.
- 20 MB limit, 25 second timeout, ZIP signature and `Load Details` worksheet check, at least one load with an operating date.
- Does not return raw download URLs, signed parameters, or workbook cells.
- Deploy only after reviewing with the company IT/security owner. Do not disable INKY.

## Next stage

After a verified dry run, build server-side import reusing the existing operating-date parser and preserve manual upload upsert semantics; add idempotency and upload audit before enabling mail delivery. The scheduled 7 AM flow must check import completion, not assume it.
