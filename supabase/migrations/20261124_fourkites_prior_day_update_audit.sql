-- Capture previous-operating-day FourKites arrivals and revisions atomically.
-- No historical deltas are inferred or backfilled from overwritten rows.
create schema if not exists dt_internal;
revoke all on schema dt_internal from public, anon, authenticated;
create table if not exists public.fourkites_prior_day_updates (
  id bigint generated always as identity primary key,
  load_number text not null,
  operating_date date not null,
  reported_period_end date not null,
  source_file text not null,
  recorded_at timestamptz not null default now(),
  contract_number text,
  trip_number text,
  supervisors text[] not null default '{}',
  event_type text not null check (event_type in ('newly_observed','revised')),
  previous_total_stops integer,
  previous_completed_stops integer,
  previous_incomplete_stops integer,
  current_total_stops integer not null,
  current_completed_stops integer not null,
  current_incomplete_stops integer not null,
  constraint fourkites_prior_day_date_check check (operating_date < reported_period_end)
);
create index if not exists fourkites_prior_day_updates_date_idx
  on public.fourkites_prior_day_updates (reported_period_end, operating_date, load_number, id);
alter table public.fourkites_prior_day_updates enable row level security;
revoke all on public.fourkites_prior_day_updates from public, anon, authenticated;
-- Only a privileged server/SQL reader may inspect history. Do not expose
-- audit records to clients and do not create authenticated read/write policies.
create or replace function dt_internal.audit_fourkites_prior_day_load()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- A load belongs to its original operating date. Ignore current-day rows.
  if new.operating_date >= new.source_period_end then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    -- Do not record reimports that only update filename/timestamps, or
    -- downstream mapping changes with identical stop performance.
    if old.operating_date is not distinct from new.operating_date
      and old.total_stops is not distinct from new.total_stops
      and old.completed_stops is not distinct from new.completed_stops
      and old.incomplete_stops is not distinct from new.incomplete_stops then
      return new;
    end if;
  end if;
  insert into public.fourkites_prior_day_updates (
    load_number, operating_date, reported_period_end, source_file,
    contract_number, trip_number, supervisors, event_type,
    previous_total_stops, previous_completed_stops, previous_incomplete_stops,
    current_total_stops, current_completed_stops, current_incomplete_stops
  ) values (
    new.load_number, new.operating_date, new.source_period_end, new.source_file,
    new.contract_number, new.trip_number, new.supervisors,
    case when tg_op = 'INSERT' then 'newly_observed' else 'revised' end,
    case when tg_op = 'INSERT' then null else old.total_stops end,
    case when tg_op = 'INSERT' then null else old.completed_stops end,
    case when tg_op = 'INSERT' then null else old.incomplete_stops end,
    new.total_stops, new.completed_stops, new.incomplete_stops
  );
  return new;
end;
$$;
revoke all on function dt_internal.audit_fourkites_prior_day_load() from public, anon, authenticated;
drop trigger if exists audit_fourkites_prior_day_load_trigger on public.usps_loads;
create trigger audit_fourkites_prior_day_load_trigger
after insert or update on public.usps_loads
for each row execute function dt_internal.audit_fourkites_prior_day_load();
