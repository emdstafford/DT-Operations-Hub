-- Optimize recurring trip history without changing official percentage calculations.
-- The load_number column is globally unique (usps_loads primary key).
-- Filtering incomplete stops before weekly aggregation avoids timeout on report loads.
create or replace function public.recurring_missed_trips(
 p_end date default ((date_trunc('week',(now() at time zone 'America/New_York')::date)::date)-1),
 p_weeks integer default 8)
returns table(contract_number text,trip_number text,weeks_affected integer,weeks_observed integer,
 affected_weeks text[],missed_days integer,missed_stops bigint,last_missed_date date)
language sql stable security invoker set search_path=public as $$
with bounds as (
 select coalesce(p_end,(date_trunc('week',(now() at time zone 'America/New_York')::date)::date)-1) end_day,
 least(greatest(coalesce(p_weeks,8),4),16) lookback
), weekly as (
 select public.canonical_contract_number(l.contract_number) contract,
  coalesce(nullif(btrim(l.trip_number),''),'Unassigned') trip,
  date_trunc('week',l.operating_date)::date week_start,
  count(distinct l.operating_date)::integer missed_days,
  sum(l.incomplete_stops)::bigint missed_stops,
  max(l.operating_date) last_missed_date
 from public.usps_loads l cross join bounds b
 where l.operating_date between (b.end_day-(b.lookback*7 - 1)) and b.end_day
  and l.incomplete_stops>0
  and l.contract_number is not null and btrim(l.contract_number)<>''
  and not(public.canonical_contract_number(l.contract_number)='3773G' and l.operating_date>date '2026-11-13')
 group by 1,2,3
), repeated as (
 select contract,trip,count(*)::integer weeks_affected,
 array_agg(week_start::text order by week_start) affected_weeks,
 sum(missed_days)::integer missed_days,sum(missed_stops)::bigint missed_stops,
 max(last_missed_date) last_missed_date
 from weekly group by contract,trip having count(*)>=2
)
select r.contract,r.trip,r.weeks_affected,b.lookback,r.affected_weeks,r.missed_days,r.missed_stops,r.last_missed_date
from repeated r cross join bounds b
order by r.weeks_affected desc,r.missed_stops desc,r.last_missed_date desc,r.contract,r.trip limit 150;
$$;
revoke all on function public.recurring_missed_trips(date,integer) from public,anon;
grant execute on function public.recurring_missed_trips(date,integer) to authenticated;
