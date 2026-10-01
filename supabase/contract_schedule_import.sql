-- DT Intelligence Hub: reviewed USPS schedule imports into effective-dated trip history.
-- Run once in Supabase SQL Editor after contract_trip_master.sql and usps_contract_trip_snapshots.sql.

create or replace function public.save_contract_schedule_import(
  p_contract text,
  p_document_name text,
  p_trips jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_doc uuid;
  v_trip jsonb;
  v_trip_number text;
  v_effective_from date;
  v_effective_to date;
  v_existing public.contract_trip_versions%rowtype;
  v_prior_count integer := 0;
  v_inserted integer := 0;
  v_unchanged integer := 0;
  v_changed integer := 0;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_contract_financial_user() then
    raise exception 'Contract financial access required';
  end if;

  if p_contract is null or p_contract !~ '^[0-9A-Z]{5,6}$' then
    raise exception 'Invalid contract number';
  end if;

  if jsonb_typeof(p_trips) <> 'array' or jsonb_array_length(p_trips) = 0 then
    raise exception 'No reviewed trips supplied';
  end if;

  insert into public.contract_source_documents(
    contract_number, document_type, document_name, effective_date, imported_by, notes
  )
  values (
    upper(p_contract),
    case when exists(select 1 from public.contract_source_documents d where d.contract_number = upper(p_contract)) then 'svc' else 'base_contract' end,
    p_document_name,
    (
      select min(nullif(x->>'effectiveFrom','')::date)
      from jsonb_array_elements(p_trips) x
    ),
    v_user,
    p_notes
  )
  returning id into v_doc;

  for v_trip in select * from jsonb_array_elements(p_trips)
  loop
    v_trip_number := nullif(v_trip->>'tripNumber','');
    v_effective_from := nullif(v_trip->>'effectiveFrom','')::date;
    v_effective_to := nullif(v_trip->>'effectiveTo','')::date;

    if v_trip_number is null or v_effective_from is null then
      raise exception 'Trip number and effective date are required for every saved trip';
    end if;

    select * into v_existing
    from public.contract_trip_versions v
    where v.contract_number = upper(p_contract)
      and v.trip_number = v_trip_number
      and v.effective_from = v_effective_from
    order by v.created_at desc
    limit 1;

    if found
      and coalesce(v_existing.frequency_code,'') = coalesce(v_trip->>'frequencyCode','')
      and coalesce(v_existing.vehicle_type,'') = coalesce(v_trip->>'vehicleType','')
      and v_existing.trip_miles is not distinct from nullif(v_trip->>'tripMiles','')::numeric
      and v_existing.trip_hours is not distinct from nullif(v_trip->>'tripHours','')::numeric
      and v_existing.effective_to is not distinct from v_effective_to
    then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    select count(*) into v_prior_count
    from public.contract_trip_versions v
    where v.contract_number = upper(p_contract)
      and v.trip_number = v_trip_number;

    -- Close any older open version immediately before this effective date.
    update public.contract_trip_versions v
    set effective_to = v_effective_from - 1
    where v.contract_number = upper(p_contract)
      and v.trip_number = v_trip_number
      and v.effective_from < v_effective_from
      and (v.effective_to is null or v.effective_to >= v_effective_from);

    -- If a record exists at the exact effective date but differs, preserve history
    -- by replacing only that same-date draft/imported row with the newly reviewed values.
    delete from public.contract_trip_versions v
    where v.contract_number = upper(p_contract)
      and v.trip_number = v_trip_number
      and v.effective_from = v_effective_from;

    insert into public.contract_trip_versions(
      contract_number, trip_number, frequency_code, trip_miles, trip_hours,
      vehicle_type, effective_from, effective_to, change_type,
      source_document_id, source_notes, created_by
    )
    values (
      upper(p_contract),
      v_trip_number,
      nullif(v_trip->>'frequencyCode',''),
      nullif(v_trip->>'tripMiles','')::numeric,
      nullif(v_trip->>'tripHours','')::numeric,
      nullif(v_trip->>'vehicleType',''),
      v_effective_from,
      v_effective_to,
      case when v_prior_count = 0 then 'base' else 'update' end,
      v_doc,
      nullif(v_trip->>'sourceNotes',''),
      v_user
    );

    v_inserted := v_inserted + 1;
    if v_prior_count > 0 then v_changed := v_changed + 1; end if;
  end loop;

  return jsonb_build_object(
    'document_id', v_doc,
    'saved', v_inserted,
    'changed', v_changed,
    'unchanged', v_unchanged
  );
end;
$$;

revoke all on function public.save_contract_schedule_import(text,text,jsonb,text) from public;
grant execute on function public.save_contract_schedule_import(text,text,jsonb,text) to authenticated;

notify pgrst, 'reload schema';
