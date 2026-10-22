-- Add the optional account number field to the existing tech invoice tracker.
-- Run once in the Supabase SQL Editor as the postgres role.

alter table public.tech_invoices
  add column if not exists account_number text;

grant insert (account_number) on public.tech_invoices to authenticated;
grant update (account_number) on public.tech_invoices to authenticated;
