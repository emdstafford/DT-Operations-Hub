-- Secure Comdata fuel reporting for DT Intelligence Hub.
-- Run this entire file once in the Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.fuel_tool_users (
  email text primary key,
  can_upload boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.fuel_tool_users (email, can_upload, active) values
  ('estafford@dtexpress.net', true, true),
  ('ccochran@dtexpress.net', true, true),
  ('rcoffey@dtexpress.net', true, true),
  ('slunsford@dtexpress.net', true, true)
on conflict (email) do update
set can_upload = excluded.can_upload,
    active = excluded.active;

alter table public.fuel_tool_users enable row level security;

create or replace function public.is_fuel_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fuel_tool_users u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and u.active
  );
$$;

create or replace function public.can_upload_fuel()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fuel_tool_users u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and u.active
      and u.can_upload
  );
$$;

drop policy if exists "fuel users read own access" on public.fuel_tool_users;
create policy "fuel users read own access"
on public.fuel_tool_users for select to authenticated
using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create table if not exists public.fuel_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_hash text not null unique,
  period_start date not null,
  period_end date not null,
  source_row_count integer not null default 0,
  inserted_row_count integer not null default 0,
  transaction_count integer not null default 0,
  total_fuel_gallons numeric not null default 0,
  total_net_cost numeric not null default 0,
  uploaded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.fuel_transactions (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.fuel_imports(id) on delete cascade,
  unique_key text not null unique,
  transaction_group_key text not null,
  account_code text,
  customer_id text,
  invoice_number text,
  transaction_number text,
  transaction_date date not null,
  transaction_time text,
  posted_date date,
  person_name text not null default 'Unassigned',
  contract_number text not null default 'Unassigned',
  merchant_name text not null default 'Unknown station',
  merchant_city text,
  merchant_state text,
  merchant_postal_code text,
  vehicle_number text,
  employee_number text,
  product_description text not null default 'Unknown',
  product_category text not null default 'other'
    check (product_category in ('diesel','gasoline','def','fee','adjustment','other')),
  unit_gallons numeric not null default 0,
  price_per_unit numeric not null default 0,
  gross_cost numeric not null default 0,
  discount numeric not null default 0,
  net_cost numeric not null default 0,
  odometer numeric,
  miles_driven numeric,
  created_at timestamptz not null default now()
);

create index if not exists fuel_transactions_date_idx on public.fuel_transactions (transaction_date);
create index if not exists fuel_transactions_contract_idx on public.fuel_transactions (contract_number, transaction_date);
create index if not exists fuel_transactions_person_idx on public.fuel_transactions (person_name, transaction_date);
create index if not exists fuel_transactions_station_idx on public.fuel_transactions (merchant_name, transaction_date);
create index if not exists fuel_transactions_category_idx on public.fuel_transactions (product_category, transaction_date);

alter table public.fuel_imports enable row level security;
alter table public.fuel_transactions enable row level security;

drop policy if exists "fuel users read imports" on public.fuel_imports;
create policy "fuel users read imports" on public.fuel_imports
for select to authenticated using (public.is_fuel_user());

drop policy if exists "fuel uploaders add imports" on public.fuel_imports;
create policy "fuel uploaders add imports" on public.fuel_imports
for insert to authenticated with check (public.can_upload_fuel() and uploaded_by = auth.uid());

drop policy if exists "fuel uploaders update imports" on public.fuel_imports;
create policy "fuel uploaders update imports" on public.fuel_imports
for update to authenticated using (public.can_upload_fuel() and uploaded_by = auth.uid())
with check (public.can_upload_fuel() and uploaded_by = auth.uid());

drop policy if exists "fuel uploaders remove own imports" on public.fuel_imports;
create policy "fuel uploaders remove own imports" on public.fuel_imports
for delete to authenticated using (public.can_upload_fuel() and uploaded_by = auth.uid());

drop policy if exists "fuel users read transactions" on public.fuel_transactions;
create policy "fuel users read transactions" on public.fuel_transactions
for select to authenticated using (public.is_fuel_user());

drop policy if exists "fuel uploaders add transactions" on public.fuel_transactions;
create policy "fuel uploaders add transactions" on public.fuel_transactions
for insert to authenticated with check (
  public.can_upload_fuel()
  and exists (
    select 1 from public.fuel_imports i
    where i.id = import_id and i.uploaded_by = auth.uid()
  )
);

revoke all on public.fuel_tool_users, public.fuel_imports, public.fuel_transactions from anon;
grant select on public.fuel_tool_users to authenticated;
grant select, insert, update, delete on public.fuel_imports to authenticated;
grant select, insert on public.fuel_transactions to authenticated;
grant usage, select on sequence public.fuel_transactions_id_seq to authenticated;

create or replace function public.fuel_filter_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_fuel_user() then
    raise exception 'Approved fuel-report account required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'period_start', (select min(transaction_date) from public.fuel_transactions),
    'period_end', (select max(transaction_date) from public.fuel_transactions),
    'contracts', coalesce((select jsonb_agg(contract_number order by contract_number) from (select distinct contract_number from public.fuel_transactions) x), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(person_name order by person_name) from (select distinct person_name from public.fuel_transactions) x), '[]'::jsonb),
    'stations', coalesce((select jsonb_agg(merchant_name order by merchant_name) from (select distinct merchant_name from public.fuel_transactions) x), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.fuel_dashboard(
  p_start date,
  p_end date,
  p_grain text default 'week',
  p_contract text default null,
  p_person text default null,
  p_station text default null,
  p_category text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_fuel_user() then
    raise exception 'Approved fuel-report account required' using errcode = '42501';
  end if;

  with filtered as (
    select *,
      case
        when p_grain = 'month' then date_trunc('month', transaction_date)::date
        when p_grain = 'day' then transaction_date
        else (date_trunc('week', transaction_date + 2) - interval '2 days')::date
      end as period_start
    from public.fuel_transactions
    where transaction_date between p_start and p_end
      and (p_contract is null or contract_number = p_contract)
      and (p_person is null or person_name = p_person)
      and (p_station is null or merchant_name = p_station)
      and (p_category is null or product_category = p_category)
  ), totals as (
    select
      count(*)::integer as line_items,
      count(distinct transaction_group_key)::integer as transactions,
      coalesce(sum(net_cost),0) as total_spend,
      coalesce(sum(unit_gallons) filter (where product_category in ('diesel','gasoline')),0) as fuel_gallons,
      coalesce(sum(net_cost) filter (where product_category in ('diesel','gasoline')),0) as fuel_cost,
      coalesce(sum(net_cost) filter (where product_category = 'gasoline'),0) as gasoline_spend,
      count(*) filter (where product_category = 'gasoline')::integer as gasoline_lines,
      coalesce(sum(unit_gallons) filter (where product_category = 'gasoline'),0) as gasoline_gallons
    from filtered
  )
  select jsonb_build_object(
    'totals', (select to_jsonb(t) || jsonb_build_object('average_price_per_gallon', case when fuel_gallons = 0 then 0 else fuel_cost / fuel_gallons end) from totals t),
    'trend', coalesce((select jsonb_agg(to_jsonb(x) order by x.period_start) from (
      select period_start, count(distinct transaction_group_key)::integer as transactions,
        sum(unit_gallons) filter (where product_category in ('diesel','gasoline')) as fuel_gallons,
        sum(net_cost) as total_spend
      from filtered group by period_start
    ) x), '[]'::jsonb),
    'by_contract', coalesce((select jsonb_agg(to_jsonb(x) order by x.total_spend desc) from (
      select contract_number as name, count(distinct transaction_group_key)::integer as transactions,
        sum(unit_gallons) filter (where product_category in ('diesel','gasoline')) as fuel_gallons,
        sum(net_cost) as total_spend,
        sum(net_cost) filter (where product_category = 'gasoline') as gasoline_spend
      from filtered group by contract_number
    ) x), '[]'::jsonb),
    'by_person', coalesce((select jsonb_agg(to_jsonb(x) order by x.total_spend desc) from (
      select person_name as name, count(distinct transaction_group_key)::integer as transactions,
        sum(unit_gallons) filter (where product_category in ('diesel','gasoline')) as fuel_gallons,
        sum(net_cost) as total_spend,
        sum(net_cost) filter (where product_category = 'gasoline') as gasoline_spend
      from filtered group by person_name
    ) x), '[]'::jsonb),
    'by_station', coalesce((select jsonb_agg(to_jsonb(x) order by x.total_spend desc) from (
      select merchant_name as name, merchant_city as city, merchant_state as state,
        count(distinct transaction_group_key)::integer as transactions,
        sum(unit_gallons) filter (where product_category in ('diesel','gasoline')) as fuel_gallons,
        sum(net_cost) as total_spend
      from filtered group by merchant_name, merchant_city, merchant_state
    ) x), '[]'::jsonb),
    'by_product', coalesce((select jsonb_agg(to_jsonb(x) order by x.total_spend desc) from (
      select product_category as name, count(*)::integer as line_items,
        sum(unit_gallons) as units, sum(net_cost) as total_spend
      from filtered group by product_category
    ) x), '[]'::jsonb),
    'gasoline_alerts', coalesce((select jsonb_agg(to_jsonb(x) order by x.transaction_date desc, x.net_cost desc) from (
      select transaction_date, person_name, contract_number, merchant_name, merchant_city, merchant_state,
        vehicle_number, product_description, unit_gallons, price_per_unit, net_cost
      from filtered where product_category = 'gasoline'
      order by transaction_date desc, net_cost desc limit 250
    ) x), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

grant execute on function public.fuel_filter_options() to authenticated;
grant execute on function public.fuel_dashboard(date,date,text,text,text,text,text) to authenticated;
