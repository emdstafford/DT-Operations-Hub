-- Correct shared supervision for 356AG, 356L2, 356L3, and 357A8.
-- Jerry Loudermilk remains active; Austin Carl joins effective 2026-08-01.
-- Run once in the Supabase SQL Editor as postgres.

begin;
set local statement_timeout = '120s';

insert into public.contract_assignment_periods
  (contract_number, supervisor, start_date, end_date)
values
  ('356AG', 'Jerry Loudermilk', '2023-01-01', null),
  ('356L2', 'Jerry Loudermilk', '2023-01-01', null),
  ('356L3', 'Jerry Loudermilk', '2023-01-01', null),
  ('357A8', 'Jerry Loudermilk', '2023-01-01', null)
on conflict (contract_number, supervisor, start_date)
do update set end_date = excluded.end_date;

with corrected_assignments as (
  select
    l.load_number,
    array_agg(a.supervisor order by a.supervisor) as supervisors
  from public.usps_loads l
  join public.contract_assignment_periods a
    on a.contract_number = l.contract_number
   and l.operating_date >= a.start_date
   and (a.end_date is null or l.operating_date <= a.end_date)
  where l.contract_number in ('356AG', '356L2', '356L3', '357A8')
  group by l.load_number
)
update public.usps_loads l
set supervisors = c.supervisors,
    updated_at = now()
from corrected_assignments c
where l.load_number = c.load_number
  and l.supervisors is distinct from c.supervisors;

commit;

select
  supervisor,
  count(*) as loads,
  sum(l.total_stops) as total_stops,
  sum(l.incomplete_stops) as incomplete_stops,
  case when sum(l.total_stops) = 0 then 0
    else round(sum(l.completed_stops)::numeric / sum(l.total_stops), 6)
  end as completion_percent
from public.usps_loads l
cross join lateral unnest(l.supervisors) supervisor
where l.operating_date between date '2026-09-05' and date '2026-09-11'
  and l.contract_number in ('356AG', '356L2', '356L3', '357A8')
  and supervisor in ('Austin Carl', 'Jerry Loudermilk')
group by supervisor
order by supervisor;
