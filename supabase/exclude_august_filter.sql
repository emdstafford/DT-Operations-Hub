-- Optional August 2026 exclusion for historical comparisons.
-- Run in Supabase SQL Editor as postgres.

create or replace function public.performance_trend_filtered(
  p_start date,
  p_end date,
  p_grain text default 'week',
  p_contract text default null,
  p_supervisor text default null,
  p_exclude_august_2026 boolean default false
)
returns table (period_start date, load_count bigint, total_stops bigint,
  completed_stops bigint, incomplete_stops bigint, completion_percent numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'Approved DT Express account required' using errcode = '42501';
  end if;
  return query
  select case p_grain
      when 'day' then l.operating_date
      when 'month' then date_trunc('month', l.operating_date)::date
      when 'year' then date_trunc('year', l.operating_date)::date
      else (date_trunc('week', l.operating_date + interval '2 days') - interval '2 days')::date
    end,
    count(*), sum(l.total_stops)::bigint, sum(l.completed_stops)::bigint,
    sum(l.incomplete_stops)::bigint,
    case when sum(l.total_stops)=0 then 0
      else round(sum(l.completed_stops)::numeric/sum(l.total_stops),6) end
  from public.usps_loads l
  where l.operating_date between p_start and p_end
    and (p_contract is null or l.contract_number = p_contract)
    and (p_supervisor is null or p_supervisor = any(l.supervisors))
    and (not p_exclude_august_2026
      or l.operating_date not between date '2026-08-01' and date '2026-08-31')
  group by 1 order by 1;
end;
$$;

create or replace function public.contract_performance_filtered(
  p_start date, p_end date, p_exclude_august_2026 boolean default false)
returns table (contract_number text, load_count bigint, total_stops bigint,
  completed_stops bigint, incomplete_stops bigint, completion_percent numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'Approved DT Express account required' using errcode = '42501';
  end if;
  return query
  select coalesce(l.contract_number,'Unmapped'), count(*), sum(l.total_stops)::bigint,
    sum(l.completed_stops)::bigint, sum(l.incomplete_stops)::bigint,
    case when sum(l.total_stops)=0 then 0
      else round(sum(l.completed_stops)::numeric/sum(l.total_stops),6) end
  from public.usps_loads l
  where l.operating_date between p_start and p_end
    and (not p_exclude_august_2026
      or l.operating_date not between date '2026-08-01' and date '2026-08-31')
  group by 1 order by 6 asc;
end;
$$;

create or replace function public.supervisor_performance_filtered(
  p_start date, p_end date, p_exclude_august_2026 boolean default false)
returns table (supervisor text, load_count bigint, total_stops bigint,
  completed_stops bigint, incomplete_stops bigint, completion_percent numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'Approved DT Express account required' using errcode = '42501';
  end if;
  return query
  select supervisor_name, count(*), sum(l.total_stops)::bigint,
    sum(l.completed_stops)::bigint, sum(l.incomplete_stops)::bigint,
    case when sum(l.total_stops)=0 then 0
      else round(sum(l.completed_stops)::numeric/sum(l.total_stops),6) end
  from public.usps_loads l
  cross join lateral unnest(case when cardinality(l.supervisors)=0
    then array['Unassigned']::text[] else l.supervisors end)
    as supervisor_rows(supervisor_name)
  where l.operating_date between p_start and p_end
    and (not p_exclude_august_2026
      or l.operating_date not between date '2026-08-01' and date '2026-08-31')
  group by supervisor_name order by 6 desc;
end;
$$;

create or replace function public.supervisor_contract_performance_filtered(
  p_start date,
  p_end date,
  p_supervisor text,
  p_exclude_august_2026 boolean default false
)
returns table (contract_number text, load_count bigint, total_stops bigint,
  completed_stops bigint, incomplete_stops bigint, completion_percent numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'Approved DT Express account required' using errcode = '42501';
  end if;
  return query
  select coalesce(l.contract_number,'Unmapped'), count(*), sum(l.total_stops)::bigint,
    sum(l.completed_stops)::bigint, sum(l.incomplete_stops)::bigint,
    case when sum(l.total_stops)=0 then 0
      else round(sum(l.completed_stops)::numeric/sum(l.total_stops),6) end
  from public.usps_loads l
  where l.operating_date between p_start and p_end
    and p_supervisor = any(l.supervisors)
    and (not p_exclude_august_2026
      or l.operating_date not between date '2026-08-01' and date '2026-08-31')
  group by 1 order by 6 asc;
end;
$$;

revoke all on function public.performance_trend_filtered(date,date,text,text,text,boolean) from public;
revoke all on function public.contract_performance_filtered(date,date,boolean) from public;
revoke all on function public.supervisor_performance_filtered(date,date,boolean) from public;
revoke all on function public.supervisor_contract_performance_filtered(date,date,text,boolean) from public;
grant execute on function public.performance_trend_filtered(date,date,text,text,text,boolean) to authenticated;
grant execute on function public.contract_performance_filtered(date,date,boolean) to authenticated;
grant execute on function public.supervisor_performance_filtered(date,date,boolean) to authenticated;
grant execute on function public.supervisor_contract_performance_filtered(date,date,text,boolean) to authenticated;

notify pgrst, 'reload schema';
