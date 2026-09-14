-- DT Intelligence Hub role-based permissions
-- Safe repository migration: no employee identities are stored in source control.
-- Run this entire file in the Supabase SQL Editor before adding authorized users.
--
-- IMPORTANT: Financial tables must use has_app_permission(...) in their own
-- row-level security policies before TRM rates or profitability data are stored.

create table if not exists public.user_permissions (
  email text primary key check (email = lower(email)),
  full_name text not null,
  can_view_reports boolean not null default true,
  can_upload_reports boolean not null default false,
  can_edit_schedules boolean not null default false,
  can_view_rates boolean not null default false,
  can_edit_rates boolean not null default false,
  can_view_profitability boolean not null default false,
  can_admin_users boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.user_permissions enable row level security;

create or replace function public.has_app_permission(permission_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  permitted boolean;
begin
  if permission_name not in (
    'can_view_reports',
    'can_upload_reports',
    'can_edit_schedules',
    'can_view_rates',
    'can_edit_rates',
    'can_view_profitability',
    'can_admin_users'
  ) then
    return false;
  end if;

  execute format(
    'select coalesce(%I, false) from public.user_permissions where email = lower($1) and active = true',
    permission_name
  )
  into permitted
  using auth.jwt() ->> 'email';

  return coalesce(permitted, false);
end;
$$;

revoke all on function public.has_app_permission(text) from public;
grant execute on function public.has_app_permission(text) to authenticated;

drop policy if exists "Users can read their own permissions" on public.user_permissions;
create policy "Users can read their own permissions"
on public.user_permissions
for select
to authenticated
using (
  email = lower(auth.jwt() ->> 'email')
  or public.has_app_permission('can_admin_users')
);

drop policy if exists "Admins can add permissions" on public.user_permissions;
create policy "Admins can add permissions"
on public.user_permissions
for insert
to authenticated
with check (public.has_app_permission('can_admin_users'));

drop policy if exists "Admins can update permissions" on public.user_permissions;
create policy "Admins can update permissions"
on public.user_permissions
for update
to authenticated
using (public.has_app_permission('can_admin_users'))
with check (public.has_app_permission('can_admin_users'));

drop policy if exists "Admins can delete permissions" on public.user_permissions;
create policy "Admins can delete permissions"
on public.user_permissions
for delete
to authenticated
using (public.has_app_permission('can_admin_users'));

grant select on public.user_permissions to authenticated;
