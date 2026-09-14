-- Unified, fast dashboard query with multi-select supervisor and contract filters.
-- Run once in the Supabase SQL Editor as the postgres role.

create or replace function public.dashboard_hub_filtered(
  p_start date,
  p_end date,
  p_grain text default 'week',
  p_contracts text[] default null,
  p_supervisors text[] default null,
  p_exclude_august_2026 boolean default false,
  p_max_completion numeric default null,
  p_min_missed_stops integer default null
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_approved() then
    raise exception 'Approved DT Express account required' using errcode = '42501';
  end if;

  with eligible_base as materialized (
    select l.*
    from public.usps_loads l
    where l.operating_date between p_start and p_end
      and (coalesce(cardinality(p_contracts), 0) = 0 or l.contract_number = any(p_contracts))
      and (coalesce(cardinality(p_supervisors), 0) = 0 or l.supervisors && p_supervisors)
      and (not p_exclude_august_2026
        or l.operating_date not between date '2026-08-13' and date '2026-08-20')
  ),
  eligible_contracts as (
    select contract_number
    from eligible_base
    group by contract_number
    having (p_max_completion is null or
      case when sum(total_stops)=0 then 0 else sum(completed_stops)::numeric/sum(total_stops) end <= p_max_completion)
      and (p_min_missed_stops is null or sum(incomplete_stops) >= p_min_missed_stops)
  ),
  filtered as materialized (
    select b.* from eligible_base b
    join eligible_contracts c on c.contract_number is not distinct from b.contract_number
  ),
  totals as (
    select count(*)::bigint load_count,
      coalesce(sum(total_stops),0)::bigint total_stops,
      coalesce(sum(completed_stops),0)::bigint completed_stops,
      coalesce(sum(incomplete_stops),0)::bigint incomplete_stops
    from filtered
  ),
  trend as (
    select case p_grain
        when 'day' then operating_date
        when 'month' then date_trunc('month', operating_date)::date
        when 'year' then date_trunc('year', operating_date)::date
        else (date_trunc('week', operating_date + interval '2 days') - interval '2 days')::date
      end period_start,
      count(*)::bigint load_count, sum(total_stops)::bigint total_stops,
      sum(completed_stops)::bigint completed_stops, sum(incomplete_stops)::bigint incomplete_stops
    from filtered group by 1
  ),
  contracts as (
    select coalesce(contract_number,'Unmapped') contract_number,
      count(*)::bigint load_count, sum(total_stops)::bigint total_stops,
      sum(completed_stops)::bigint completed_stops, sum(incomplete_stops)::bigint incomplete_stops
    from filtered group by 1
  ),
  supervisors as (
    select supervisor_name supervisor, count(*)::bigint load_count,
      sum(f.total_stops)::bigint total_stops, sum(f.completed_stops)::bigint completed_stops,
      sum(f.incomplete_stops)::bigint incomplete_stops
    from filtered f
    cross join lateral unnest(case when cardinality(f.supervisors)=0
      then array['Unassigned']::text[] else f.supervisors end) supervisor_name
    where coalesce(cardinality(p_supervisors),0)=0 or supervisor_name=any(p_supervisors)
    group by 1
  )
  select jsonb_build_object(
    'totals', (select to_jsonb(t) || jsonb_build_object('completion_percent',
      case when t.total_stops=0 then 0 else round(t.completed_stops::numeric/t.total_stops,6) end) from totals t),
    'trend', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('completion_percent',
      case when x.total_stops=0 then 0 else round(x.completed_stops::numeric/x.total_stops,6) end) order by x.period_start) from trend x),'[]'::jsonb),
    'contracts', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('completion_percent',
      case when x.total_stops=0 then 0 else round(x.completed_stops::numeric/x.total_stops,6) end) order by (case when x.total_stops=0 then 0 else x.completed_stops::numeric/x.total_stops end), x.contract_number) from contracts x),'[]'::jsonb),
    'supervisors', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('completion_percent',
      case when x.total_stops=0 then 0 else round(x.completed_stops::numeric/x.total_stops,6) end) order by (case when x.total_stops=0 then 0 else x.completed_stops::numeric/x.total_stops end) desc, x.supervisor) from supervisors x),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.dashboard_hub_filtered(date,date,text,text[],text[],boolean,numeric,integer) from public;
grant execute on function public.dashboard_hub_filtered(date,date,text,text[],text[],boolean,numeric,integer) to authenticated;
notify pgrst, 'reload schema';
