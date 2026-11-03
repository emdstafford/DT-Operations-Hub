-- DT Intelligence Hub user access management.
-- Apply this once in the Supabase SQL Editor as the postgres role before deploying
-- the matching application changes. Existing Em and Chasity tech-invoice access is preserved.

alter table public.approved_users drop constraint if exists approved_users_role_check;
alter table public.approved_users
  add constraint approved_users_role_check
  check (role in ('admin', 'uploader', 'viewer', 'dashboard_fuel_viewer', 'dashboard_contracts_fuel_viewer'));

create table if not exists public.tech_invoice_tool_users (
  email text primary key check (email = lower(email) and email like '%@dtexpress.net'),
  active boolean not null default true,
  added_at timestamptz not null default now()
);
alter table public.tech_invoice_tool_users enable row level security;
drop policy if exists "tech invoice users read own access" on public.tech_invoice_tool_users;
create policy "tech invoice users read own access"
  on public.tech_invoice_tool_users for select to authenticated
  using (active and email = lower(coalesce(auth.jwt() ->> 'email', '')));
revoke all on public.tech_invoice_tool_users from anon, authenticated;
grant select on public.tech_invoice_tool_users to authenticated;

insert into public.tech_invoice_tool_users (email, active) values
  ('estafford@dtexpress.net', true),
  ('ccochran@dtexpress.net', true)
on conflict (email) do update set active = true;

create or replace function public.is_tech_invoice_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tech_invoice_tool_users u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and u.active
  );
$$;
revoke all on function public.is_tech_invoice_user() from public;
grant execute on function public.is_tech_invoice_user() to authenticated;

drop policy if exists "DT admins can read tech invoices" on public.tech_invoices;
drop policy if exists "Em and Chasity can read tech invoices" on public.tech_invoices;
drop policy if exists "Em and Chasity can add tech invoices" on public.tech_invoices;
drop policy if exists "Em and Chasity can update tech invoices" on public.tech_invoices;
create policy "Approved tech invoice users can read invoices"
  on public.tech_invoices for select to authenticated
  using (public.is_tech_invoice_user());
create policy "Approved tech invoice users can add invoices"
  on public.tech_invoices for insert to authenticated
  with check (
    public.is_tech_invoice_user()
    and created_by = auth.uid()
    and created_by_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
create policy "Approved tech invoice users can update invoices"
  on public.tech_invoices for update to authenticated
  using (public.is_tech_invoice_user())
  with check (public.is_tech_invoice_user());

drop policy if exists "approved employees read history" on public.report_history;
create policy "standard operations users read history"
  on public.report_history for select to authenticated
  using (public.is_approved(array['admin', 'uploader', 'viewer']));

drop policy if exists "load level history read" on public.load_level_history;
create policy "standard operations users read load level history"
  on public.load_level_history for select to authenticated
  using (public.is_approved(array['admin', 'uploader', 'viewer']));

create or replace function public.list_hub_user_access()
returns table (
  email text,
  operations_role text,
  operations_active boolean,
  contract_financial_active boolean,
  fuel_active boolean,
  fuel_can_upload boolean,
  payroll_active boolean,
  tech_invoice_active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_approved(array['admin']) then
    raise exception 'DT Hub administrator access required' using errcode = '42501';
  end if;

  return query
    select all_users.email,
      approved.role,
      coalesce(approved.active, false),
      coalesce(contract_financial.active, false),
      coalesce(fuel.active, false),
      coalesce(fuel.can_upload, false),
      coalesce(payroll.active, false),
      coalesce(tech.active, false)
    from (
      select a.email from public.approved_users a
      union
      select c.email from public.contract_financial_users c
      union
      select f.email from public.fuel_tool_users f
      union
      select p.email from public.payroll_tool_users p
      union
      select t.email from public.tech_invoice_tool_users t
    ) all_users
    left join public.approved_users approved on approved.email = all_users.email
    left join public.contract_financial_users contract_financial on contract_financial.email = all_users.email
    left join public.fuel_tool_users fuel on fuel.email = all_users.email
    left join public.payroll_tool_users payroll on payroll.email = all_users.email
    left join public.tech_invoice_tool_users tech on tech.email = all_users.email
    order by all_users.email;
end;
$$;
revoke all on function public.list_hub_user_access() from public;
grant execute on function public.list_hub_user_access() to authenticated;

create or replace function public.manage_hub_user_access(
  p_email text,
  p_operations_role text,
  p_contract_financial_active boolean,
  p_fuel_active boolean,
  p_fuel_can_upload boolean,
  p_payroll_active boolean,
  p_tech_invoice_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_approved(array['admin']) then
    raise exception 'DT Hub administrator access required' using errcode = '42501';
  end if;
  if target_email !~ '^[^[:space:]@]+@dtexpress[.]net$' then
    raise exception 'Enter a valid @dtexpress.net email address';
  end if;
  if target_email = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'You cannot change your own access from User Management';
  end if;
  if p_operations_role is not null and p_operations_role not in (
    'admin', 'uploader', 'viewer', 'dashboard_fuel_viewer', 'dashboard_contracts_fuel_viewer'
  ) then
    raise exception 'Unsupported Dashboard and Contracts role';
  end if;
  if coalesce(p_fuel_can_upload, false) and not coalesce(p_fuel_active, false) then
    raise exception 'Fuel upload access requires Fuel access';
  end if;

  if p_operations_role is null then
    update public.approved_users set active = false where email = target_email;
  else
    insert into public.approved_users (email, role, active)
    values (target_email, p_operations_role, true)
    on conflict (email) do update set role = excluded.role, active = true;
  end if;

  insert into public.contract_financial_users (email, active)
  values (target_email, coalesce(p_contract_financial_active, false))
  on conflict (email) do update set active = excluded.active;

  insert into public.fuel_tool_users (email, can_upload, active)
  values (target_email, coalesce(p_fuel_can_upload, false), coalesce(p_fuel_active, false))
  on conflict (email) do update
    set can_upload = excluded.can_upload, active = excluded.active;

  insert into public.payroll_tool_users (email, active)
  values (target_email, coalesce(p_payroll_active, false))
  on conflict (email) do update set active = excluded.active;

  insert into public.tech_invoice_tool_users (email, active)
  values (target_email, coalesce(p_tech_invoice_active, false))
  on conflict (email) do update set active = excluded.active;
end;
$$;
revoke all on function public.manage_hub_user_access(text, text, boolean, boolean, boolean, boolean, boolean) from public;
grant execute on function public.manage_hub_user_access(text, text, boolean, boolean, boolean, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
