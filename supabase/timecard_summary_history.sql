-- Private timecard payroll history for comparing and reprinting saved pay periods.
-- Run after payroll_tool_access.sql. Safe to rerun.
create extension if not exists pgcrypto;

create or replace function public.is_payroll_tool_user()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.payroll_tool_users employee
    where employee.email = lower(auth.jwt() ->> 'email') and employee.active
  );
$$;
revoke all on function public.is_payroll_tool_user() from public;
grant execute on function public.is_payroll_tool_user() to authenticated;

create table if not exists public.timecard_summary_history (
  id uuid primary key default gen_random_uuid(),
  payroll_name text not null check (length(trim(payroll_name)) > 0),
  pay_date date not null,
  period_start date not null,
  period_end date not null,
  summary_hash text not null unique,
  source_file text not null,
  employee_count integer not null check (employee_count >= 0),
  contract_count integer not null check (contract_count >= 0),
  total_hundredths bigint not null check (total_hundredths >= 0),
  summary jsonb not null check (jsonb_typeof(summary) = 'array'),
  daily_summary jsonb not null default '[]'::jsonb check (jsonb_typeof(daily_summary) = 'array'),
  detail_rows jsonb not null default '[]'::jsonb check (jsonb_typeof(detail_rows) = 'array'),
  saved_by uuid not null default auth.uid() references auth.users(id),
  saved_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  check (period_start <= period_end),
  check (period_end - period_start <= 31),
  check (length(summary_hash) = 64)
);
create index if not exists timecard_summary_period_idx on public.timecard_summary_history (pay_date desc, saved_at desc);
alter table public.timecard_summary_history
  add column if not exists daily_summary jsonb not null default '[]'::jsonb check (jsonb_typeof(daily_summary) = 'array'),
  add column if not exists detail_rows jsonb not null default '[]'::jsonb check (jsonb_typeof(detail_rows) = 'array'),
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id);

alter table public.timecard_summary_history enable row level security;
drop policy if exists "payroll users read timecard summaries" on public.timecard_summary_history;
create policy "payroll users read timecard summaries" on public.timecard_summary_history for select to authenticated using (public.is_payroll_tool_user());
drop policy if exists "payroll users save timecard summaries" on public.timecard_summary_history;
create policy "payroll users save timecard summaries" on public.timecard_summary_history for insert to authenticated with check (public.is_payroll_tool_user() and saved_by = auth.uid());

-- Payroll staff may replace a saved payroll when ADP timecards are corrected and re-uploaded.
-- The application identifies the payroll by payroll name + the same period dates.
drop policy if exists "payroll users correct timecard summaries" on public.timecard_summary_history;
create policy "payroll users correct timecard summaries" on public.timecard_summary_history for update to authenticated
  using (public.is_payroll_tool_user()) with check (public.is_payroll_tool_user() and saved_by = auth.uid());

revoke all on public.timecard_summary_history from anon;
revoke all on public.timecard_summary_history from authenticated;
grant select, insert, update, delete on public.timecard_summary_history to authenticated;

-- One shared comparison baseline, chosen by payroll after historical files are loaded.
create table if not exists public.timecard_comparison_baseline (
  id boolean primary key default true check (id = true),
  report_id uuid not null references public.timecard_summary_history(id),
  updated_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.timecard_comparison_baseline enable row level security;
drop policy if exists "payroll users read timecard baseline" on public.timecard_comparison_baseline;
create policy "payroll users read timecard baseline" on public.timecard_comparison_baseline for select to authenticated using (public.is_payroll_tool_user());
drop policy if exists "payroll users set timecard baseline" on public.timecard_comparison_baseline;
create policy "payroll users set timecard baseline" on public.timecard_comparison_baseline for insert to authenticated with check (public.is_payroll_tool_user() and updated_by = auth.uid());
drop policy if exists "payroll users change timecard baseline" on public.timecard_comparison_baseline;
create policy "payroll users change timecard baseline" on public.timecard_comparison_baseline for update to authenticated using (public.is_payroll_tool_user()) with check (public.is_payroll_tool_user() and updated_by = auth.uid());
revoke all on public.timecard_comparison_baseline from anon;
revoke all on public.timecard_comparison_baseline from authenticated;
grant select, insert, update on public.timecard_comparison_baseline to authenticated;

drop policy if exists "payroll users archive timecard summaries" on public.timecard_summary_history;
-- Kept for compatibility with databases that already have this policy name; correction policy above supplies update access.
create policy "payroll users archive timecard summaries" on public.timecard_summary_history for update to authenticated using (public.is_payroll_tool_user()) with check (public.is_payroll_tool_user());

drop policy if exists "emily deletes timecard summaries" on public.timecard_summary_history;
create policy "emily deletes timecard summaries" on public.timecard_summary_history for delete to authenticated
  using (public.is_payroll_tool_user() and lower(auth.jwt() ->> 'email') = 'estafford@dtexpress.net'
    and not exists (select 1 from public.timecard_comparison_baseline baseline where baseline.report_id = timecard_summary_history.id));

notify pgrst, 'reload schema';
