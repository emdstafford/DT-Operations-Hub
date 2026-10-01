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

-- Reconciliation/payment logic is effective-dated and attached to the trip/contract,
-- not hard-coded to a supervisor name. Tonya's designated trips use contract_mile_cap;
-- other trips remain actual_clear unless another documented rule is added later.
create table if not exists public.contract_trip_reconciliation_rules (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null,
  trip_number text,
  rule_type text not null default 'actual_clear'
    check (rule_type in ('actual_clear','contract_mile_cap','manual_review')),
  effective_from date not null,
  effective_to date,
  reason text,
  source_document_id uuid references public.contract_source_documents(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint contract_trip_reconciliation_rules_dates
    check (effective_to is null or effective_to >= effective_from)
);

create index if not exists contract_trip_recon_rule_lookup_idx
  on public.contract_trip_reconciliation_rules
  (contract_number, trip_number, effective_from desc);

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

create or replace function public.contract_trip_reconciliation_rule_as_of(
  p_contract text,
  p_trip text,
  p_date date
)
returns text
language sql
stable
security invoker
as $$
  select coalesce(
    (
      select r.rule_type
      from public.contract_trip_reconciliation_rules r
      where r.contract_number = p_contract
        and (r.trip_number = p_trip or r.trip_number is null)
        and r.effective_from <= p_date
        and (r.effective_to is null or r.effective_to >= p_date)
      order by (r.trip_number is not null) desc, r.effective_from desc
      limit 1
    ),
    'actual_clear'
  );
$$;

create or replace function public.reconciled_trip_miles(
  p_contract text,
  p_trip text,
  p_service_date date,
  p_clear_miles numeric
)
returns numeric
language plpgsql
stable
security invoker
as $$
declare
  v_rule text;
  v_contract_miles numeric;
begin
  v_rule := public.contract_trip_reconciliation_rule_as_of(p_contract, p_trip, p_service_date);

  if v_rule = 'contract_mile_cap' then
    select v.trip_miles into v_contract_miles
    from public.contract_trip_versions v
    where v.contract_number = p_contract
      and v.trip_number = p_trip
      and v.effective_from <= p_service_date
      and (v.effective_to is null or v.effective_to >= p_service_date)
    order by v.effective_from desc
    limit 1;

    if v_contract_miles is null then
      return null; -- do not silently guess when the contract/SVC mileage is missing
    end if;
    return least(p_clear_miles, v_contract_miles);
  end if;

  if v_rule = 'manual_review' then
    return null;
  end if;

  return p_clear_miles;
end;
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
alter table public.contract_trip_reconciliation_rules enable row level security;

-- Authenticated DT users can read the shared contract history/rules.
drop policy if exists contract_source_documents_read on public.contract_source_documents;
create policy contract_source_documents_read on public.contract_source_documents
for select to authenticated using (true);

drop policy if exists contract_trip_versions_read on public.contract_trip_versions;
create policy contract_trip_versions_read on public.contract_trip_versions
for select to authenticated using (true);

drop policy if exists contract_trip_reconciliation_rules_read on public.contract_trip_reconciliation_rules;
create policy contract_trip_reconciliation_rules_read on public.contract_trip_reconciliation_rules
for select to authenticated using (true);

-- Writes remain explicit/admin-controlled through the application/service path.
comment on table public.contract_trip_versions is
'Effective-dated source of truth for USPS contract trips. Never overwrite history; new SVCs close prior versions and insert new versions.';
comment on table public.contract_trip_reconciliation_rules is
'Effective-dated reconciliation rules. contract_mile_cap means payable/reconciled miles are the lower of CLEAR actual miles and contract/SVC miles effective on the service date.';

notify pgrst, 'reload schema';
