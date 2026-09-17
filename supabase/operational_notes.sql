-- Persistent contract/trip context for performance and missed-stop review.
-- Run once in the Supabase SQL Editor as the postgres role.

create table if not exists public.operational_notes (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null check (length(trim(contract_number)) > 0),
  trip_number text,
  status text not null default 'waiting_on_usps'
    check (status in ('waiting_on_usps', 'monitoring', 'resolved')),
  note text not null check (length(trim(note)) > 0),
  requested_on date,
  effective_start date not null default current_date,
  effective_end date,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_end is null or effective_end >= effective_start)
);

create index if not exists operational_notes_contract_trip_idx
  on public.operational_notes (contract_number, trip_number);
create index if not exists operational_notes_effective_dates_idx
  on public.operational_notes (effective_start, effective_end);

alter table public.operational_notes enable row level security;

drop policy if exists "approved employees read operational notes" on public.operational_notes;
create policy "approved employees read operational notes"
on public.operational_notes for select to authenticated
using (public.is_approved());

drop policy if exists "approved uploaders create operational notes" on public.operational_notes;
create policy "approved uploaders create operational notes"
on public.operational_notes for insert to authenticated
with check (
  created_by = auth.uid()
  and public.is_approved(array['admin', 'uploader'])
);

drop policy if exists "approved uploaders update operational notes" on public.operational_notes;
create policy "approved uploaders update operational notes"
on public.operational_notes for update to authenticated
using (public.is_approved(array['admin', 'uploader']))
with check (public.is_approved(array['admin', 'uploader']));

drop policy if exists "approved uploaders delete operational notes" on public.operational_notes;
create policy "approved uploaders delete operational notes"
on public.operational_notes for delete to authenticated
using (public.is_approved(array['admin', 'uploader']));

revoke all on public.operational_notes from anon;
revoke all on public.operational_notes from authenticated;
grant select, insert, update, delete on public.operational_notes to authenticated;
