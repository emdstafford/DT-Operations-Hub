-- Restricted USPS trip and rate snapshots. Run in Supabase SQL Editor.
-- The browser imports validated active trip rows, not the source workbook.
create extension if not exists pgcrypto;

create table if not exists public.contract_financial_users (
  email text primary key,
  active boolean not null default true
);
revoke all on public.contract_financial_users from anon, authenticated;
insert into public.contract_financial_users(email, active) values
  ('estafford@dtexpress.net', true),
  ('ccochran@dtexpress.net', true),
  ('asmith@dtexpress.net', true)
on conflict (email) do nothing;

create or replace function public.is_contract_financial_user()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.contract_financial_users p
    where p.email = lower(auth.jwt() ->> 'email') and p.active
  ) and exists (
    select 1 from public.approved_users a
    where a.email = lower(auth.jwt() ->> 'email') and a.active
  );
$$;
revoke all on function public.is_contract_financial_user() from public;
grant execute on function public.is_contract_financial_user() to authenticated;

create table if not exists public.usps_contract_trip_snapshots (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null check (contract_number ~ '^[0-9A-Z]{5,6}$'),
  snapshot_date date not null,
  source_hash text not null check (length(source_hash) = 64),
  source_file text not null,
  trip_count integer not null check (trip_count > 0 and trip_count <= 1000),
  source_miles numeric not null check (source_miles > 0),
  source_hours numeric not null check (source_hours >= 0),
  scheduled_payment numeric not null check (scheduled_payment >= 0),
  term_days integer check (term_days is null or term_days between 1 and 366),
  trips jsonb not null check (jsonb_typeof(trips) = 'array' and jsonb_array_length(trips) = trip_count),
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique(contract_number, snapshot_date, source_hash)
);
create index if not exists usps_trip_snapshots_contract_date_idx
  on public.usps_contract_trip_snapshots(contract_number, snapshot_date desc, created_at desc);
alter table public.usps_contract_trip_snapshots enable row level security;
drop policy if exists "financial users read USPS trip snapshots" on public.usps_contract_trip_snapshots;
create policy "financial users read USPS trip snapshots" on public.usps_contract_trip_snapshots
  for select to authenticated using (public.is_contract_financial_user());
drop policy if exists "financial users add USPS trip snapshots" on public.usps_contract_trip_snapshots;
create policy "financial users add USPS trip snapshots" on public.usps_contract_trip_snapshots
  for insert to authenticated with check (public.is_contract_financial_user() and uploaded_by = auth.uid());
revoke all on public.usps_contract_trip_snapshots from anon, authenticated;
grant select, insert on public.usps_contract_trip_snapshots to authenticated;
notify pgrst, 'reload schema';
