-- Contract fuel planning. Run after fuel_reports.sql and fuel_supervisor_reports.sql.
-- Plan revisions get their own effective dates; existing fuel rows are untouched.
create extension if not exists btree_gist;

create table if not exists public.fuel_contract_mileage_plans (
  contract_number text not null,
  effective_start date not null,
  effective_end date,
  annual_miles numeric not null check (annual_miles > 0),
  assumed_mpg numeric not null check (assumed_mpg > 0),
  alert_above_percent numeric not null default 15 check (alert_above_percent between 0 and 200),
  updated_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (contract_number, effective_start),
  constraint fuel_mileage_plan_dates check (effective_end is null or effective_end >= effective_start),
  constraint fuel_mileage_plan_no_overlap exclude using gist (
    contract_number with =,
    daterange(effective_start, coalesce(effective_end, 'infinity'::date), '[]') with &&
  )
);

alter table public.fuel_contract_mileage_plans enable row level security;
drop policy if exists "fuel users read mileage plans" on public.fuel_contract_mileage_plans;
create policy "fuel users read mileage plans" on public.fuel_contract_mileage_plans
  for select to authenticated using (public.is_fuel_user());
drop policy if exists "fuel uploaders add mileage plans" on public.fuel_contract_mileage_plans;
create policy "fuel uploaders add mileage plans" on public.fuel_contract_mileage_plans
  for insert to authenticated with check (public.can_upload_fuel() and updated_by = auth.uid());
drop policy if exists "fuel uploaders edit mileage plans" on public.fuel_contract_mileage_plans;
create policy "fuel uploaders edit mileage plans" on public.fuel_contract_mileage_plans
  for update to authenticated using (public.can_upload_fuel())
  with check (public.can_upload_fuel() and updated_by = auth.uid());

revoke all on public.fuel_contract_mileage_plans from anon;
grant select, insert, update on public.fuel_contract_mileage_plans to authenticated;

-- Return actual purchases independently of station/employee/category UI filters.
-- Only diesel and gasoline count toward mileage; DEF and fees are excluded.
create or replace function public.fuel_contract_purchases_for_estimate(
  p_start date, p_end date, p_contracts text[]
)
returns table (contract_number text, purchased_gallons numeric, purchased_fuel_cost numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_fuel_user() then
    raise exception 'Approved fuel-report account required' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_start > p_end
    or p_end - p_start > 3660
    or coalesce(cardinality(p_contracts),0) > 200 then
    raise exception 'Invalid fuel estimate date range or contract selection' using errcode = '22023';
  end if;
  return query
  select f.contract_number, coalesce(sum(f.unit_gallons),0), coalesce(sum(f.net_cost),0)
  from public.fuel_transactions f
  where f.transaction_date between p_start and p_end
    and f.contract_number = any(p_contracts)
    and f.product_category in ('diesel','gasoline')
  group by f.contract_number;
end;
$$;

revoke all on function public.fuel_contract_purchases_for_estimate(date,date,text[]) from public;
grant execute on function public.fuel_contract_purchases_for_estimate(date,date,text[]) to authenticated;
notify pgrst, 'reload schema';
