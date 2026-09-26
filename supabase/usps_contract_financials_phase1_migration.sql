-- DT Intelligence Hub - USPS contract financials Phase 1
-- One-time migration. Requires supabase/financial_permissions.sql and existing fuel permissions.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table if not exists public.usps_rate_imports (
 id uuid primary key default gen_random_uuid(), source_file_name text not null, source_file_hash text,
 imported_by uuid not null default auth.uid(), imported_at timestamptz not null default now(),
 sheet_count integer not null default 0 check(sheet_count>=0), trip_count integer not null default 0 check(trip_count>=0),
 status text not null default 'completed' check(status in('validating','completed','failed')), notes text
);
create table if not exists public.usps_contract_rate_versions (
 id uuid primary key default gen_random_uuid(), contract_number text not null, effective_start date not null, effective_end date,
 source_import_id uuid references public.usps_rate_imports(id) on delete restrict, source_sheet_name text,
 contract_status text not null default 'active' check(contract_status in('active','terminated','expired','unknown')),
 termination_note text, created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
 constraint usps_contract_rate_version_dates check(effective_end is null or effective_end>=effective_start),
 constraint usps_contract_rate_version_unique unique(contract_number,effective_start,source_import_id)
);
create table if not exists public.usps_trip_rates (
 id uuid primary key default gen_random_uuid(), contract_rate_version_id uuid not null references public.usps_contract_rate_versions(id) on delete cascade,
 contract_number text not null, trip_number text not null, unit_cost numeric, annual_trip_cost numeric, calculated_rate_per_mile numeric,
 equipment_type text, frequency text, annual_trip_count numeric, wage_rate numeric, health_welfare_rate numeric, detention_rate numeric,
 per_trip_miles numeric, annual_miles numeric, fuel_type text, per_trip_hours numeric, source_row_number integer,
 source_payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
 constraint usps_trip_rate_unique unique(contract_rate_version_id,trip_number),
 constraint usps_trip_rate_nonnegative check(coalesce(unit_cost,0)>=0 and coalesce(annual_trip_cost,0)>=0 and coalesce(calculated_rate_per_mile,0)>=0 and coalesce(annual_trip_count,0)>=0 and coalesce(per_trip_miles,0)>=0 and coalesce(annual_miles,0)>=0 and coalesce(per_trip_hours,0)>=0)
);
create index if not exists usps_contract_rate_versions_contract_idx on public.usps_contract_rate_versions(contract_number,effective_start desc);
create index if not exists usps_trip_rates_contract_trip_idx on public.usps_trip_rates(contract_number,trip_number);

alter table public.usps_rate_imports enable row level security;
alter table public.usps_contract_rate_versions enable row level security;
alter table public.usps_trip_rates enable row level security;
drop policy if exists "rate viewers read imports" on public.usps_rate_imports;
create policy "rate viewers read imports" on public.usps_rate_imports for select to authenticated using(public.has_app_permission('can_view_rates'));
drop policy if exists "rate editors add imports" on public.usps_rate_imports;
create policy "rate editors add imports" on public.usps_rate_imports for insert to authenticated with check(public.has_app_permission('can_edit_rates') and imported_by=auth.uid());
drop policy if exists "rate editors update imports" on public.usps_rate_imports;
create policy "rate editors update imports" on public.usps_rate_imports for update to authenticated using(public.has_app_permission('can_edit_rates')) with check(public.has_app_permission('can_edit_rates') and imported_by=auth.uid());
drop policy if exists "rate viewers read contract versions" on public.usps_contract_rate_versions;
create policy "rate viewers read contract versions" on public.usps_contract_rate_versions for select to authenticated using(public.has_app_permission('can_view_rates'));
drop policy if exists "rate editors add contract versions" on public.usps_contract_rate_versions;
create policy "rate editors add contract versions" on public.usps_contract_rate_versions for insert to authenticated with check(public.has_app_permission('can_edit_rates') and created_by=auth.uid());
drop policy if exists "rate editors update contract versions" on public.usps_contract_rate_versions;
drop policy if exists "rate viewers read trip rates" on public.usps_trip_rates;
create policy "rate viewers read trip rates" on public.usps_trip_rates for select to authenticated using(public.has_app_permission('can_view_rates'));
drop policy if exists "rate editors add trip rates" on public.usps_trip_rates;
create policy "rate editors add trip rates" on public.usps_trip_rates for insert to authenticated with check(public.has_app_permission('can_edit_rates'));
drop policy if exists "rate editors update trip rates" on public.usps_trip_rates;
revoke all on public.usps_rate_imports,public.usps_contract_rate_versions,public.usps_trip_rates from anon;
grant select,insert,update on public.usps_rate_imports to authenticated;
grant select,insert on public.usps_contract_rate_versions,public.usps_trip_rates to authenticated;

create table if not exists public.usps_contract_extensions (
 id uuid primary key default gen_random_uuid(), contract_number text not null, prior_expiration_date date not null, new_expiration_date date not null,
 extension_effective_date date not null default current_date, extension_type text not null default 'extension' check(extension_type in('extension','renewal','correction')),
 source_reference text,notes text,created_by uuid not null default auth.uid(),created_at timestamptz not null default now(),
 constraint usps_contract_extension_dates check(new_expiration_date>=prior_expiration_date)
);
create index if not exists usps_contract_extensions_contract_idx on public.usps_contract_extensions(contract_number,extension_effective_date desc);
alter table public.usps_contract_extensions enable row level security;
drop policy if exists "rate viewers read contract extensions" on public.usps_contract_extensions;
create policy "rate viewers read contract extensions" on public.usps_contract_extensions for select to authenticated using(public.has_app_permission('can_view_rates'));
drop policy if exists "rate editors add contract extensions" on public.usps_contract_extensions;
create policy "rate editors add contract extensions" on public.usps_contract_extensions for insert to authenticated with check(public.has_app_permission('can_edit_rates') and created_by=auth.uid());
drop policy if exists "rate editors update contract extensions" on public.usps_contract_extensions;
revoke all on public.usps_contract_extensions from anon;
grant select,insert on public.usps_contract_extensions to authenticated;

create or replace function public.usps_contracts_expiring(p_as_of date default current_date,p_days_ahead integer default 120)
returns table(contract_number text,original_expiration_date date,current_expiration_date date,days_remaining integer,extension_count bigint,last_extension_date date,contract_status text)
language plpgsql stable security definer set search_path=public as $$ begin
 if not public.has_app_permission('can_view_rates') then raise exception 'Rate-view permission required' using errcode='42501'; end if;
 return query with base as (
 select v.contract_number,min(v.effective_end) filter(where v.effective_end is not null) original_expiration_date,max(v.effective_end) filter(where v.effective_end is not null) imported_expiration_date,
 (array_agg(v.contract_status order by v.effective_start desc,v.created_at desc))[1] contract_status from public.usps_contract_rate_versions v group by v.contract_number),
 ext as(select e.contract_number,count(*)::bigint extension_count,max(e.extension_effective_date) last_extension_date,(array_agg(e.new_expiration_date order by e.extension_effective_date desc,e.created_at desc))[1] extended_through from public.usps_contract_extensions e group by e.contract_number)
 select b.contract_number,b.original_expiration_date,greatest(b.imported_expiration_date,coalesce(x.extended_through,b.imported_expiration_date)),
 (greatest(b.imported_expiration_date,coalesce(x.extended_through,b.imported_expiration_date))-p_as_of)::integer,coalesce(x.extension_count,0)::bigint,x.last_extension_date,b.contract_status
 from base b left join ext x using(contract_number)
 where greatest(b.imported_expiration_date,coalesce(x.extended_through,b.imported_expiration_date)) between p_as_of and p_as_of+p_days_ahead
 order by 3,b.contract_number; end; $$;
revoke all on function public.usps_contracts_expiring(date,integer) from public;
grant execute on function public.usps_contracts_expiring(date,integer) to authenticated;

create or replace function public.usps_contract_monthly_financials(p_contract text,p_month date)
returns table(contract_number text,month_start date,contracted_revenue numeric,scheduled_miles numeric,active_days integer,calendar_days integer,rate_period_count bigint)
language plpgsql stable security definer set search_path=public as $$ declare ms date:=date_trunc('month',p_month)::date; me date:=(date_trunc('month',p_month)+interval '1 month - 1 day')::date; begin
 if not public.has_app_permission('can_view_rates') then raise exception 'Rate-view permission required' using errcode='42501'; end if;
 return query with lv as(
 select distinct on(v.contract_number,v.effective_start,coalesce(v.effective_end,'9999-12-31'::date)) v.id,v.contract_number,v.effective_start,v.effective_end,v.created_at
 from public.usps_contract_rate_versions v where v.contract_number=upper(trim(p_contract)) and v.effective_start<=me and coalesce(v.effective_end,me)>=ms
 order by v.contract_number,v.effective_start,coalesce(v.effective_end,'9999-12-31'::date),v.created_at desc),
 periods as(select v.id,greatest(v.effective_start,ms) cs,least(coalesce(v.effective_end,me),me) ce,coalesce(sum(t.annual_trip_cost),0)::numeric ar,coalesce(sum(t.annual_miles),0)::numeric am from lv v join public.usps_trip_rates t on t.contract_rate_version_id=v.id group by v.id,v.effective_start,v.effective_end),
 calc as(select *, (ce-cs+1)::integer cd,case when extract(year from cs)::integer%400=0 or(extract(year from cs)::integer%4=0 and extract(year from cs)::integer%100<>0) then 366 else 365 end diy from periods where ce>=cs)
 select upper(trim(p_contract)),ms,coalesce(sum(ar*cd/diy),0)::numeric,coalesce(sum(am*cd/diy),0)::numeric,coalesce(sum(cd),0)::integer,extract(day from me)::integer,count(*)::bigint from calc; end; $$;
revoke all on function public.usps_contract_monthly_financials(text,date) from public;
grant execute on function public.usps_contract_monthly_financials(text,date) to authenticated;

create or replace function public.fuel_usps_mileage_plans(p_contracts text[])
returns table(contract_number text,effective_start date,effective_end date,annual_miles numeric,source text)
language plpgsql stable security definer set search_path=public as $$ begin
 if not public.is_fuel_user() then raise exception 'Approved fuel-report account required' using errcode='42501'; end if;
 return query with vm as(select v.id,v.contract_number,v.effective_start,v.effective_end,v.created_at,coalesce(sum(t.annual_miles),0)::numeric annual_miles from public.usps_contract_rate_versions v join public.usps_trip_rates t on t.contract_rate_version_id=v.id where v.contract_number=any(p_contracts) group by v.id,v.contract_number,v.effective_start,v.effective_end,v.created_at),
 li as(select distinct on(contract_number,effective_start,effective_end) contract_number,effective_start,effective_end,annual_miles from vm where annual_miles>0 order by contract_number,effective_start,effective_end,created_at desc)
 select li.contract_number,li.effective_start,li.effective_end,li.annual_miles,'USPS contract'::text from li order by li.contract_number,li.effective_start; end; $$;
revoke all on function public.fuel_usps_mileage_plans(text[]) from public;
grant execute on function public.fuel_usps_mileage_plans(text[]) to authenticated;
notify pgrst,'reload schema';
