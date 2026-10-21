-- Add payroll-restricted employee details to each saved Holiday Hours import.
-- Run once in the Supabase SQL Editor as the postgres role.
-- Existing records receive an empty array; details are captured by future imports
-- (or by reprocessing an older source CSV).
alter table public.holiday_import_history
  add column if not exists employee_details jsonb not null default '[]'::jsonb;

comment on column public.holiday_import_history.employee_details is
  'Included employee calculation rows. Access is protected by the existing payroll-user RLS policy.';
