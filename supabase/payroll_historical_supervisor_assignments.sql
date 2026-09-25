-- Run in Supabase SQL Editor after timecard_supervisor_assignments.sql and timecard_summary_history.sql.
-- Payroll users may assign supervisors to past timecards without USPS upload access.
create or replace function public.assign_timecard_contract_supervisor(
  p_contract text, p_supervisor text, p_start date, p_end date
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  contract_key text := upper(trim(p_contract));
  supervisor_name text := trim(p_supervisor);
begin
  if not public.is_approved() or not (
    public.is_approved(array['admin','uploader'])
    or (public.is_payroll_tool_user() and p_end < current_date)
  ) then
    raise exception 'Historical supervisor assignment requires approved payroll access' using errcode = '42501';
  end if;
  if contract_key = '' or supervisor_name = '' or p_start is null or p_end is null or p_start > p_end
     or p_end - p_start > 31 or length(supervisor_name) > 100 then
    raise exception 'Check contract, supervisor, and date range';
  end if;
  if contract_key in ('01SHDR','011VAN') then
    raise exception 'This contract is approved without a supervisor';
  end if;
  -- Do not overwrite historical or shared assignments. A conflicting window requires review.
  if exists (select 1 from public.contract_assignment_periods a
     where a.contract_number = contract_key and a.supervisor <> supervisor_name
       and a.start_date <= p_end and (a.end_date is null or a.end_date >= p_start)) then
    raise exception 'A different supervisor already has an assignment overlapping these dates; review the assignment history first';
  end if;
  insert into public.contract_assignment_periods(contract_number,supervisor,start_date,end_date)
  values (contract_key,supervisor_name,p_start,p_end)
  on conflict (contract_number,supervisor,start_date) do update
    set end_date = excluded.end_date;
  update public.usps_loads l set supervisors = array[supervisor_name], updated_at = now()
  where l.contract_number = contract_key and l.operating_date between p_start and p_end
    and (l.supervisors is null or cardinality(l.supervisors) = 0);
end;
$$;
revoke all on function public.assign_timecard_contract_supervisor(text,text,date,date) from public;
grant execute on function public.assign_timecard_contract_supervisor(text,text,date,date) to authenticated;
