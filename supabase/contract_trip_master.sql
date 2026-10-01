-- DT Intelligence Hub: Contract Trip Master / SVC History
-- Run in Supabase SQL editor once before enabling persistent trip-history UI.

create extension if not exists pgcrypto;

create table if not exists public.contract_source_documents (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null,
  document_type text not null check (document_type in ('base_contract','svc','amendment','other')),
  document_name text not null,
  source_file_url text,
  signed_date date,
  effective_date date,
  imported_by uuid references auth.users(id),
  imported_at timestamptz not null default now(),
  notes text
);

create index if not exists contract_source_documents_contract_idx
  on public.contract_source_documents (contract_number, effective_date desc);

create table if not exists public.contract_trip_versions (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null,
  trip_number text not null,
  clear_trip_id text,
  rate_group text,
  supervisor_name text,
  frequency_code text,
  trip_miles numeric(12,3),
  trip_hours numeric(12,3),
  vehicle_type text,
  effective_from date not null,
  effective_to date,
  change_type text not null default 'update' check (change_type in ('base','new','update','remove')),
  source_document_id uuid references public.contract_source_documents(id),
  source_notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint contract_trip_versions_dates check (effective_to is null or effective_to >= effective_from)
);

create index if not exists contract_trip_versions_lookup_idx
  on public.contract_trip_versions (contract_number, trip_number, effective_from desc);
create index if not exists contract_trip_versions_clear_idx
  on public.contract_trip_versions (contract_number, clear_trip_id, effective_from desc);

-- Prevent overlapping effective periods for the same contract/trip.
create extension if not exists btree_gist;
alter table public.contract_trip_versions
  drop constraint if exists contract_trip_versions_no_overlap;
alter table public.contract_trip_versions
  add constraint contract_trip_versions_no_overlap
  exclude using gist (
    contract_number with =,
    trip_number with =,
    daterange(effective_from, coalesce(effective_to + 1, 'infinity'::date), '[)') with &&
  );

create or replace function public.contract_trip_as_of(
  p_contract text,
  p_trip text,
  p_date date
)
returns setof public.contract_trip_versions
language sql
stable
security invoker
as $$
  select v.*
  from public.contract_trip_versions v
  where v.contract_number = p_contract
    and v.trip_number = p_trip
    and v.effective_from <= p_date
    and (v.effective_to is null or v.effective_to >= p_date)
  order by v.effective_from desc
  limit 1;
$$;

create or replace view public.contract_trip_current as
select distinct on (contract_number, trip_number)
  *
from public.contract_trip_versions
where effective_from <= current_date
  and (effective_to is null or effective_to >= current_date)
order by contract_number, trip_number, effective_from desc;

alter table public.contract_source_documents enable row level security;
alter table public.contract_trip_versions enable row level security;

-- Authenticated DT users can read the shared contract history.
drop policy if exists contract_source_documents_read on public.contract_source_documents;
create policy contract_source_documents_read on public.contract_source_documents
for select to authenticated using (true);

drop policy if exists contract_trip_versions_read on public.contract_trip_versions;
create policy contract_trip_versions_read on public.contract_trip_versions
for select to authenticated using (true);

-- Writes remain explicit/admin-controlled through the application/service path.
comment on table public.contract_trip_versions is
'Effective-dated source of truth for USPS contract trips. Never overwrite history; new SVCs close prior versions and insert new versions.';
