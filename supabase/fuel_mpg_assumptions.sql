-- Run once in the Supabase SQL Editor after fuel_mileage_estimates.sql.
-- Adds van counts and updates only saved plans whose recorded vehicle mix
-- and MPG match the former 6/10 MPG defaults. Custom MPG plans stay unchanged.
-- Historical estimates for those updated plan dates will recalculate.

begin;

alter table public.fuel_contract_mileage_plans
  add column if not exists tractor_count integer check (tractor_count >= 0),
  add column if not exists straight_truck_count integer check (straight_truck_count >= 0),
  add column if not exists van_count integer check (van_count >= 0);

with default_plans as (
  select contract_number, effective_start,
    (tractor_count + straight_truck_count)::numeric /
      (tractor_count::numeric / 6.0 + straight_truck_count::numeric / 10.0) as old_mpg,
    (tractor_count + straight_truck_count)::numeric /
      (tractor_count::numeric / 6.4 + straight_truck_count::numeric / 8.5) as new_mpg
  from public.fuel_contract_mileage_plans
  where tractor_count is not null and straight_truck_count is not null
    and tractor_count + straight_truck_count > 0
    and coalesce(van_count, 0) = 0
)
update public.fuel_contract_mileage_plans p
set assumed_mpg = d.new_mpg
from default_plans d
where p.contract_number = d.contract_number
  and p.effective_start = d.effective_start
  and abs(p.assumed_mpg - d.old_mpg) < 0.0001;

commit;
notify pgrst, 'reload schema';
