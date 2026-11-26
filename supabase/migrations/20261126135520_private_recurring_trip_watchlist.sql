CREATE OR REPLACE FUNCTION public.dt_private_recurring_trip_watchlist(p_end date, p_weeks integer DEFAULT 14)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare result jsonb;
begin
 if auth.uid() is null or lower(coalesce(auth.jwt()->>'email','')) not in ('estafford@dtexpress.net','ccochran@dtexpress.net') or not public.is_approved(array['admin']::text[]) then
  raise exception 'Not authorized' using errcode='42501';
 end if;
 if p_end is null or extract(isodow from p_end)<>5 or p_weeks is null or p_weeks not between 4 and 16 or p_end >= (now() at time zone 'America/New_York')::date then
  raise exception 'Choose a completed Friday and 4–16 weeks';
 end if;
 with weekly as (
 select public.canonical_contract_number(l.contract_number) as contract,
 coalesce(nullif(btrim(l.trip_number),''),'Unmapped') as trip,
 (date_trunc('week',l.operating_date+2)::date-2) as week_start,
 sum(coalesce(l.incomplete_stops,0))::bigint as missed,
 sum(coalesce(l.total_stops,0))::bigint as stops,
 max(l.operating_date) filter(where l.incomplete_stops>0) as last_miss
 from public.usps_loads l
 where l.operating_date between p_end-(p_weeks*7-1) and p_end
 and nullif(btrim(l.contract_number),'') is not null
 and not(public.canonical_contract_number(l.contract_number)='3773G' and l.operating_date>date '2026-11-13')
 and l.operating_date not between date '2026-08-07' and date '2026-08-13'
 group by 1,2,3
 ), trips as (
 select contract,trip,count(*) filter(where missed>0)::integer as affected,
 count(*) filter(where stops>0 or missed>0)::integer as observed,
 sum(missed)::bigint as missed_stops,max(last_miss) as last_miss,
 array_agg(week_start::text order by week_start) filter(where missed>0) as affected_weeks,
 array_agg(week_start::text order by week_start) filter(where stops>0 or missed>0) as observed_weeks
 from weekly group by 1,2 having count(*) filter(where missed>0)>=2
 )
 select coalesce(jsonb_agg(to_jsonb(t) order by affected desc,missed_stops desc,contract,trip),'[]'::jsonb) into result from trips t;
 return result;
end;
$function$;
revoke all on function public.dt_private_recurring_trip_watchlist(date,integer) from public,anon;
grant execute on function public.dt_private_recurring_trip_watchlist(date,integer) to authenticated;
