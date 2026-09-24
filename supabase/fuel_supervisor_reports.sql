-- Monthly supervisor reporting and employee fuel controls.
-- Run this entire file once after fuel_reports.sql.

create table if not exists public.fuel_employee_rules (
  person_name text primary key,
  gasoline_authorized boolean not null default false,
  monthly_spend_limit numeric check (monthly_spend_limit is null or monthly_spend_limit >= 0),
  notes text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.fuel_employee_rules enable row level security;

drop policy if exists "fuel users read employee rules" on public.fuel_employee_rules;
create policy "fuel users read employee rules" on public.fuel_employee_rules
for select to authenticated using (public.is_fuel_user());

drop policy if exists "fuel uploaders add employee rules" on public.fuel_employee_rules;
create policy "fuel uploaders add employee rules" on public.fuel_employee_rules
for insert to authenticated with check (public.can_upload_fuel() and updated_by = auth.uid());

drop policy if exists "fuel uploaders update employee rules" on public.fuel_employee_rules;
create policy "fuel uploaders update employee rules" on public.fuel_employee_rules
for update to authenticated using (public.can_upload_fuel())
with check (public.can_upload_fuel() and updated_by = auth.uid());

revoke all on public.fuel_employee_rules from anon;
grant select, insert, update on public.fuel_employee_rules to authenticated;

create or replace function public.fuel_filter_options_v2()
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
    'contracts', coalesce((select jsonb_agg(contract_number order by contract_number) from (select distinct contract_number from public.fuel_transactions where contract_number <> '') x), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(person_name order by person_name) from (select distinct person_name from public.fuel_transactions where person_name <> '') x), '[]'::jsonb),
    'stations', coalesce((select jsonb_agg(merchant_name order by merchant_name) from (select distinct merchant_name from public.fuel_transactions where merchant_name <> '') x), '[]'::jsonb),
    'supervisors', coalesce((
      select jsonb_agg(supervisor order by supervisor)
      from (
        select distinct supervisor from public.contract_supervisors where supervisor is not null and supervisor <> ''
        union
        select distinct supervisor from public.contract_assignment_periods where supervisor is not null and supervisor <> ''
      ) x
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.fuel_dashboard_v2(
  p_start date,
  p_end date,
  p_grain text default 'week',
  p_supervisor text default null,
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
    select f.*,
      case
        when p_grain = 'month' then date_trunc('month', f.transaction_date)::date
        when p_grain = 'day' then f.transaction_date
        else (date_trunc('week', f.transaction_date + 2) - interval '2 days')::date
      end as period_start
    from public.fuel_transactions f
    where f.transaction_date between p_start and p_end
      and (p_contract is null or f.contract_number = p_contract)
      and (p_person is null or f.person_name = p_person)
      and (p_station is null or f.merchant_name = p_station)
      and (p_category is null or f.product_category = p_category)
      and (
        p_supervisor is null
        or exists (
          select 1 from public.contract_assignment_periods a
          where a.contract_number = f.contract_number
            and a.supervisor = p_supervisor
            and f.transaction_date >= a.start_date
            and (a.end_date is null or f.transaction_date <= a.end_date)
        )
        or (
          not exists (
            select 1 from public.contract_assignment_periods dated
            where dated.contract_number = f.contract_number
              and f.transaction_date >= dated.start_date
              and (dated.end_date is null or f.transaction_date <= dated.end_date)
          )
          and exists (
            select 1 from public.contract_supervisors current_assignment
            where current_assignment.contract_number = f.contract_number
              and current_assignment.supervisor = p_supervisor
          )
        )
      )
  ), totals as (
    select count(*)::integer as line_items,
      count(distinct transaction_group_key)::integer as transactions,
      coalesce(sum(net_cost),0) as total_spend,
      coalesce(sum(unit_gallons) filter (where product_category in ('diesel','gasoline')),0) as fuel_gallons,
      coalesce(sum(net_cost) filter (where product_category in ('diesel','gasoline')),0) as fuel_cost,
      coalesce(sum(net_cost) filter (where product_category = 'gasoline'),0) as gasoline_spend,
      count(*) filter (where product_category = 'gasoline')::integer as gasoline_lines,
      coalesce(sum(unit_gallons) filter (where product_category = 'gasoline'),0) as gasoline_gallons
    from filtered
  ), person_months as (
    select person_name, date_trunc('month', transaction_date)::date as period_start,
      sum(net_cost) as total_spend
    from filtered
    group by person_name, date_trunc('month', transaction_date)::date
  )
  select jsonb_build_object(
    'totals', (select to_jsonb(t) || jsonb_build_object('average_price_per_gallon', case when fuel_gallons = 0 then 0 else fuel_cost / fuel_gallons end) from totals t),
    'trend', coalesce((select jsonb_agg(to_jsonb(x) order by x.period_start) from (
      select period_start, count(distinct transaction_group_key)::integer as transactions,
        coalesce(sum(unit_gallons) filter (where product_category in ('diesel','gasoline')),0) as fuel_gallons,
        coalesce(sum(net_cost),0) as total_spend
      from filtered group by period_start
    ) x), '[]'::jsonb),
    'monthly_contracts', coalesce((select jsonb_agg(to_jsonb(x) order by x.period_start, x.contract_number) from (
      select date_trunc('month', transaction_date)::date as period_start, contract_number,
        count(distinct person_name)::integer as employees,
        count(distinct transaction_group_key)::integer as transactions,
        coalesce(sum(unit_gallons) filter (where product_category in ('diesel','gasoline')),0) as fuel_gallons,
        coalesce(sum(net_cost) filter (where product_category = 'gasoline'),0) as gasoline_spend,
        coalesce(sum(net_cost),0) as total_spend
      from filtered group by date_trunc('month', transaction_date)::date, contract_number
    ) x), '[]'::jsonb),
    'by_contract', coalesce((select jsonb_agg(to_jsonb(x) order by x.total_spend desc) from (
      select contract_number as name, count(distinct transaction_group_key)::integer as transactions,
        coalesce(sum(unit_gallons) filter (where product_category in ('diesel','gasoline')),0) as fuel_gallons,
        coalesce(sum(net_cost),0) as total_spend,
        coalesce(sum(net_cost) filter (where product_category = 'gasoline'),0) as gasoline_spend
      from filtered group by contract_number
    ) x), '[]'::jsonb),
    'by_person', coalesce((select jsonb_agg(to_jsonb(x) order by x.total_spend desc) from (
      select person_name as name, count(distinct transaction_group_key)::integer as transactions,
        coalesce(sum(unit_gallons) filter (where product_category in ('diesel','gasoline')),0) as fuel_gallons,
        coalesce(sum(net_cost),0) as total_spend,
        coalesce(sum(net_cost) filter (where product_category = 'gasoline'),0) as gasoline_spend
      from filtered group by person_name
    ) x), '[]'::jsonb),
    'by_station', coalesce((select jsonb_agg(to_jsonb(x) order by x.total_spend desc) from (
      select merchant_name as name, merchant_city as city, merchant_state as state,
        count(distinct transaction_group_key)::integer as transactions,
        coalesce(sum(unit_gallons) filter (where product_category in ('diesel','gasoline')),0) as fuel_gallons,
        coalesce(sum(net_cost),0) as total_spend
      from filtered group by merchant_name, merchant_city, merchant_state
    ) x), '[]'::jsonb),
    'by_product', coalesce((select jsonb_agg(to_jsonb(x) order by x.total_spend desc) from (
      select product_category as name, count(*)::integer as line_items,
        coalesce(sum(unit_gallons),0) as units, coalesce(sum(net_cost),0) as total_spend
      from filtered group by product_category
    ) x), '[]'::jsonb),
    'gasoline_alerts', coalesce((select jsonb_agg(to_jsonb(x) order by x.transaction_date desc, x.net_cost desc) from (
      select f.transaction_date, f.person_name, f.contract_number, f.merchant_name, f.merchant_city, f.merchant_state,
        f.vehicle_number, f.product_description, f.unit_gallons, f.price_per_unit, f.net_cost,
        coalesce(r.gasoline_authorized,false) as gasoline_authorized,
        r.monthly_spend_limit
      from filtered f left join public.fuel_employee_rules r on r.person_name = f.person_name
      where f.product_category = 'gasoline'
      order by f.transaction_date desc, f.net_cost desc limit 500
    ) x), '[]'::jsonb),
    'spend_alerts', coalesce((select jsonb_agg(to_jsonb(x) order by x.period_start desc, x.overage desc) from (
      select pm.person_name, pm.period_start, pm.total_spend, r.monthly_spend_limit,
        pm.total_spend - r.monthly_spend_limit as overage
      from person_months pm join public.fuel_employee_rules r on r.person_name = pm.person_name
      where r.monthly_spend_limit is not null and pm.total_spend > r.monthly_spend_limit
    ) x), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

grant execute on function public.fuel_filter_options_v2() to authenticated;
grant execute on function public.fuel_dashboard_v2(date,date,text,text,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
