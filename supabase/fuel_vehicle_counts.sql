-- Run after fuel_mileage_estimates.sql. Store the vehicle mix used for each dated estimate.
alter table public.fuel_contract_mileage_plans
  add column if not exists tractor_count integer check (tractor_count >= 0),
  add column if not exists straight_truck_count integer check (straight_truck_count >= 0),
  add column if not exists van_count integer check (van_count >= 0);

notify pgrst, 'reload schema';
