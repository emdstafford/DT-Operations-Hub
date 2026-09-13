-- DT Operations Hub secure shared history
create extension if not exists pgcrypto;

create table if not exists public.approved_users (
  email text primary key check (email = lower(email) and email like '%@dtexpress.net'),
  role text not null default 'viewer' check (role in ('admin', 'uploader', 'viewer')),
  active boolean not null default true,
  added_at timestamptz not null default now()
);

insert into public.approved_users (email, role)
values ('estafford@dtexpress.net', 'admin')
on conflict (email) do update set role = excluded.role, active = true;

create table if not exists public.report_history (
  id uuid primary key default gen_random_uuid(),
  report_type text not null check (report_type in ('usps_loads', 'missed_stops')),
  period_start date not null,
  period_end date not null,
  source_file text not null,
  data jsonb not null,
  uploaded_by uuid not null references auth.users(id),
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_type, period_start, period_end)
);

alter table public.approved_users enable row level security;
alter table public.report_history enable row level security;

create or replace function public.is_approved(required_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.approved_users employee
    where employee.email = lower(auth.jwt() ->> 'email')
      and employee.active
      and (required_roles is null or employee.role = any(required_roles))
  );
$$;
revoke all on function public.is_approved(text[]) from public;
grant execute on function public.is_approved(text[]) to authenticated;

drop policy if exists "approved user reads own approval" on public.approved_users;
create policy "approved user reads own approval"
on public.approved_users for select to authenticated
using (active and email = lower(auth.jwt() ->> 'email'));

drop policy if exists "admins read approved users" on public.approved_users;
create policy "admins read approved users"
on public.approved_users for select to authenticated
using (public.is_approved(array['admin']));

drop policy if exists "approved employees read history" on public.report_history;
create policy "approved employees read history"
on public.report_history for select to authenticated
using (public.is_approved());

drop policy if exists "approved uploaders create history" on public.report_history;
create policy "approved uploaders create history"
on public.report_history for insert to authenticated
with check (uploaded_by = auth.uid() and public.is_approved(array['admin', 'uploader']));

drop policy if exists "approved uploaders update history" on public.report_history;
create policy "approved uploaders update history"
on public.report_history for update to authenticated
using (public.is_approved(array['admin', 'uploader']))
with check (uploaded_by = auth.uid() and public.is_approved(array['admin', 'uploader']));

revoke all on public.approved_users from anon;
revoke all on public.report_history from anon;
grant select on public.approved_users to authenticated;
grant select, insert, update on public.report_history to authenticated;
