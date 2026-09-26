-- Monthly USPS contracted financials by contract.
-- Uses effective-dated USPS annual trip cost and annual miles, prorated only across
-- the portion of the selected calendar month covered by each rate period.
-- This is contracted baseline revenue, not yet proof of trips operated or USPS payment.

create or replace function public.usps_contract_monthly_financials(
  p_contract text,
  p_month date
)
returns table (
  contract_number text,
  month_start date,
  contracted_revenue numeric,
  scheduled_miles numeric,
  active_days integer,
  calendar_days integer,
  rate_period_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_month_start date := date_trunc('month', p_month)::date;
  v_month_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  if not public.has_app_permission('can_view_rates') then
    raise exception 'Rate-view permission required' using errcode = '42501';
  end if;

  return query
  with latest_versions as (
    select distinct on (v.contract_number, v.effective_start, coalesce(v.effective_end,'9999-12-31'::date))
      v.id, v.contract_number, v.effective_start, v.effective_end, v.created_at
    from public.usps_contract_rate_versions v
    where v.contract_number = upper(trim(p_contract))
      and v.effective_start <= v_month_end
      and coalesce(v.effective_end, v_month_end) >= v_month_start
    order by v.contract_number, v.effective_start, coalesce(v.effective_end,'9999-12-31'::date), v.created_at desc
  ),
  periods as (
    select
      v.id, v.contract_number,
      greatest(v.effective_start, v_month_start) as covered_start,
      least(coalesce(v.effective_end, v_month_end), v_month_end) as covered_end,
      coalesce(sum(t.annual_trip_cost),0)::numeric as annual_revenue,
      coalesce(sum(t.annual_miles),0)::numeric as annual_miles
    from latest_versions v
    join public.usps_trip_rates t on t.contract_rate_version_id = v.id
    group by v.id, v.contract_number, v.effective_start, v.effective_end
  ),
  calc as (
    select *,
      (covered_end - covered_start + 1)::integer as covered_days,
      extract(day from (date_trunc('month', covered_start) + interval '1 month - 1 day'))::integer as days_in_month,
      case when extract(year from covered_start)::integer % 400 = 0
             or (extract(year from covered_start)::integer % 4 = 0 and extract(year from covered_start)::integer % 100 <> 0)
           then 366 else 365 end as days_in_year
    from periods
    where covered_end >= covered_start
  )
  select
    upper(trim(p_contract)), v_month_start,
    coalesce(sum(annual_revenue * covered_days / days_in_year),0)::numeric,
    coalesce(sum(annual_miles * covered_days / days_in_year),0)::numeric,
    coalesce(sum(covered_days),0)::integer,
    extract(day from v_month_end)::integer,
    count(*)::bigint
  from calc;
end;
$$;

revoke all on function public.usps_contract_monthly_financials(text,date) from public;
grant execute on function public.usps_contract_monthly_financials(text,date) to authenticated;

notify pgrst, 'reload schema';
