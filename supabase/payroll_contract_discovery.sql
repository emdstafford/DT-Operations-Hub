-- Run as postgres after contract_register_2026_11_16.sql and timecard_summary_history.sql.
-- Payroll saves discover shared contract identities atomically. Never delete history,
-- infer term dates from payroll dates, or reactivate an ended contract on re-upload.
begin;

create or replace function public.canonical_contract_number(p_contract text)
returns text language sql immutable strict parallel safe
set search_path = ''
as $$
  select case
    when upper(trim(p_contract)) ~ '^0*[0-9]' then
      case regexp_replace(upper(trim(p_contract)), '^0+', '')
        when '1SHDR' then '01SHDR'
        when '11VAN' then '011VAN'
        when '' then '0'
        else regexp_replace(upper(trim(p_contract)), '^0+', '') end
    else upper(trim(p_contract)) end;
$$;

-- A shared operation for the trigger and one-time backfill. No employee data is
-- copied into the contract register. Unknown metadata stays blank for review.
create or replace function dt_contract_internal.register_payroll_contracts(p_summary jsonb)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  insert into public.contract_supervisors
    (contract_number, supervisor, region, active, source)
  select distinct public.canonical_contract_number(item ->> 'contract'),
    '', '', true, 'Payroll upload - details need review'
  from jsonb_array_elements(p_summary) item
  where public.canonical_contract_number(item ->> 'contract') ~ '^[1-9][A-Z0-9]{4}$'
    and not exists (
      select 1 from public.contract_supervisors existing
      where public.canonical_contract_number(existing.contract_number)
        = public.canonical_contract_number(item ->> 'contract')
    )
  on conflict (contract_number) do nothing;

  -- Refresh only Emily's dated register; uploaded historical dates never control status.
  update public.contract_supervisors c
  set active = (now() at time zone 'America/New_York')::date between c.start_date and c.end_date
  where c.source = 'Emily contract register 2026-11-16'
    and c.start_date is not null and c.end_date is not null
    and c.active is distinct from ((now() at time zone 'America/New_York')::date between c.start_date and c.end_date);
end;
$$;
revoke all on function dt_contract_internal.register_payroll_contracts(jsonb) from public, anon, authenticated;

create or replace function dt_contract_internal.discover_saved_payroll_contracts()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_payroll_tool_user() then
    raise exception 'Authorized payroll account required' using errcode = '42501';
  end if;
  perform dt_contract_internal.register_payroll_contracts(new.summary);
  return new;
end;
$$;
revoke all on function dt_contract_internal.discover_saved_payroll_contracts() from public, anon, authenticated;
drop trigger if exists discover_saved_payroll_contracts on public.timecard_summary_history;
create trigger discover_saved_payroll_contracts
  after insert or update of summary on public.timecard_summary_history
  for each row execute function dt_contract_internal.discover_saved_payroll_contracts();

-- Existing saved payrolls also contribute identities; originals remain untouched.
do $$
declare saved record;
begin
  for saved in select summary from public.timecard_summary_history loop
    perform dt_contract_internal.register_payroll_contracts(saved.summary);
  end loop;
end;
$$;

-- Include payroll-only and upcoming registered contracts before their first load.
-- Normalize options without deleting padded source rows or altering their history.
create or replace function public.contract_options()
returns table (contract_number text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_approved() then
    raise exception 'Approved DT Express account required' using errcode = '42501';
  end if;
  return query
  select distinct public.canonical_contract_number(known.contract_number)
  from (
    select c.contract_number from public.contract_supervisors c
    union all
    select l.contract_number from public.usps_loads l
  ) known
  where known.contract_number is not null and trim(known.contract_number) <> ''
  order by 1;
end;
$$;
revoke all on function public.contract_options() from public;
grant execute on function public.contract_options() to authenticated;
notify pgrst, 'reload schema';
commit;
