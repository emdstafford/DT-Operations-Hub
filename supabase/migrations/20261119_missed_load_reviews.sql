-- Missed-load review workflow. Separate from USPS results; no change to performance calculations.
create table if not exists public.missed_load_reviews (
  id uuid primary key default gen_random_uuid(),
  operating_date date not null,
  contract_number text not null,
  trip_number text not null default '',
  load_number text not null,
  supervisors text[] not null default '{}',
  reason text not null check (reason in (
    'Driver late','Mechanical breakdown','USPS delay','Traffic or weather',
    'Missed stop / route issue','Other','Driver Name Change','Incorrect Times',
    'Incorrect Frequency','Incorrect NASS Code','Incorrect Contract/Trip Assignment'
  )),
  explanation text not null check (length(btrim(explanation)) between 1 and 4000),
  source text not null default 'phone' check (source in ('supervisor_portal','phone','text','email','in_person','other')),
  reported_by text not null default '',
  recorded_by uuid not null default auth.uid(),
  recorded_by_email text not null default lower(coalesce(auth.jwt()->>'email','')),
  review_status text not null default 'needs_review' check (review_status in ('needs_review','reviewed','follow_up')),
  ticket_status text not null default 'not_needed' check (ticket_status in ('not_needed','needs_ticket','ticket_sent','resolved')),
  updated_by uuid not null default auth.uid(),
  updated_by_email text not null default lower(coalesce(auth.jwt()->>'email','')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operating_date,contract_number,trip_number,load_number),
  constraint correction_needs_ticket check (
    reason not in ('Driver Name Change','Incorrect Times','Incorrect Frequency','Incorrect NASS Code','Incorrect Contract/Trip Assignment')
    or ticket_status <> 'not_needed'
  )
);
create index if not exists missed_load_reviews_date_idx on public.missed_load_reviews (operating_date desc,contract_number);
create index if not exists missed_load_reviews_status_idx on public.missed_load_reviews (review_status,ticket_status);

create table if not exists public.missed_load_review_events (
  id bigint generated always as identity primary key,
  review_id uuid not null references public.missed_load_reviews(id),
  event_type text not null check (event_type in ('created','updated')),
  before_value jsonb,
  after_value jsonb not null,
  changed_by uuid not null,
  changed_by_email text not null,
  changed_at timestamptz not null default now()
);
create index if not exists missed_load_review_events_review_idx on public.missed_load_review_events(review_id,changed_at);

create or replace function public.validate_missed_load_review()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op='INSERT' then
    if not exists (
      select 1 from public.usps_loads l
      where l.operating_date=new.operating_date
        and public.canonical_contract_number(l.contract_number)=public.canonical_contract_number(new.contract_number)
        and coalesce(btrim(l.trip_number),'')=new.trip_number
        and btrim(l.load_number)=new.load_number
        and l.incomplete_stops>0
        and not (public.canonical_contract_number(l.contract_number)='3773G' and l.operating_date>date '2026-11-13')
    ) then raise exception 'This review must match an existing USPS load with missed stops.'; end if;
    new.recorded_by:=auth.uid();
    new.recorded_by_email:=lower(coalesce(auth.jwt()->>'email',''));
  elsif (new.operating_date,new.contract_number,new.trip_number,new.load_number)
      is distinct from (old.operating_date,old.contract_number,old.trip_number,old.load_number) then
    raise exception 'A review cannot be moved to another load.';
  end if;
  new.updated_by:=auth.uid();
  new.updated_by_email:=lower(coalesce(auth.jwt()->>'email',''));
  new.updated_at:=now();
  return new;
end;
$$;
drop trigger if exists trg_validate_missed_load_review on public.missed_load_reviews;
create trigger trg_validate_missed_load_review before insert or update on public.missed_load_reviews
for each row execute function public.validate_missed_load_review();

create or replace function public.log_missed_load_review_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.missed_load_review_events(review_id,event_type,before_value,after_value,changed_by,changed_by_email)
  values(new.id,case when tg_op='INSERT' then 'created' else 'updated' end,
    case when tg_op='INSERT' then null else to_jsonb(old) end,to_jsonb(new),
    auth.uid(),lower(coalesce(auth.jwt()->>'email','')));
  return null;
end;
$$;
drop trigger if exists trg_log_missed_load_review on public.missed_load_reviews;
create trigger trg_log_missed_load_review after insert or update on public.missed_load_reviews
for each row execute function public.log_missed_load_review_change();

alter table public.missed_load_reviews enable row level security;
alter table public.missed_load_review_events enable row level security;
drop policy if exists "operations reviewers read missed loads" on public.missed_load_reviews;
create policy "operations reviewers read missed loads" on public.missed_load_reviews
for select to authenticated using (public.is_approved(array['admin','uploader','viewer']::text[]));
drop policy if exists "operations managers create missed reviews" on public.missed_load_reviews;
create policy "operations managers create missed reviews" on public.missed_load_reviews
for insert to authenticated with check (public.is_approved(array['admin','uploader']::text[]) and recorded_by=auth.uid());
drop policy if exists "operations managers update missed reviews" on public.missed_load_reviews;
create policy "operations managers update missed reviews" on public.missed_load_reviews
for update to authenticated using (public.is_approved(array['admin','uploader']::text[]))
with check (public.is_approved(array['admin','uploader']::text[]));
drop policy if exists "operations reviewers read missed review history" on public.missed_load_review_events;
create policy "operations reviewers read missed review history" on public.missed_load_review_events
for select to authenticated using (public.is_approved(array['admin','uploader','viewer']::text[]));
revoke all on public.missed_load_reviews from anon;
revoke all on public.missed_load_review_events from anon;
grant select,insert,update on public.missed_load_reviews to authenticated;
grant select on public.missed_load_review_events to authenticated;
revoke all on function public.log_missed_load_review_change() from public,anon,authenticated;
revoke all on function public.validate_missed_load_review() from public,anon;
grant execute on function public.validate_missed_load_review() to authenticated;
