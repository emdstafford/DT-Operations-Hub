-- Run in the Supabase SQL Editor to grant Cindy dashboard and read-only fuel access.
-- The app hides report actions and non-scoped pages for this role; fuel writes
-- remain protected by the existing can_upload_fuel() row-level policies.
alter table public.approved_users drop constraint if exists approved_users_role_check;
alter table public.approved_users add constraint approved_users_role_check
  check (role in ('admin', 'uploader', 'viewer', 'dashboard_fuel_viewer'));

insert into public.approved_users (email, role, active)
values ('cmanus@dtexpress.net', 'dashboard_fuel_viewer', true)
on conflict (email) do update set role = excluded.role, active = true;

insert into public.fuel_tool_users (email, can_upload, active)
values ('cmanus@dtexpress.net', false, true)
on conflict (email) do update set can_upload = false, active = true;
