-- Tech invoice tracker for DT Intelligence Hub, restricted to Em Stafford and Chasity.
-- Run in the Supabase SQL Editor as the postgres role. Safe to rerun to refresh policies.

create extension if not exists pgcrypto;

create table if not exists public.tech_invoices (
  id uuid primary key default gen_random_uuid(),
  vendor text not null check (length(trim(vendor)) > 0),
  invoice_number text,
  description text not null check (length(trim(description)) > 0),
  category text not null default 'Software',
  invoice_date date,
  due_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  paid_at date,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_by_email text not null default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paid' and paid_at is not null) or (status <> 'paid' and paid_at is null))
);

alter table public.tech_invoices alter column category set default 'Software';

create index if not exists tech_invoices_due_date_idx on public.tech_invoices (due_date);
create index if not exists tech_invoices_status_idx on public.tech_invoices (status);
create index if not exists tech_invoices_vendor_idx on public.tech_invoices (lower(vendor));
create index if not exists tech_invoices_paid_at_idx on public.tech_invoices (paid_at) where paid_at is not null;

alter table public.tech_invoices enable row level security;

drop policy if exists "DT admins can read tech invoices" on public.tech_invoices;
drop policy if exists "Em and Chasity can read tech invoices" on public.tech_invoices;
create policy "Em and Chasity can read tech invoices"
on public.tech_invoices for select to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) in ('estafford@dtexpress.net', 'ccochran@dtexpress.net'));

drop policy if exists "DT admins can add tech invoices" on public.tech_invoices;
drop policy if exists "Em and Chasity can add tech invoices" on public.tech_invoices;
create policy "Em and Chasity can add tech invoices"
on public.tech_invoices for insert to authenticated
with check (
  lower(coalesce(auth.jwt() ->> 'email', '')) in ('estafford@dtexpress.net', 'ccochran@dtexpress.net')
  and created_by = auth.uid()
  and created_by_email = lower(coalesce(auth.jwt() ->> 'email', ''))
);

drop policy if exists "DT admins can update tech invoices" on public.tech_invoices;
drop policy if exists "Em and Chasity can update tech invoices" on public.tech_invoices;
create policy "Em and Chasity can update tech invoices"
on public.tech_invoices for update to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) in ('estafford@dtexpress.net', 'ccochran@dtexpress.net'))
with check (lower(coalesce(auth.jwt() ->> 'email', '')) in ('estafford@dtexpress.net', 'ccochran@dtexpress.net'));

revoke all on public.tech_invoices from anon;
revoke all on public.tech_invoices from authenticated;
grant select on public.tech_invoices to authenticated;
grant insert (vendor, invoice_number, description, category, invoice_date, due_date, amount, status, paid_at, notes, updated_at)
  on public.tech_invoices to authenticated;
grant update (vendor, invoice_number, description, category, invoice_date, due_date, amount, status, paid_at, notes, updated_at)
  on public.tech_invoices to authenticated;
