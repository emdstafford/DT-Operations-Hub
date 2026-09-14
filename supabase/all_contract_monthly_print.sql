-- One-query source for the printable all-contract monthly performance packet.
-- Run this file once in the Supabase SQL Editor as the postgres role.

create or replace function public.all_contract_monthly_performance(
  p_start date,
  p_end date,
  p_exclude_august_2026 boolean default false
)
returns table (
  contract_number text,
  period_start date,
  load_count bigint,
  total_stops bigint,
  completed_stops bigint,
  incomplete_stops bigint,
  completion_percent numeric,
  supervisors text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'Approved DT Express account required' using errcode = '42501';
  end if;

  return query
  with filtered as materialized (
    select l.*
    from public.usps_loads l
    where l.operating_date between p_start and p_end
      and (
        not p_exclude_august_2026
        or l.operating_date not between date '2026-08-13' and date '2026-08-20'
      )
  ),
  monthly as (
    select
      coalesce(l.contract_number, 'Unmapped') as contract_number,
      date_trunc('month', l.operating_date)::date as period_start,
      count(*)::bigint as load_count,
      coalesce(sum(l.total_stops), 0)::bigint as total_stops,
      coalesce(sum(l.completed_stops), 0)::bigint as completed_stops,
      coalesce(sum(l.incomplete_stops), 0)::bigint as incomplete_stops
    from filtered l
    group by 1, 2
  ),
  monthly_supervisors as (
    select
      coalesce(l.contract_number, 'Unmapped') as contract_number,
      date_trunc('month', l.operating_date)::date as period_start,
      array_agg(distinct supervisor_name order by supervisor_name)
        filter (where supervisor_name <> 'Unassigned') as supervisors
    from filtered l
    cross join lateral unnest(
      case
        when cardinality(l.supervisors) = 0 then array['Unassigned']::text[]
        else l.supervisors
      end
    ) supervisor_name
    group by 1, 2
  )
  select
    m.contract_number,
    m.period_start,
    m.load_count,
    m.total_stops,
    m.completed_stops,
    m.incomplete_stops,
    case
      when m.total_stops = 0 then 0
      else round(m.completed_stops::numeric / m.total_stops, 6)
    end as completion_percent,
    coalesce(s.supervisors, array['Unassigned']::text[]) as supervisors
  from monthly m
  left join monthly_supervisors s
    on s.contract_number = m.contract_number
   and s.period_start = m.period_start
  order by m.contract_number, m.period_start;
end;
$$;

revoke all on function public.all_contract_monthly_performance(date,date,boolean) from public;
grant execute on function public.all_contract_monthly_performance(date,date,boolean) to authenticated;

notify pgrst, 'reload schema';
