-- Add per-invoice reminder lead times to the tech invoice tracker.
-- Run once in the Supabase SQL Editor as the postgres role.

alter table public.tech_invoices
  add column if not exists reminder_days_before smallint not null default 30;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tech_invoices_reminder_days_before_check'
      and conrelid = 'public.tech_invoices'::regclass
  ) then
    alter table public.tech_invoices
      add constraint tech_invoices_reminder_days_before_check
      check (reminder_days_before in (0, 7, 14, 30, 60));
  end if;
end $$;

grant insert (reminder_days_before) on public.tech_invoices to authenticated;
grant update (reminder_days_before) on public.tech_invoices to authenticated;
