-- Private, reviewed contract pay rates. Run after usps_contract_trip_snapshots.sql.
-- Effective dates and daily/location rules must be reviewed before cost calculations.
create table if not exists public.contract_pay_rates (
  contract_number text primary key check (contract_number ~ '^[0-9A-Z]{5,6}$'),
  st_hourly numeric(10,2) check (st_hourly >= 0),
  tt_hourly numeric(10,2) check (tt_hourly >= 0),
  fringe_hourly numeric(10,2) check (fringe_hourly >= 0),
  car_hourly numeric(10,2) check (car_hourly >= 0),
  daily_rate numeric(10,2) check (daily_rate >= 0),
  needs_review boolean not null default false,
  effective_start date,
  source_file text not null,
  reviewed_by uuid not null default auth.uid() references auth.users(id),
  reviewed_at timestamptz not null default now()
);
alter table public.contract_pay_rates enable row level security;
drop policy if exists "financial users read contract pay rates" on public.contract_pay_rates;
create policy "financial users read contract pay rates" on public.contract_pay_rates for select to authenticated
  using (public.is_contract_financial_user());
drop policy if exists "financial users save contract pay rates" on public.contract_pay_rates;
create policy "financial users save contract pay rates" on public.contract_pay_rates for insert to authenticated
  with check (public.is_contract_financial_user() and reviewed_by = auth.uid());
drop policy if exists "financial users update contract pay rates" on public.contract_pay_rates;
create policy "financial users update contract pay rates" on public.contract_pay_rates for update to authenticated
  using (public.is_contract_financial_user()) with check (public.is_contract_financial_user() and reviewed_by = auth.uid());
revoke all on public.contract_pay_rates from anon, authenticated;
grant select, insert, update on public.contract_pay_rates to authenticated;
notify pgrst, 'reload schema';
