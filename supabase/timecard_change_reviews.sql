-- Per-driver review notes for a pair of payroll reports.
-- Run after supabase/timecard_summary_history.sql. Safe to rerun.

create extension if not exists pgcrypto;

create table if not exists public.timecard_change_reviews (
  id uuid primary key default gen_random_uuid(),
  earlier_report_id uuid not null references public.timecard_summary_history(id) on delete cascade,
  current_report_id uuid not null references public.timecard_summary_history(id) on delete cascade,
  employee_id text not null,
  driver_name text not null,
  review_note text not null default '',
  approved boolean not null default false,
  updated_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (earlier_report_id, current_report_id, employee_id),
  check (earlier_report_id <> current_report_id),
  check (length(trim(employee_id)) > 0)
);

create index if not exists timecard_change_reviews_pair_idx
  on public.timecard_change_reviews (earlier_report_id, current_report_id);

alter table public.timecard_change_reviews enable row level security;

drop policy if exists "payroll users read timecard change reviews" on public.timecard_change_reviews;
create policy "payroll users read timecard change reviews"
  on public.timecard_change_reviews for select to authenticated
  using (public.is_payroll_tool_user());

drop policy if exists "payroll users save timecard change reviews" on public.timecard_change_reviews;
create policy "payroll users save timecard change reviews"
  on public.timecard_change_reviews for insert to authenticated
  with check (public.is_payroll_tool_user() and updated_by = auth.uid());

drop policy if exists "payroll users update timecard change reviews" on public.timecard_change_reviews;
create policy "payroll users update timecard change reviews"
  on public.timecard_change_reviews for update to authenticated
  using (public.is_payroll_tool_user())
  with check (public.is_payroll_tool_user() and updated_by = auth.uid());

revoke all on public.timecard_change_reviews from anon;
revoke all on public.timecard_change_reviews from authenticated;
grant select, insert, update on public.timecard_change_reviews to authenticated;

notify pgrst, 'reload schema';
