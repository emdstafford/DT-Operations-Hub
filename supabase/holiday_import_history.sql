-- Secure summary history for the Holiday Hours Import tool.
-- Run once in the Supabase SQL Editor as the postgres role.
-- Employee-level payroll rows and generated CSV contents are never stored here.

create extension if not exists pgcrypto;

create or replace function public.is_payroll_tool_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.payroll_tool_users employee
    where employee.email = lower(auth.jwt() ->> 'email')
      and employee.active
  );
$$;

revoke all on function public.is_payroll_tool_user() from public;
grant execute on function public.is_payroll_tool_user() to authenticated;

create table if not exists public.holiday_import_history (
  id uuid primary key default gen_random_uuid(),
  holiday_name text not null check (length(trim(holiday_name)) > 0),
  holiday_date date not null,
  source_file text not null,
  source_rows integer not null check (source_rows >= 0),
  unique_employees integer not null check (unique_employees >= 0),
  combined_source_hours numeric(12,2) not null check (combined_source_hours >= 0),
  capped_at_eight integer not null check (capped_at_eight >= 0),
  total_holiday_hours numeric(12,2) not null check (total_holiday_hours >= 0),
  processed_by uuid not null default auth.uid() references auth.users(id),
  processed_by_email text not null default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists holiday_import_history_date_idx
  on public.holiday_import_history (holiday_date desc);
create index if not exists holiday_import_history_name_idx
  on public.holiday_import_history (lower(holiday_name));

alter table public.holiday_import_history enable row level security;

drop policy if exists "payroll users read holiday history" on public.holiday_import_history;
create policy "payroll users read holiday history"
on public.holiday_import_history for select to authenticated
using (public.is_payroll_tool_user());

drop policy if exists "payroll users create holiday history" on public.holiday_import_history;
create policy "payroll users create holiday history"
on public.holiday_import_history for insert to authenticated
with check (
  public.is_payroll_tool_user()
  and processed_by = auth.uid()
  and processed_by_email = lower(auth.jwt() ->> 'email')
);

drop policy if exists "payroll users update holiday history" on public.holiday_import_history;
create policy "payroll users update holiday history"
on public.holiday_import_history for update to authenticated
using (public.is_payroll_tool_user())
with check (public.is_payroll_tool_user());

revoke all on public.holiday_import_history from anon;
revoke all on public.holiday_import_history from authenticated;
grant select, insert on public.holiday_import_history to authenticated;
grant update (holiday_name, holiday_date, updated_at)
  on public.holiday_import_history to authenticated;
