-- DT Intelligence Hub: Company-wide Load Master
-- Central operational record joining CLEAR, FourKites, Contract/SVC history and later USPS payments.
-- Safe to rerun in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.load_master (
  id uuid primary key default gen_random_uuid(),
  load_number text not null,
  service_date date not null,
  contract_number text,
  trip_number text,
  service_code text,
  service_class text not null default 'needs_review' check (service_class in ('regular','extra','adjustment_special','non_revenue','needs_review')),
  clear_present boolean not null default false,
  fourkites_present boolean not null default false,
  clear_miles numeric(12,3),
  fourkites_miles numeric(12,3),
  reconciled_miles numeric(12,3),
  operation_status text not null default 'needs_review' check (operation_status in ('operated','usps_cancelled','davenport_not_operated','extra_service','needs_review')),
  cancellation_reason text,
  payment_status text not null default 'not_checked' check (payment_status in ('not_checked','matched','not_matched','partial','duplicate','needs_review')),
  expected_payment numeric(14,2),
  actual_payment numeric(14,2),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(load_number, service_date)
);
create index if not exists load_master_contract_date_idx on public.load_master(contract_number, service_date desc);
create index if not exists load_master_trip_date_idx on public.load_master(contract_number, trip_number, service_date desc);
create index if not exists load_master_payment_idx on public.load_master(payment_status, service_date desc);
create index if not exists load_master_service_class_idx on public.load_master(service_class, service_date desc);

create table if not exists public.load_source_records (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.load_master(id) on delete cascade,
  source_system text not null check (source_system in ('clear','fourkites','usps_payment','manual')),
  source_file text,
  source_row_number integer,
  source_status text,
  source_service_code text,
  source_contract_number text,
  source_trip_number text,
  source_miles numeric(12,3),
  source_amount numeric(14,2),
  raw_data jsonb,
  imported_by uuid references auth.users(id),
  imported_at timestamptz not null default now()
);
create index if not exists load_source_records_load_idx on public.load_source_records(load_id, source_system);

create table if not exists public.load_service_code_rules (
  service_code text primary key,
  service_class text not null check (service_class in ('regular','extra','adjustment_special','non_revenue','needs_review')),
  description text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.load_service_code_rules(service_code, service_class, description)
values ('FEV','extra','Known USPS extra-service code'), ('FCU','extra','Known USPS extra-service code')
on conflict (service_code) do nothing;

create table if not exists public.load_status_events (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.load_master(id) on delete cascade,
  source_system text not null check (source_system in ('clear','fourkites','usps_payment','manual')),
  status text not null,
  reason text,
  event_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists load_status_events_load_idx on public.load_status_events(load_id, created_at desc);

alter table public.load_master enable row level security;
alter table public.load_source_records enable row level security;
alter table public.load_service_code_rules enable row level security;
alter table public.load_status_events enable row level security;

-- Use the Hub's existing user_permissions / has_app_permission model.
-- financial_permissions.sql created this function; do not introduce a second user table.
drop policy if exists load_master_read on public.load_master;
create policy load_master_read on public.load_master for select to authenticated using (true);
drop policy if exists load_source_records_read on public.load_source_records;
create policy load_source_records_read on public.load_source_records for select to authenticated using (true);
drop policy if exists load_service_code_rules_read on public.load_service_code_rules;
create policy load_service_code_rules_read on public.load_service_code_rules for select to authenticated using (true);
drop policy if exists load_status_events_read on public.load_status_events;
create policy load_status_events_read on public.load_status_events for select to authenticated using (true);

drop policy if exists load_master_insert on public.load_master;
create policy load_master_insert on public.load_master for insert to authenticated
  with check (public.has_app_permission('can_upload_reports') or public.has_app_permission('can_admin_users'));
drop policy if exists load_master_update on public.load_master;
create policy load_master_update on public.load_master for update to authenticated
  using (public.has_app_permission('can_upload_reports') or public.has_app_permission('can_admin_users'))
  with check (public.has_app_permission('can_upload_reports') or public.has_app_permission('can_admin_users'));

drop policy if exists load_source_records_insert on public.load_source_records;
create policy load_source_records_insert on public.load_source_records for insert to authenticated
  with check ((public.has_app_permission('can_upload_reports') or public.has_app_permission('can_admin_users')) and imported_by = auth.uid());

drop policy if exists load_status_events_insert on public.load_status_events;
create policy load_status_events_insert on public.load_status_events for insert to authenticated
  with check (public.has_app_permission('can_upload_reports') or public.has_app_permission('can_admin_users'));

comment on table public.load_master is 'One operational load record used across CLEAR, FourKites, contract history, extras/cancellations, and USPS payment reconciliation.';
comment on table public.load_source_records is 'Source evidence for each load; retain original CLEAR/FourKites/payment values for audit and discrepancy review.';
notify pgrst, 'reload schema';
