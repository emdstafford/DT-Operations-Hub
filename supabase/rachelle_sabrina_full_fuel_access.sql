-- Apply in Supabase SQL Editor to grant Rachelle and Sabrina full Fuel access.
-- This includes fuel-file imports, gasoline authorizations, employee fuel
-- limits, mileage plans, and Fuel report print/export actions in the app.
-- Their existing payroll access is unchanged. USPS report upload remains
-- restricted to users with admin or uploader roles.
begin;

insert into public.approved_users (email, role, active) values
  ('rcoffey@dtexpress.net', 'viewer', true),
  ('slunsford@dtexpress.net', 'viewer', true)
on conflict (email) do update set role = 'viewer', active = true;

insert into public.fuel_tool_users (email, can_upload, active) values
  ('rcoffey@dtexpress.net', true, true),
  ('slunsford@dtexpress.net', true, true)
on conflict (email) do update set can_upload = true, active = true;

commit;

select a.email, a.role as dashboard_role, f.can_upload as fuel_upload_and_edit, f.active as fuel_active
from public.approved_users a
join public.fuel_tool_users f on f.email = a.email
where a.email in ('rcoffey@dtexpress.net', 'slunsford@dtexpress.net')
order by a.email;
