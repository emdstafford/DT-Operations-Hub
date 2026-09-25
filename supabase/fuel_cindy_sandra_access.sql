-- Apply in the Supabase SQL Editor after the existing fuel and dashboard setup.
-- Both employees may see Dashboard and Fuel and may import fuel files and
-- manage gasoline authorization, employee limits, and fuel mileage plans.
-- They are not granted payroll or USPS report-upload roles.
alter table public.approved_users drop constraint if exists approved_users_role_check;
alter table public.approved_users add constraint approved_users_role_check
  check (role in ('admin', 'uploader', 'viewer', 'dashboard_fuel_viewer'));

insert into public.approved_users (email, role, active) values
  ('cmanus@dtexpress.net', 'dashboard_fuel_viewer', true),
  ('spage@dtexpress.net', 'dashboard_fuel_viewer', true)
on conflict (email) do update set role = excluded.role, active = true;

insert into public.fuel_tool_users (email, can_upload, active) values
  ('cmanus@dtexpress.net', true, true),
  ('spage@dtexpress.net', true, true)
on conflict (email) do update set can_upload = true, active = true;
