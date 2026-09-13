-- Date-aware supervisor ownership for USPS contracts.
-- Run in Supabase SQL Editor as postgres after reporting_performance_hotfix.sql.

begin;
set local statement_timeout = '120s';

create table if not exists public.contract_assignment_periods (
  contract_number text not null,
  supervisor text not null,
  start_date date not null,
  end_date date,
  created_at timestamptz not null default now(),
  primary key (contract_number, supervisor, start_date),
  check (end_date is null or end_date >= start_date)
);

create index if not exists contract_assignment_periods_lookup_idx
  on public.contract_assignment_periods (contract_number, start_date, end_date);

alter table public.contract_assignment_periods enable row level security;
drop policy if exists "approved employees read assignment periods" on public.contract_assignment_periods;
create policy "approved employees read assignment periods"
on public.contract_assignment_periods for select to authenticated
using (public.is_approved());

revoke all on public.contract_assignment_periods from anon;
grant select on public.contract_assignment_periods to authenticated;

-- Replace only the contracts Emily identified. All other assignments remain untouched.
delete from public.contract_assignment_periods
where contract_number in (
  '35034','3504W','350M3','3507P','354L1','355A4',
  '356AG','356L2','356L3','357A8','3606M','3636R','364A8','36463','3686R'
);

insert into public.contract_assignment_periods
  (contract_number, supervisor, start_date, end_date)
values
  ('35034','Tony Smith','2023-01-01','2026-07-31'),
  ('3504W','Tony Smith','2023-01-01','2026-07-31'),
  ('350M3','Tony Smith','2023-01-01','2026-07-31'),
  ('3507P','Tony Smith','2023-01-01','2026-07-31'),
  ('354L1','Tony Smith','2023-01-01','2026-07-31'),
  ('355A4','Tony Smith','2023-01-01','2026-07-31'),
  ('356AG','Tony Smith','2023-01-01','2026-07-31'),
  ('356AG','Jerry Loudermilk','2023-01-01','2026-07-31'),
  ('356L2','Tony Smith','2023-01-01','2026-07-31'),
  ('356L2','Jerry Loudermilk','2023-01-01','2026-07-31'),
  ('356L3','Tony Smith','2023-01-01','2026-07-31'),
  ('356L3','Jerry Loudermilk','2023-01-01','2026-07-31'),
  ('357A8','Tony Smith','2023-01-01','2026-07-31'),
  ('357A8','Jerry Loudermilk','2023-01-01','2026-07-31'),
  ('35034','Austin Carl','2026-08-01',null),
  ('3504W','Austin Carl','2026-08-01',null),
  ('350M3','Austin Carl','2026-08-01',null),
  ('3507P','Austin Carl','2026-08-01',null),
  ('354L1','Austin Carl','2026-08-01',null),
  ('355A4','Austin Carl','2026-08-01',null),
  ('356AG','Austin Carl','2026-08-01',null),
  ('356L2','Austin Carl','2026-08-01',null),
  ('356L3','Austin Carl','2026-08-01',null),
  ('357A8','Austin Carl','2026-08-01',null),
  ('3606M','Tony Smith','2023-01-01',null),
  ('3606M','Gerald Austin','2026-08-01',null),
  ('3636R','Tony Smith','2023-01-01',null),
  ('3636R','Austin Doswell','2023-01-01',null),
  ('364A8','Tony Smith','2023-01-01',null),
  ('36463','Tony Smith','2023-01-01',null),
  ('3686R','Tony Smith','2023-01-01',null);

create or replace function public.apply_dated_contract_assignment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  assigned_names text[];
begin
  select array_agg(a.supervisor order by a.supervisor)
  into assigned_names
  from public.contract_assignment_periods a
  where a.contract_number = new.contract_number
    and new.operating_date >= a.start_date
    and (a.end_date is null or new.operating_date <= a.end_date);

  if assigned_names is not null then
    new.supervisors := assigned_names;
  end if;
  return new;
end;
$$;

drop trigger if exists apply_dated_contract_assignment_trigger on public.usps_loads;
create trigger apply_dated_contract_assignment_trigger
before insert or update of contract_number, operating_date, supervisors
on public.usps_loads
for each row execute function public.apply_dated_contract_assignment();

-- Correct the rows already uploaded. Contracts not listed above are not changed.
with corrected_assignments as (
  select l.load_number, array_agg(a.supervisor order by a.supervisor) as names
  from public.usps_loads l
  join public.contract_assignment_periods a
    on a.contract_number = l.contract_number
   and l.operating_date >= a.start_date
   and (a.end_date is null or l.operating_date <= a.end_date)
  where l.contract_number in (
    '35034','3504W','350M3','3507P','354L1','355A4',
    '356AG','356L2','356L3','357A8','3606M','3636R','364A8','36463','3686R'
  )
  group by l.load_number
)
update public.usps_loads l
set supervisors = corrected.names, updated_at = now()
from corrected_assignments corrected
where corrected.load_number = l.load_number
  and l.supervisors is distinct from corrected.names;

create or replace function public.supervisor_contract_performance(
  p_start date,
  p_end date,
  p_supervisor text
)
returns table (
  contract_number text,
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
  select coalesce(l.contract_number, 'Unmapped'), count(*),
    sum(l.total_stops)::bigint, sum(l.completed_stops)::bigint,
    sum(l.incomplete_stops)::bigint,
    case when sum(l.total_stops)=0 then 0
      else round(sum(l.completed_stops)::numeric/sum(l.total_stops),6) end
  from public.usps_loads l
  where l.operating_date between p_start and p_end
    and p_supervisor = any(l.supervisors)
  group by 1
  order by 6 asc;
end;
$$;

revoke all on function public.supervisor_contract_performance(date,date,text) from public;
grant execute on function public.supervisor_contract_performance(date,date,text) to authenticated;

notify pgrst, 'reload schema';
commit;
