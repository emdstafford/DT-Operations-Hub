-- Run in the Supabase SQL Editor. Review and correct Comdata Misc 2 values
-- without changing the imported transaction amounts or deduplication keys.

create table if not exists public.fuel_contract_corrections (
  id bigint generated always as identity primary key,
  old_label text not null,
  new_contract text not null,
  person_name text not null,
  period_start date not null,
  period_end date not null,
  line_items integer not null,
  total_cost numeric not null,
  corrected_by uuid not null default auth.uid(),
  corrected_at timestamptz not null default now()
);

alter table public.fuel_contract_corrections enable row level security;
drop policy if exists "fuel editors read contract corrections" on public.fuel_contract_corrections;
create policy "fuel editors read contract corrections" on public.fuel_contract_corrections
  for select to authenticated using (public.can_upload_fuel());
revoke all on public.fuel_contract_corrections from anon, authenticated;
grant select on public.fuel_contract_corrections to authenticated;

create or replace function public.fuel_contract_cleanup_candidates(
  p_start date, p_end date, p_all boolean default false
)
returns table(contract_label text, person_name text, line_items bigint,
  transactions bigint, first_date date, last_date date, total_cost numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_upload_fuel() then
    raise exception 'Approved fuel editor account required' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 3660 then
    raise exception 'Invalid review date range' using errcode = '22023';
  end if;
  return query
  select f.contract_number, f.person_name, count(*)::bigint,
    count(distinct f.transaction_group_key)::bigint, min(f.transaction_date), max(f.transaction_date),
    coalesce(sum(f.net_cost),0)
  from public.fuel_transactions f
  where f.transaction_date between p_start and p_end
    and (p_all or f.contract_number = 'Unassigned'
      or upper(f.contract_number) !~ '^[0-9][A-Z0-9]{4,5}$')
  group by f.contract_number, f.person_name
  order by count(*) desc, f.contract_number, f.person_name
  limit 250;
end;
$$;

create or replace function public.fuel_contract_cleanup_options()
returns table(contract_number text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_upload_fuel() then
    raise exception 'Approved fuel editor account required' using errcode = '42501';
  end if;
  return query
  select known.contract_number from (
    select cs.contract_number from public.contract_supervisors cs
    union
    select ap.contract_number from public.contract_assignment_periods ap
  ) known
  where known.contract_number ~ '^[0-9][A-Za-z0-9]{4,5}$'
  order by known.contract_number;
end;
$$;

create or replace function public.correct_fuel_contract(
  p_old_label text, p_person_name text, p_start date, p_end date,
  p_new_contract text, p_expected_line_items integer
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_target text := upper(trim(p_new_contract));
  v_count integer;
  v_updated integer;
  v_total numeric;
begin
  if not public.can_upload_fuel() then
    raise exception 'Approved fuel editor account required' using errcode = '42501';
  end if;
  if p_old_label is null or length(trim(p_old_label)) = 0
    or p_new_contract is null
    or p_person_name is null or length(trim(p_person_name)) = 0
    or p_start is null or p_end is null or p_start > p_end or p_end - p_start > 3660
    or p_expected_line_items is null or p_expected_line_items < 1
    or (v_target <> 'UNASSIGNED' and v_target !~ '^[0-9][A-Z0-9]{4,5}$')
    or upper(trim(p_old_label)) = v_target then
    raise exception 'Invalid contract correction' using errcode = '22023';
  end if;
  select count(*)::integer, coalesce(sum(f.net_cost),0) into v_count, v_total
  from public.fuel_transactions f
  where f.contract_number = p_old_label and f.person_name = p_person_name
    and f.transaction_date between p_start and p_end;
  if v_count <> p_expected_line_items then
    raise exception 'Rows changed since review. Refresh and check the correction again.' using errcode = '40001';
  end if;
  update public.fuel_transactions f
  set contract_number = case when v_target = 'UNASSIGNED' then 'Unassigned' else v_target end
  where f.contract_number = p_old_label and f.person_name = p_person_name
    and f.transaction_date between p_start and p_end;
  get diagnostics v_updated = row_count;
  if v_updated <> v_count then
    raise exception 'Rows changed during correction. Refresh and try again.' using errcode = '40001';
  end if;
  insert into public.fuel_contract_corrections
    (old_label,new_contract,person_name,period_start,period_end,line_items,total_cost,corrected_by)
  values (p_old_label,case when v_target = 'UNASSIGNED' then 'Unassigned' else v_target end,
    p_person_name,p_start,p_end,v_updated,v_total,auth.uid());
  return v_updated;
end;
$$;

revoke all on function public.fuel_contract_cleanup_candidates(date,date,boolean) from public;
revoke all on function public.fuel_contract_cleanup_options() from public;
revoke all on function public.correct_fuel_contract(text,text,date,date,text,integer) from public;
grant execute on function public.fuel_contract_cleanup_candidates(date,date,boolean) to authenticated;
grant execute on function public.fuel_contract_cleanup_options() to authenticated;
grant execute on function public.correct_fuel_contract(text,text,date,date,text,integer) to authenticated;
notify pgrst, 'reload schema';
