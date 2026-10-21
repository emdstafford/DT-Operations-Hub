-- Add payroll-restricted employee details to each saved Holiday Hours import.
-- Run once in the Supabase SQL Editor as the postgres role.
-- Existing records receive an empty array; details are captured by future imports
-- (or by reprocessing an older source CSV).
alter table public.holiday_import_history
  add column if not exists employee_details jsonb not null default '[]'::jsonb;

comment on column public.holiday_import_history.employee_details is
  'Included employee calculation rows. Access is protected by the existing payroll-user RLS policy.';

-- Only payroll users explicitly granted this flag may permanently delete archived records.
alter table public.payroll_tool_users
  add column if not exists can_delete_holiday_history boolean not null default false;

create or replace function public.is_holiday_history_admin()
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
      and employee.can_delete_holiday_history
  );
$$;

revoke all on function public.is_holiday_history_admin() from public;
grant execute on function public.is_holiday_history_admin() to authenticated;

alter table public.holiday_import_history enable row level security;
drop policy if exists "holiday admins delete archived history" on public.holiday_import_history;
create policy "holiday admins delete archived history"
on public.holiday_import_history for delete to authenticated
using (public.is_holiday_history_admin() and archived_at is not null);

grant delete on public.holiday_import_history to authenticated;

-- Grant permanent archive deletion only to Em's Hub account.
update public.payroll_tool_users
set can_delete_holiday_history = (email = 'estafford@dtexpress.net')
where email in (
  'estafford@dtexpress.net'
);
