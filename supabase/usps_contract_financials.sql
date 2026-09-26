-- USPS contract financial foundation
-- Phase 1: preserve imported contract/trip rates as effective-dated history.
-- Run after supabase/financial_permissions.sql.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table if not exists public.usps_rate_imports (
  id uuid primary key default gen_random_uuid(),
  source_file_name text not null,
  source_file_hash text,
  imported_by uuid not null default auth.uid(),
  imported_at timestamptz not null default now(),
  sheet_count integer not null default 0 check (sheet_count >= 0),
  trip_count integer not null default 0 check (trip_count >= 0),
  status text not null default 'completed'
    check (status in ('validating','completed','failed')),
  notes text
);

create table if not exists public.usps_contract_rate_versions (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null,
  effective_start date not null,
  effective_end date,
  source_import_id uuid references public.usps_rate_imports(id) on delete restrict,
  source_sheet_name text,
  contract_status text not null default 'active'
    check (contract_status in ('active','terminated','expired','unknown')),
  termination_note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint usps_contract_rate_version_dates
    check (effective_end is null or effective_end >= effective_start),
  constraint usps_contract_rate_version_unique
    unique (contract_number, effective_start)
);

create table if not exists public.usps_trip_rates (
  id uuid primary key default gen_random_uuid(),
  contract_rate_version_id uuid not null
    references public.usps_contract_rate_versions(id) on delete cascade,
  contract_number text not null,
  trip_number text not null,
  unit_cost numeric,
  annual_trip_cost numeric,
  calculated_rate_per_mile numeric,
  equipment_type text,
  frequency text,
  annual_trip_count numeric,
  wage_rate numeric,
  health_welfare_rate numeric,
  detention_rate numeric,
  per_trip_miles numeric,
  annual_miles numeric,
  fuel_type text,
  per_trip_hours numeric,
  source_row_number integer,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint usps_trip_rate_unique
    unique (contract_rate_version_id, trip_number),
  constraint usps_trip_rate_nonnegative check (
    coalesce(unit_cost,0) >= 0
    and coalesce(annual_trip_cost,0) >= 0
    and coalesce(calculated_rate_per_mile,0) >= 0
    and coalesce(annual_trip_count,0) >= 0
    and coalesce(per_trip_miles,0) >= 0
    and coalesce(annual_miles,0) >= 0
    and coalesce(per_trip_hours,0) >= 0
  )
);

create index if not exists usps_contract_rate_versions_contract_idx
  on public.usps_contract_rate_versions(contract_number, effective_start desc);

create index if not exists usps_trip_rates_contract_trip_idx
  on public.usps_trip_rates(contract_number, trip_number);

alter table public.usps_rate_imports enable row level security;
alter table public.usps_contract_rate_versions enable row level security;
alter table public.usps_trip_rates enable row level security;

drop policy if exists "rate viewers read imports" on public.usps_rate_imports;
create policy "rate viewers read imports" on public.usps_rate_imports
  for select to authenticated
  using (public.has_app_permission('can_view_rates'));

drop policy if exists "rate editors add imports" on public.usps_rate_imports;
create policy "rate editors add imports" on public.usps_rate_imports
  for insert to authenticated
  with check (
    public.has_app_permission('can_edit_rates')
    and imported_by = auth.uid()
  );

drop policy if exists "rate editors update imports" on public.usps_rate_imports;
create policy "rate editors update imports" on public.usps_rate_imports
  for update to authenticated
  using (public.has_app_permission('can_edit_rates'))
  with check (
    public.has_app_permission('can_edit_rates')
    and imported_by = auth.uid()
  );

drop policy if exists "rate viewers read contract versions" on public.usps_contract_rate_versions;
create policy "rate viewers read contract versions" on public.usps_contract_rate_versions
  for select to authenticated
  using (public.has_app_permission('can_view_rates'));

drop policy if exists "rate editors add contract versions" on public.usps_contract_rate_versions;
create policy "rate editors add contract versions" on public.usps_contract_rate_versions
  for insert to authenticated
  with check (
    public.has_app_permission('can_edit_rates')
    and created_by = auth.uid()
  );

drop policy if exists "rate editors update contract versions" on public.usps_contract_rate_versions;
create policy "rate editors update contract versions" on public.usps_contract_rate_versions
  for update to authenticated
  using (public.has_app_permission('can_edit_rates'))
  with check (
    public.has_app_permission('can_edit_rates')
    and created_by = auth.uid()
  );

drop policy if exists "rate viewers read trip rates" on public.usps_trip_rates;
create policy "rate viewers read trip rates" on public.usps_trip_rates
  for select to authenticated
  using (public.has_app_permission('can_view_rates'));

drop policy if exists "rate editors add trip rates" on public.usps_trip_rates;
create policy "rate editors add trip rates" on public.usps_trip_rates
  for insert to authenticated
  with check (public.has_app_permission('can_edit_rates'));

drop policy if exists "rate editors update trip rates" on public.usps_trip_rates;
create policy "rate editors update trip rates" on public.usps_trip_rates
  for update to authenticated
  using (public.has_app_permission('can_edit_rates'))
  with check (public.has_app_permission('can_edit_rates'));

revoke all on public.usps_rate_imports from anon;
revoke all on public.usps_contract_rate_versions from anon;
revoke all on public.usps_trip_rates from anon;

grant select, insert, update on public.usps_rate_imports to authenticated;
grant select, insert, update on public.usps_contract_rate_versions to authenticated;
grant select, insert, update on public.usps_trip_rates to authenticated;

create or replace function public.usps_contract_financial_summary(p_contract text)
returns table (
  contract_number text,
  effective_start date,
  effective_end date,
  contract_status text,
  trip_count bigint,
  annual_contract_revenue numeric,
  annual_contract_miles numeric,
  annual_trip_count numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_app_permission('can_view_rates') then
    raise exception 'Rate-view permission required' using errcode = '42501';
  end if;

  return query
  select
    v.contract_number,
    v.effective_start,
    v.effective_end,
    v.contract_status,
    count(t.id)::bigint,
    coalesce(sum(t.annual_trip_cost), 0),
    coalesce(sum(t.annual_miles), 0),
    coalesce(sum(t.annual_trip_count), 0)
  from public.usps_contract_rate_versions v
  left join public.usps_trip_rates t on t.contract_rate_version_id = v.id
  where v.contract_number = upper(trim(p_contract))
  group by v.id, v.contract_number, v.effective_start, v.effective_end, v.contract_status
  order by v.effective_start desc;
end;
$$;

revoke all on function public.usps_contract_financial_summary(text) from public;
grant execute on function public.usps_contract_financial_summary(text) to authenticated;

notify pgrst, 'reload schema';
