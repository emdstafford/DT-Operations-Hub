-- DT Intelligence Hub load-level historical reporting
-- Run after secure_report_history.sql.

create table if not exists public.usps_loads (
  load_number text primary key,
  operating_date date not null,
  contract_number text,
  trip_number text,
  supervisors text[] not null default '{}',
  total_stops integer not null default 0 check (total_stops >= 0),
  completed_stops integer not null default 0 check (completed_stops >= 0),
  incomplete_stops integer not null default 0 check (incomplete_stops >= 0),
  source_file text not null,
  source_period_start date not null,
  source_period_end date not null,
  uploaded_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create index if not exists usps_loads_operating_date_idx on public.usps_loads (operating_date);
create index if not exists usps_loads_contract_date_idx on public.usps_loads (contract_number, operating_date);
create index if not exists usps_loads_supervisors_idx on public.usps_loads using gin (supervisors);

create table if not exists public.report_annotations (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  title text not null,
  note text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

insert into public.report_annotations (period_start, period_end, title, note)
select '2026-08-01', '2026-08-31', 'FourKites tracking issue',
       'FourKites tracking problems affected results for approximately two weeks during August 2026.'
where not exists (
  select 1 from public.report_annotations
  where period_start = '2026-08-01' and title = 'FourKites tracking issue'
);

alter table public.usps_loads enable row level security;
alter table public.report_annotations enable row level security;

drop policy if exists "approved employees read loads" on public.usps_loads;
create policy "approved employees read loads" on public.usps_loads
for select to authenticated using (public.is_approved());

drop policy if exists "approved uploaders insert loads" on public.usps_loads;
create policy "approved uploaders insert loads" on public.usps_loads
for insert to authenticated
with check (uploaded_by = auth.uid() and public.is_approved(array['admin', 'uploader']));

drop policy if exists "approved uploaders update loads" on public.usps_loads;
create policy "approved uploaders update loads" on public.usps_loads
for update to authenticated
using (public.is_approved(array['admin', 'uploader']))
with check (uploaded_by = auth.uid() and public.is_approved(array['admin', 'uploader']));

drop policy if exists "approved employees read annotations" on public.report_annotations;
create policy "approved employees read annotations" on public.report_annotations
for select to authenticated using (public.is_approved());

drop policy if exists "admins manage annotations" on public.report_annotations;
create policy "admins manage annotations" on public.report_annotations
for all to authenticated using (public.is_approved(array['admin']))
with check (public.is_approved(array['admin']));

revoke all on public.usps_loads from anon;
revoke all on public.report_annotations from anon;
grant select, insert, update on public.usps_loads to authenticated;
grant select, insert, update, delete on public.report_annotations to authenticated;

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
language sql stable security invoker set search_path = public
as $$
  select
    case p_grain
      when 'day' then l.operating_date
      when 'month' then date_trunc('month', l.operating_date)::date
      when 'year' then date_trunc('year', l.operating_date)::date
      else (date_trunc('week', l.operating_date + interval '2 days') - interval '2 days')::date
    end,
    count(*), sum(l.total_stops), sum(l.completed_stops), sum(l.incomplete_stops),
    case when sum(l.total_stops) = 0 then 0
      else round(sum(l.completed_stops)::numeric / sum(l.total_stops), 6) end
  from public.usps_loads l
  where l.operating_date between p_start and p_end
    and (p_contract is null or l.contract_number = p_contract)
    and (p_supervisor is null or p_supervisor = any(l.supervisors))
  group by 1 order by 1;
$$;

create or replace function public.contract_performance(p_start date, p_end date)
returns table (contract_number text, load_count bigint, total_stops bigint,
  completed_stops bigint, incomplete_stops bigint, completion_percent numeric)
language sql stable security invoker set search_path = public
as $$
  select coalesce(l.contract_number, 'Unmapped'), count(*), sum(l.total_stops),
    sum(l.completed_stops), sum(l.incomplete_stops),
    case when sum(l.total_stops)=0 then 0 else round(sum(l.completed_stops)::numeric/sum(l.total_stops),6) end
  from public.usps_loads l where l.operating_date between p_start and p_end
  group by 1 order by 6 asc;
$$;

create or replace function public.supervisor_performance(p_start date, p_end date)
returns table (supervisor text, load_count bigint, total_stops bigint,
  completed_stops bigint, incomplete_stops bigint, completion_percent numeric)
language sql stable security invoker set search_path = public
as $$
  select s, count(*), sum(l.total_stops), sum(l.completed_stops), sum(l.incomplete_stops),
    case when sum(l.total_stops)=0 then 0 else round(sum(l.completed_stops)::numeric/sum(l.total_stops),6) end
  from public.usps_loads l cross join lateral unnest(
    case when cardinality(l.supervisors)=0 then array['Unassigned']::text[] else l.supervisors end
  ) s
  where l.operating_date between p_start and p_end
  group by s order by 6 desc;
$$;

grant execute on function public.performance_trend(date,date,text,text,text) to authenticated;
grant execute on function public.contract_performance(date,date) to authenticated;
grant execute on function public.supervisor_performance(date,date) to authenticated;
