-- Add billing frequency and recurring due-date projections to the tech invoice tracker.
-- Run once in the Supabase SQL Editor as the postgres role.

alter table public.tech_invoices
  add column if not exists billing_frequency text not null default 'one_time';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tech_invoices_billing_frequency_check'
      and conrelid = 'public.tech_invoices'::regclass
  ) then
    alter table public.tech_invoices
      add constraint tech_invoices_billing_frequency_check
      check (billing_frequency in ('one_time', 'monthly', 'biweekly', 'yearly'));
  end if;
end $$;

grant insert (billing_frequency) on public.tech_invoices to authenticated;
grant update (billing_frequency) on public.tech_invoices to authenticated;
