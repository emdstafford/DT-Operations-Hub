-- Use authoritative USPS annual schedule miles as the default Fuel Reports mileage plan.
-- Manual fuel_contract_mileage_plans remain available as dated overrides.

create or replace function public.fuel_usps_mileage_plans(p_contracts text[])
returns table (
  contract_number text,
  effective_start date,
  effective_end date,
  annual_miles numeric,
  source text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_fuel_user() then
    raise exception 'Approved fuel-report account required' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_contracts),0) > 200 then
    raise exception 'Too many contracts requested' using errcode = '22023';
  end if;

  return query
  with version_miles as (
    select
      v.id,
      v.contract_number,
      v.effective_start,
      v.effective_end,
      v.created_at,
      coalesce(sum(t.annual_miles),0)::numeric as annual_miles
    from public.usps_contract_rate_versions v
    join public.usps_trip_rates t on t.contract_rate_version_id = v.id
    where v.contract_number = any(p_contracts)
    group by v.id, v.contract_number, v.effective_start, v.effective_end, v.created_at
  ),
  latest_import as (
    select distinct on (contract_number, effective_start)
      contract_number, effective_start, effective_end, annual_miles
    from version_miles
    where annual_miles > 0
    order by contract_number, effective_start, created_at desc
  )
  select l.contract_number, l.effective_start, l.effective_end, l.annual_miles, 'USPS contract'::text
  from latest_import l
  order by l.contract_number, l.effective_start;
end;
$$;

revoke all on function public.fuel_usps_mileage_plans(text[]) from public;
grant execute on function public.fuel_usps_mileage_plans(text[]) to authenticated;

notify pgrst, 'reload schema';
