-- Driver gasoline monthly averages for the Fuel by Employee table.
-- Uses the three most recent complete company fuel months before the selected month.
-- Months with company fuel activity but no gasoline purchase for a driver count as $0.

create or replace function public.fuel_driver_gasoline_averages(
  p_as_of date,
  p_months integer default 3
)
returns table (
  person_name text,
  average_monthly_gasoline_spend numeric,
  months_in_average integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_fuel_user() then
    raise exception 'Approved fuel-report account required' using errcode = '42501';
  end if;

  if p_as_of is null then
    raise exception 'As-of date is required';
  end if;

  p_months := greatest(1, least(coalesce(p_months, 3), 12));

  return query
  with available_months as (
    select distinct date_trunc('month', transaction_date)::date as month_start
    from public.fuel_transactions
    where transaction_date < date_trunc('month', p_as_of)::date
    order by month_start desc
    limit p_months
  ),
  drivers as (
    select distinct person_name
    from public.fuel_transactions
    where nullif(trim(person_name), '') is not null
  ),
  gasoline_by_month as (
    select
      person_name,
      date_trunc('month', transaction_date)::date as month_start,
      coalesce(sum(net_cost) filter (where product_category = 'gasoline'), 0)::numeric as gasoline_spend
    from public.fuel_transactions
    where transaction_date < date_trunc('month', p_as_of)::date
    group by person_name, date_trunc('month', transaction_date)::date
  )
  select
    d.person_name,
    round(coalesce(avg(coalesce(g.gasoline_spend, 0)), 0), 2) as average_monthly_gasoline_spend,
    count(m.month_start)::integer as months_in_average
  from drivers d
  cross join available_months m
  left join gasoline_by_month g
    on g.person_name = d.person_name
   and g.month_start = m.month_start
  group by d.person_name
  order by d.person_name;
end;
$$;

grant execute on function public.fuel_driver_gasoline_averages(date, integer) to authenticated;

notify pgrst, 'reload schema';
