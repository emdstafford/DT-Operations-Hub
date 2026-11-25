-- Recurring missed trip intelligence. Latest observation per operating-day load prevents duplicate workbook counts.
-- These misses are NOT asserted to be included in official USPS completion penalties.
create or replace function public.recurring_missed_trips(
  p_end date default ((date_trunc('week', (now() at time zone 'America/New_York')::date)::date) - 1),
  p_weeks integer default 8
)
returns table (
  contract_number text,trip_number text,weeks_affected integer,weeks_observed integer,
  affected_weeks text[],missed_days integer,missed_stops bigint,last_missed_date date
)
language sql stable security invoker set search_path=public as $$
with bounds as (
 select coalesce(p_end, (date_trunc('week', (now() at time zone 'America/New_York')::date)::date)-1) as end_day,
        least(greatest(coalesce(p_weeks,8),4),16) as lookback
),
latest_load as (
 select distinct on (l.operating_date,l.load_number)
   l.operating_date,l.load_number,public.canonical_contract_number(l.contract_number) as contract,
   coalesce(nullif(btrim(l.trip_number),''),'Unassigned') as trip,l.incomplete_stops
 from public.usps_loads l cross join bounds b
 where l.operating_date between (b.end_day - (b.lookback*7 - 1)) and b.end_day
 order by l.operating_date,l.load_number,
          l.source_period_end desc nulls last,l.updated_at desc nulls last,l.source_file desc
),
weekly as (
 select contract,trip,date_trunc('week',operating_date)::date as week_start,
        count(distinct operating_date)::integer as missed_days,
        sum(incomplete_stops)::bigint as missed_stops,max(operating_date) as last_missed_date
 from latest_load where incomplete_stops>0 and contract is not null and contract<>''
 group by contract,trip,date_trunc('week',operating_date)::date
),
repeated as (
 select contract,trip,count(*)::integer as weeks_affected,
        array_agg(week_start::text order by week_start) as affected_weeks,
        sum(missed_days)::integer as missed_days,sum(missed_stops)::bigint as missed_stops,
        max(last_missed_date) as last_missed_date
 from weekly group by contract,trip having count(*)>=2
)
select r.contract as contract_number,r.trip as trip_number,r.weeks_affected,
       b.lookback as weeks_observed,r.affected_weeks,r.missed_days,
       r.missed_stops,r.last_missed_date
from repeated r cross join bounds b
order by r.weeks_affected desc,r.missed_stops desc,r.last_missed_date desc,r.contract,r.trip limit 150;
$$;
revoke all on function public.recurring_missed_trips(date,integer) from public,anon;
grant execute on function public.recurring_missed_trips(date,integer) to authenticated;
