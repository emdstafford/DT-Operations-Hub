-- USPS contract expiration and extension tracking.
-- Run after supabase/usps_contract_financials.sql.

create table if not exists public.usps_contract_extensions (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null,
  prior_expiration_date date not null,
  new_expiration_date date not null,
  extension_effective_date date not null default current_date,
  extension_type text not null default 'extension'
    check (extension_type in ('extension','renewal','correction')),
  source_reference text,
  notes text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint usps_contract_extension_dates check (new_expiration_date >= prior_expiration_date)
);
create index if not exists usps_contract_extensions_contract_idx on public.usps_contract_extensions(contract_number, extension_effective_date desc);
alter table public.usps_contract_extensions enable row level security;
drop policy if exists "rate viewers read contract extensions" on public.usps_contract_extensions;
create policy "rate viewers read contract extensions" on public.usps_contract_extensions for select to authenticated using (public.has_app_permission('can_view_rates'));
drop policy if exists "rate editors add contract extensions" on public.usps_contract_extensions;
create policy "rate editors add contract extensions" on public.usps_contract_extensions for insert to authenticated
  with check (public.has_app_permission('can_edit_rates') and created_by = auth.uid());
drop policy if exists "rate editors update contract extensions" on public.usps_contract_extensions;
revoke all on public.usps_contract_extensions from anon;
revoke update on public.usps_contract_extensions from authenticated;
grant select, insert on public.usps_contract_extensions to authenticated;

create or replace function public.usps_contracts_expiring(p_as_of date default current_date,p_days_ahead integer default 120)
returns table (contract_number text,original_expiration_date date,current_expiration_date date,days_remaining integer,extension_count bigint,last_extension_date date,contract_status text)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.has_app_permission('can_view_rates') then raise exception 'Rate-view permission required' using errcode='42501'; end if;
 if p_days_ahead<0 or p_days_ahead>730 then raise exception 'Expiration window must be between 0 and 730 days' using errcode='22023'; end if;
 return query
 with base as (
   select v.contract_number,min(v.effective_end) filter(where v.effective_end is not null) original_expiration_date,
          max(v.effective_end) filter(where v.effective_end is not null) imported_expiration_date,
          (array_agg(v.contract_status order by v.effective_start desc,v.created_at desc))[1] contract_status
   from public.usps_contract_rate_versions v group by v.contract_number
 ), ext as (
   select e.contract_number,count(*)::bigint extension_count,max(e.extension_effective_date) last_extension_date,
          (array_agg(e.new_expiration_date order by e.extension_effective_date desc,e.created_at desc))[1] extended_through
   from public.usps_contract_extensions e group by e.contract_number
 )
 select b.contract_number,b.original_expiration_date,
        greatest(b.imported_expiration_date,coalesce(x.extended_through,b.imported_expiration_date)) current_expiration_date,
        (greatest(b.imported_expiration_date,coalesce(x.extended_through,b.imported_expiration_date))-p_as_of)::integer,
        coalesce(x.extension_count,0)::bigint,x.last_extension_date,b.contract_status
 from base b left join ext x using(contract_number)
 where greatest(b.imported_expiration_date,coalesce(x.extended_through,b.imported_expiration_date)) between p_as_of and p_as_of+p_days_ahead
 order by current_expiration_date,b.contract_number;
end;$$;
revoke all on function public.usps_contracts_expiring(date,integer) from public;
grant execute on function public.usps_contracts_expiring(date,integer) to authenticated;
notify pgrst,'reload schema';
