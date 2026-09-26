-- DT Intelligence Hub - USPS contract import safety + fuel linkage
-- Run after usps_contract_financials_phase1_migration.sql

alter table public.usps_trip_rates
  add column if not exists usps_mpg numeric;

create or replace function public.cleanup_incomplete_usps_rate_imports(p_source_file_name text)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  removed integer := 0;
  r record;
  actual_trips bigint;
begin
  if not public.has_app_permission('can_edit_rates') then
    raise exception 'Rate-edit permission required' using errcode='42501';
  end if;

  for r in
    select i.id,i.trip_count,i.status
    from public.usps_rate_imports i
    where i.source_file_name=p_source_file_name
  loop
    select count(*) into actual_trips
    from public.usps_trip_rates t
    join public.usps_contract_rate_versions v on v.id=t.contract_rate_version_id
    where v.source_import_id=r.id;

    if r.status <> 'completed' or actual_trips <> r.trip_count then
      delete from public.usps_trip_rates
      where contract_rate_version_id in (
        select id from public.usps_contract_rate_versions where source_import_id=r.id
      );
      delete from public.usps_contract_rate_versions where source_import_id=r.id;
      delete from public.usps_rate_imports where id=r.id;
      removed := removed + 1;
    end if;
  end loop;

  return removed;
end;
$$;

revoke all on function public.cleanup_incomplete_usps_rate_imports(text) from public;
grant execute on function public.cleanup_incomplete_usps_rate_imports(text) to authenticated;

create or replace function public.import_usps_rate_workbook(
  p_source_file_name text,
  p_sheet_count integer,
  p_trip_count integer,
  p_sheets jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  import_id uuid;
  sheet jsonb;
  period record;
  version_id uuid;
  inserted_trips integer := 0;
begin
  if not public.has_app_permission('can_edit_rates') then
    raise exception 'Rate-edit permission required' using errcode='42501';
  end if;

  if jsonb_typeof(p_sheets) <> 'array' then
    raise exception 'Invalid USPS workbook payload';
  end if;

  insert into public.usps_rate_imports(
    source_file_name,imported_by,sheet_count,trip_count,status
  )
  values(
    p_source_file_name,auth.uid(),p_sheet_count,p_trip_count,'validating'
  )
  returning id into import_id;

  for sheet in select value from jsonb_array_elements(p_sheets)
  loop
    for period in
      select distinct
        nullif(r->>'effective_start','')::date as effective_start,
        nullif(r->>'effective_end','')::date as effective_end
      from jsonb_array_elements(sheet->'rows') r
      where nullif(r->>'effective_start','') is not null
    loop
      insert into public.usps_contract_rate_versions(
        contract_number,effective_start,effective_end,source_import_id,source_sheet_name,
        contract_status,termination_note,created_by
      )
      values(
        upper(trim(sheet->>'contractNumber')),
        period.effective_start,
        period.effective_end,
        import_id,
        sheet->>'sheetName',
        case when sheet->>'note'='Termination noted in USPS workbook' then 'terminated' else 'active' end,
        case when sheet->>'note'='Termination noted in USPS workbook' then sheet->>'note' else null end,
        auth.uid()
      )
      returning id into version_id;

      insert into public.usps_trip_rates(
        contract_rate_version_id,contract_number,trip_number,unit_cost,annual_trip_cost,
        calculated_rate_per_mile,equipment_type,frequency,annual_trip_count,wage_rate,
        health_welfare_rate,detention_rate,per_trip_miles,annual_miles,fuel_type,per_trip_hours,
        source_row_number,source_payload,usps_mpg
      )
      select
        version_id,
        upper(trim(r->>'contract_number')),
        r->>'trip_number',
        nullif(r->>'unit_cost','')::numeric,
        nullif(r->>'annual_trip_cost','')::numeric,
        nullif(r->>'calculated_rate_per_mile','')::numeric,
        nullif(r->>'equipment_type',''),
        nullif(r->>'frequency',''),
        nullif(r->>'annual_trip_count','')::numeric,
        nullif(r->>'wage_rate','')::numeric,
        nullif(r->>'health_welfare_rate','')::numeric,
        nullif(r->>'detention_rate','')::numeric,
        nullif(r->>'per_trip_miles','')::numeric,
        nullif(r->>'annual_miles','')::numeric,
        nullif(r->>'fuel_type',''),
        nullif(r->>'per_trip_hours','')::numeric,
        nullif(r->>'source_row_number','')::integer,
        coalesce(r->'source_payload','{}'::jsonb),
        nullif(r->>'usps_mpg','')::numeric
      from jsonb_array_elements(sheet->'rows') r
      where nullif(r->>'effective_start','')::date = period.effective_start
        and (
          (nullif(r->>'effective_end','') is null and period.effective_end is null)
          or nullif(r->>'effective_end','')::date = period.effective_end
        );

      get diagnostics inserted_trips = inserted_trips + row_count;
    end loop;
  end loop;

  if inserted_trips <> p_trip_count then
    raise exception 'USPS import row count mismatch: expected %, inserted %',p_trip_count,inserted_trips;
  end if;

  update public.usps_rate_imports
  set status='completed'
  where id=import_id;

  return import_id;
end;
$$;

revoke all on function public.import_usps_rate_workbook(text,integer,integer,jsonb) from public;
grant execute on function public.import_usps_rate_workbook(text,integer,integer,jsonb) to authenticated;

create or replace function public.fuel_usps_mileage_plans(p_contracts text[])
returns table(
  contract_number text,
  effective_start date,
  effective_end date,
  annual_miles numeric,
  source text,
  suggested_mpg numeric,
  equipment_basis text
)
language plpgsql
stable
security definer
set search_path=public
as $$
begin
  if not public.is_fuel_user() then
    raise exception 'Approved fuel-report account required' using errcode='42501';
  end if;

  return query
  with vm as (
    select
      v.id,
      v.contract_number,
      v.effective_start,
      v.effective_end,
      v.created_at,
      coalesce(sum(t.annual_miles),0)::numeric annual_miles,
      count(*) filter (
        where coalesce(t.annual_miles,0)>0
          and case
            when lower(coalesce(t.equipment_type,'')) like '%tractor%' then 'tractor'
            when lower(coalesce(t.equipment_type,'')) like '%straight%' then 'straight'
            when lower(coalesce(t.equipment_type,'')) like '%van%' then 'van'
            else null
          end is null
      ) unknown_equipment_rows,
      count(distinct case
        when lower(coalesce(t.equipment_type,'')) like '%tractor%' then 'tractor'
        when lower(coalesce(t.equipment_type,'')) like '%straight%' then 'straight'
        when lower(coalesce(t.equipment_type,'')) like '%van%' then 'van'
        else null
      end) equipment_class_count,
      min(case
        when lower(coalesce(t.equipment_type,'')) like '%tractor%' then 'tractor'
        when lower(coalesce(t.equipment_type,'')) like '%straight%' then 'straight'
        when lower(coalesce(t.equipment_type,'')) like '%van%' then 'van'
        else null
      end) equipment_class
    from public.usps_contract_rate_versions v
    join public.usps_trip_rates t on t.contract_rate_version_id=v.id
    where v.contract_number=any(p_contracts)
    group by v.id,v.contract_number,v.effective_start,v.effective_end,v.created_at
  ),
  li as (
    select distinct on(contract_number,effective_start,effective_end)
      contract_number,effective_start,effective_end,annual_miles,
      unknown_equipment_rows,equipment_class_count,equipment_class
    from vm
    where annual_miles>0
    order by contract_number,effective_start,effective_end,created_at desc
  )
  select
    li.contract_number,
    li.effective_start,
    li.effective_end,
    li.annual_miles,
    'USPS contract'::text,
    case
      when li.unknown_equipment_rows=0 and li.equipment_class_count=1 and li.equipment_class='tractor' then 6.4
      when li.unknown_equipment_rows=0 and li.equipment_class_count=1 and li.equipment_class='straight' then 8.5
      when li.unknown_equipment_rows=0 and li.equipment_class_count=1 and li.equipment_class='van' then 12
      else null
    end::numeric,
    case
      when li.unknown_equipment_rows=0 and li.equipment_class_count=1 then li.equipment_class
      when li.equipment_class_count>1 then 'mixed'
      else 'review'
    end::text
  from li
  order by li.contract_number,li.effective_start;
end;
$$;

revoke all on function public.fuel_usps_mileage_plans(text[]) from public;
grant execute on function public.fuel_usps_mileage_plans(text[]) to authenticated;

notify pgrst,'reload schema';
