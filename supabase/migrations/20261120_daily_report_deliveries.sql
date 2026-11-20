create table if not exists public.daily_report_deliveries (
 id bigint generated always as identity primary key,
 operating_date date not null,
 report_type text not null check (report_type in ('company','individual')),
 supervisor text not null default '',
 recipient_email text not null,
 status text not null check (status in ('pending','sent','failed','skipped')),
 provider_message_id text,
 error_message text,
 attempted_at timestamptz not null default now(),
 sent_at timestamptz,
 constraint daily_report_deliveries_unique unique (operating_date,report_type,supervisor,recipient_email)
);
create index if not exists daily_report_deliveries_recent_idx on public.daily_report_deliveries(operating_date desc, attempted_at desc);
alter table public.daily_report_deliveries enable row level security;
create policy "DT admins read daily email delivery audit" on public.daily_report_deliveries
for select to authenticated using (public.is_approved(array['admin']::text[]));
revoke all on public.daily_report_deliveries from anon,authenticated;
grant select on public.daily_report_deliveries to authenticated;
comment on table public.daily_report_deliveries is 'Read-only to DT app users. A future authorized Microsoft 365 dispatch integration records actual per-recipient sends using server-only credentials. Previewing never creates delivery rows.';