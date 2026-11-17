-- Entry-list status only; never mutate contract_master or historical weekly counts.
create table public.unassigned_trip_contract_status (
 contract_number text primary key,
 inactive boolean not null default false,
 updated_by text not null,
 updated_at timestamptz not null default now(),
 constraint contract_status_normalized check (contract_number = upper(regexp_replace(contract_number,'^0+','')))
);
alter table public.unassigned_trip_contract_status enable row level security;
grant select, insert, update on public.unassigned_trip_contract_status to authenticated;
create policy "approved users read trip contract statuses" on public.unassigned_trip_contract_status for select to authenticated using (public.is_approved());
create policy "report managers insert trip contract statuses" on public.unassigned_trip_contract_status for insert to authenticated with check (public.is_approved(array['admin','uploader']) and updated_by = lower(auth.jwt()->>'email'));
create policy "report managers update trip contract statuses" on public.unassigned_trip_contract_status for update to authenticated using (public.is_approved(array['admin','uploader'])) with check (public.is_approved(array['admin','uploader']) and updated_by = lower(auth.jwt()->>'email'));
create or replace function public.set_unassigned_trip_contract_inactive(p_contract text,p_inactive boolean)
returns public.unassigned_trip_contract_status language plpgsql security invoker set search_path=public as $$
declare v_contract text; v_row public.unassigned_trip_contract_status;
begin
 if not public.is_approved(array['admin','uploader']) then raise exception 'Not authorized'; end if;
 v_contract:=upper(regexp_replace(trim(p_contract),'^0+',''));
 if v_contract is null or v_contract='' or p_inactive is null then raise exception 'Invalid contract or status'; end if;
 insert into public.unassigned_trip_contract_status(contract_number,inactive,updated_by)
 values(v_contract,p_inactive,lower(auth.jwt()->>'email'))
 on conflict (contract_number) do update set inactive=excluded.inactive,updated_by=excluded.updated_by,updated_at=now()
 returning * into v_row;
 return v_row;
end $$;
revoke all on function public.set_unassigned_trip_contract_inactive(text,boolean) from public,anon;
grant execute on function public.set_unassigned_trip_contract_inactive(text,boolean) to authenticated;
alter publication supabase_realtime add table public.unassigned_trip_contract_status;