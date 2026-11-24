-- One durable claim per operating day/report/supervisor/recipient.
-- A pending claim intentionally blocks retries until an operator reconciles
-- whether Outlook actually sent the message; this favors no duplicates.
alter table public.daily_report_deliveries
  add column if not exists claim_token uuid not null default gen_random_uuid();
comment on column public.daily_report_deliveries.claim_token is
  'Server-only, unpredictable token returned on the first claim and required to mark that send complete.';
