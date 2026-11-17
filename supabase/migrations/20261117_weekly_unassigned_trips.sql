-- Weekly unassigned trip counts, independent of USPS completion metrics.
create table if not exists public.weekly_unassigned_trips (
  week_start date not null,
  week_end date not null,
  contract_number text not null,
  trip_count integer not null check (trip_count >= 0),
  extra_trip_count integer not null default 0 check (extra_trip_count >= 0),
  revision integer not null default 1 check (revision >= 1),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (week_start, contract_number),
  constraint weekly_unassigned_week check (week_end = week_start + 6),
  constraint weekly_unassigned_contract_normalized check (contract_number = upper(regexp_replace(contract_number,'^0+','')))
);
alter table public.weekly_unassigned_trips enable row level security;
grant select, insert, update on public.weekly_unassigned_trips to authenticated;
create policy "approved employees read weekly unassigned" on public.weekly_unassigned_trips for select to authenticated using (public.is_approved());
create policy "approved report editors insert weekly unassigned" on public.weekly_unassigned_trips for insert to authenticated with check (public.is_approved(array['admin','uploader']) and updated_by = lower(auth.jwt()->>'email'));
create policy "approved report editors update weekly unassigned" on public.weekly_unassigned_trips for update to authenticated using (public.is_approved(array['admin','uploader'])) with check (public.is_approved(array['admin','uploader']) and updated_by = lower(auth.jwt()->>'email'));

create or replace function public.save_weekly_unassigned_trip_count(
 p_week_start date, p_contract text, p_count integer, p_extra_count integer, p_expected_revision integer
) returns public.weekly_unassigned_trips
language plpgsql security invoker set search_path = public
as $$
declare v_contract text; v_row public.weekly_unassigned_trips;
begin
 if not public.is_approved(array['admin','uploader']) then raise exception 'Not authorized to edit weekly trip counts'; end if;
 if p_week_start is null or extract(dow from p_week_start) <> 6 then raise exception 'Reporting week must begin on Saturday'; end if;
 if p_count is null or p_count < 0 or p_extra_count is null or p_extra_count < 0 or p_expected_revision is null or p_expected_revision < 0 then raise exception 'Invalid trip count or revision'; end if;
 v_contract := upper(regexp_replace(trim(p_contract),'^0+',''));
 if v_contract = '' or v_contract is null then raise exception 'Contract is required'; end if;
 if p_expected_revision = 0 then
   insert into public.weekly_unassigned_trips(week_start,week_end,contract_number,trip_count,extra_trip_count,revision,updated_by)
   values(p_week_start,p_week_start+6,v_contract,p_count,p_extra_count,1,lower(auth.jwt()->>'email'))
   on conflict do nothing returning * into v_row;
 else
   update public.weekly_unassigned_trips
   set trip_count=p_count, extra_trip_count=p_extra_count, revision=revision+1,updated_by=lower(auth.jwt()->>'email'),updated_at=now()
   where week_start=p_week_start and contract_number=v_contract and revision=p_expected_revision
   returning * into v_row;
 end if;
 if v_row.week_start is null then raise exception 'This count was changed by another user. Refresh this week and review the latest number before saving.'; end if;
 return v_row;
end $$;
revoke all on function public.save_weekly_unassigned_trip_count(date,text,integer,integer,integer) from public, anon;
grant execute on function public.save_weekly_unassigned_trip_count(date,text,integer,integer,integer) to authenticated;
alter publication supabase_realtime add table public.weekly_unassigned_trips;
