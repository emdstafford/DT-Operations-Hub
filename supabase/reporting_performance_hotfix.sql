-- Speed up historical reporting while preserving approved-employee access.
-- Run in Supabase SQL Editor as the postgres role.

create or replace function public.performance_trend(
  p_start date,
  p_end date,
  p_grain text default 'week',
  p_contract text default null,
  p_supervisor text default null
)
returns table (
  period_start date,
  load_count bigint,
  total_stops bigint,
  completed_stops bigint,
  incomplete_stops bigint,
  completion_percent numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'Approved DT Express account required' using errcode = '42501';
  end if;

  return query
  select
    case p_grain
      when 'day' then l.operating_date
      when 'month' then date_trunc('month', l.operating_date)::date
      when 'year' then date_trunc('year', l.operating_date)::date
      else (date_trunc('week', l.operating_date + interval '2 days') - interval '2 days')::date
    end,
    count(*), sum(l.total_stops)::bigint, sum(l.completed_stops)::bigint,
    sum(l.incomplete_stops)::bigint,
    case when sum(l.total_stops) = 0 then 0
      else round(sum(l.completed_stops)::numeric / sum(l.total_stops), 6) end
  from public.usps_loads l
  where l.operating_date between p_start and p_end
    and (p_contract is null or l.contract_number = p_contract)
    and (p_supervisor is null or p_supervisor = any(l.supervisors))
  group by 1
  order by 1;
end;
$$;

create or replace function public.contract_performance(p_start date, p_end date)
returns table (contract_number text, load_count bigint, total_stops bigint,
  completed_stops bigint, incomplete_stops bigint, completion_percent numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'Approved DT Express account required' using errcode = '42501';
  end if;

  return query
  select coalesce(l.contract_number, 'Unmapped'), count(*), sum(l.total_stops)::bigint,
    sum(l.completed_stops)::bigint, sum(l.incomplete_stops)::bigint,
    case when sum(l.total_stops)=0 then 0
      else round(sum(l.completed_stops)::numeric/sum(l.total_stops),6) end
  from public.usps_loads l
  where l.operating_date between p_start and p_end
  group by 1
  order by 6 asc;
end;
$$;

create or replace function public.supervisor_performance(p_start date, p_end date)
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
  cross join lateral unnest(
    case when cardinality(l.supervisors)=0
      then array['Unassigned']::text[] else l.supervisors end
  ) as supervisor_rows(supervisor_name)
  where l.operating_date between p_start and p_end
  group by supervisor_name
  order by 6 desc;
end;
$$;

create or replace function public.contract_options()
returns table (contract_number text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'Approved DT Express account required' using errcode = '42501';
  end if;
  return query
  select distinct l.contract_number
  from public.usps_loads l
  where l.contract_number is not null and l.contract_number <> ''
  order by l.contract_number;
end;
$$;

create or replace function public.supervisor_options()
returns table (supervisor text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'Approved DT Express account required' using errcode = '42501';
  end if;
  return query
  select distinct supervisor_name
  from public.usps_loads l
  cross join lateral unnest(l.supervisors) as supervisor_rows(supervisor_name)
  where supervisor_name <> ''
  order by supervisor_name;
end;
$$;

revoke all on function public.performance_trend(date,date,text,text,text) from public;
revoke all on function public.contract_performance(date,date) from public;
revoke all on function public.supervisor_performance(date,date) from public;
revoke all on function public.contract_options() from public;
revoke all on function public.supervisor_options() from public;
grant execute on function public.performance_trend(date,date,text,text,text) to authenticated;
grant execute on function public.contract_performance(date,date) to authenticated;
grant execute on function public.supervisor_performance(date,date) to authenticated;
grant execute on function public.contract_options() to authenticated;
grant execute on function public.supervisor_options() to authenticated;

notify pgrst, 'reload schema';
