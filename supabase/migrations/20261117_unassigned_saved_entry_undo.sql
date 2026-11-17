-- Undo an incorrectly saved unassigned-trips week without losing an audit trail.
-- Existing weekly records are untouched until an authorized editor explicitly removes their own entries.
create table public.weekly_unassigned_trip_removals (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  week_end date not null,
  contract_number text not null,
  trip_count integer not null,
  extra_trip_count integer not null,
  revision integer not null,
  original_updated_by text not null,
  original_updated_at timestamptz not null,
  removed_by text not null,
  removed_at timestamptz not null default now()
);
alter table public.weekly_unassigned_trip_removals enable row level security;
grant select on public.weekly_unassigned_trip_removals to authenticated;
create policy "editors can see their own removed weekly counts"
 on public.weekly_unassigned_trip_removals for select to authenticated
 using (public.is_approved(array['admin','uploader']) and removed_by = lower(auth.jwt()->>'email'));

create or replace function public.remove_my_unassigned_trip_count(
 p_week_start date,p_contract text,p_expected_revision integer
) returns boolean language plpgsql security definer
set search_path = '' as $$
declare v_row public.weekly_unassigned_trips%rowtype;
declare v_email text := lower(auth.jwt()->>'email');
declare v_contract text := upper(regexp_replace(trim(p_contract),'^0+',''));
begin
 if v_email is null or not public.is_approved(array['admin','uploader'])
 then raise exception 'Not authorized to remove weekly trip entries'; end if;
 if p_week_start is null or v_contract is null or v_contract='' or p_expected_revision is null
 then raise exception 'Week, contract and saved revision are required'; end if;
 select * into v_row from public.weekly_unassigned_trips
 where week_start=p_week_start and contract_number=v_contract for update;
 if not found then raise exception 'The saved entry no longer exists. Refresh this week.'; end if;
 if v_row.updated_by <> v_email then
  raise exception 'Only the person who last saved this contract can remove it'; end if;
 if v_row.revision <> p_expected_revision then
  raise exception 'This entry changed since you opened it. Refresh before removing.'; end if;
 insert into public.weekly_unassigned_trip_removals
 (week_start,week_end,contract_number,trip_count,extra_trip_count,revision,original_updated_by,original_updated_at,removed_by)
 values (v_row.week_start,v_row.week_end,v_row.contract_number,v_row.trip_count,v_row.extra_trip_count,v_row.revision,v_row.updated_by,v_row.updated_at,v_email);
 delete from public.weekly_unassigned_trips where week_start=v_row.week_start and contract_number=v_row.contract_number;
 return true;
end $$;
revoke all on function public.remove_my_unassigned_trip_count(date,text,integer) from public,anon;
grant execute on function public.remove_my_unassigned_trip_count(date,text,integer) to authenticated;

create or replace function public.remove_my_unassigned_trip_counts_for_week(p_week_start date)
returns integer language plpgsql security definer
set search_path = '' as $$
declare v_email text := lower(auth.jwt()->>'email');
declare v_count integer;
begin
 if v_email is null or not public.is_approved(array['admin','uploader'])
 then raise exception 'Not authorized to remove weekly trip entries'; end if;
 if p_week_start is null or extract(dow from p_week_start)<>6
 then raise exception 'Reporting week must begin on Saturday'; end if;
 -- Lock all qualifying records to ensure that no other editor can modify one mid-removal.
 perform 1 from public.weekly_unassigned_trips
 where week_start=p_week_start and updated_by=v_email for update;
 insert into public.weekly_unassigned_trip_removals
 (week_start,week_end,contract_number,trip_count,extra_trip_count,revision,original_updated_by,original_updated_at,removed_by)
 select week_start,week_end,contract_number,trip_count,extra_trip_count,revision,updated_by,updated_at,v_email
 from public.weekly_unassigned_trips where week_start=p_week_start and updated_by=v_email;
 delete from public.weekly_unassigned_trips where week_start=p_week_start and updated_by=v_email;
 get diagnostics v_count = row_count;
 return v_count;
end $$;
revoke all on function public.remove_my_unassigned_trip_counts_for_week(date) from public,anon;
grant execute on function public.remove_my_unassigned_trip_counts_for_week(date) to authenticated;
