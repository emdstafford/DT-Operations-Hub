-- Restricted access for browser-based payroll utilities.
-- Run in Supabase SQL Editor as the postgres role.

create table if not exists public.payroll_tool_users (
  email text primary key check (email = lower(email) and email like '%@dtexpress.net'),
  active boolean not null default true,
  added_at timestamptz not null default now()
);

alter table public.payroll_tool_users enable row level security;

drop policy if exists "payroll users read own access" on public.payroll_tool_users;
create policy "payroll users read own access"
on public.payroll_tool_users for select to authenticated
using (active and email = lower(auth.jwt() ->> 'email'));

revoke all on public.payroll_tool_users from anon;
revoke all on public.payroll_tool_users from authenticated;
grant select on public.payroll_tool_users to authenticated;
