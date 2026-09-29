-- Driver fuel by transaction contract, with dated contract supervisors.
-- Run after fuel_supervisor_reports.sql. Only approved fuel users can execute it.
create or replace function public.fuel_driver_contract_report(
  p_start date,
  p_end date,
  p_supervisor text default null,
  p_contract text default null,
  p_person text default null,
  p_station text default null,
  p_category text default null
)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_fuel_user() then
    raise exception 'Approved fuel-report account required' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 3660 then
    raise exception 'Invalid reporting dates' using errcode = '22023';
  end if;

  with filtered as (
    select f.* from public.fuel_transactions f
    where f.transaction_date between p_start and p_end
      and (p_contract is null or f.contract_number = p_contract)
      and (p_person is null or f.person_name = p_person)
      and (p_station is null or f.merchant_name = p_station)
      and (p_category is null or f.product_category = p_category)
      and (
        p_supervisor is null
        or exists (
          select 1 from public.contract_assignment_periods a
          where a.contract_number = f.contract_number and a.supervisor = p_supervisor
            and f.transaction_date >= a.start_date
            and (a.end_date is null or f.transaction_date <= a.end_date)
        )
        or (
          not exists (
            select 1 from public.contract_assignment_periods a
            where a.contract_number = f.contract_number
              and f.transaction_date >= a.start_date
              and (a.end_date is null or f.transaction_date <= a.end_date)
          )
          and exists (
            select 1 from public.contract_supervisors c
            where c.contract_number = f.contract_number and c.supervisor = p_supervisor
          )
        )
      )
  ), grouped as (
    select f.contract_number, f.person_name,
      count(distinct f.transaction_group_key)::integer as transactions,
      coalesce(sum(f.unit_gallons) filter (where f.product_category = 'diesel'), 0) as diesel_gallons,
      coalesce(sum(f.net_cost) filter (where f.product_category = 'diesel'), 0) as diesel_cost,
      coalesce(sum(f.unit_gallons) filter (where f.product_category = 'gasoline'), 0) as gasoline_gallons,
      coalesce(sum(f.net_cost) filter (where f.product_category = 'gasoline'), 0) as gasoline_cost,
      coalesce(sum(f.net_cost) filter (where f.product_category not in ('diesel','gasoline')), 0) as misc_cost,
      coalesce(sum(f.net_cost), 0) as total_cost
    from filtered f group by f.contract_number, f.person_name
  ), assigned as (
    select distinct f.contract_number, trim(a.supervisor) as supervisor
    from filtered f join public.contract_assignment_periods a
      on a.contract_number = f.contract_number and f.transaction_date >= a.start_date
      and (a.end_date is null or f.transaction_date <= a.end_date)
    where trim(a.supervisor) <> ''
    union
    select distinct f.contract_number, trim(c.supervisor)
    from filtered f join public.contract_supervisors c on c.contract_number = f.contract_number
    where trim(c.supervisor) <> '' and not exists (
      select 1 from public.contract_assignment_periods a
      where a.contract_number = f.contract_number and f.transaction_date >= a.start_date
        and (a.end_date is null or f.transaction_date <= a.end_date)
    )
  ), names as (
    select a.contract_number, string_agg(a.supervisor, ', ' order by a.supervisor) as supervisors
    from assigned a group by a.contract_number
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.contract_number, x.person_name), '[]'::jsonb)
  into result
  from (
    select g.*, coalesce(n.supervisors, 'Unassigned') as supervisors
    from grouped g left join names n on n.contract_number = g.contract_number
  ) x;
  return result;
end;
$$;

revoke all on function public.fuel_driver_contract_report(date,date,text,text,text,text,text) from public;
grant execute on function public.fuel_driver_contract_report(date,date,text,text,text,text,text) to authenticated;
notify pgrst, 'reload schema';
