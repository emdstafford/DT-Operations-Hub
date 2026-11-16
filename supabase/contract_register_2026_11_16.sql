-- Emily's contract register, supplied 2026-11-16. Run as postgres in Supabase SQL Editor.
-- Metadata only: preserves every payroll, fuel, load, rate, and assignment-history row.
-- Does not infer supervisor-effective dates from contract-term dates.
begin;
-- Keep superseded contract terms and supervisor metadata in a private audit log.
create schema if not exists dt_contract_internal;
revoke all on schema dt_contract_internal from public, anon, authenticated;
create table if not exists dt_contract_internal.register_revisions (
  id bigint generated always as identity primary key,
  recorded_at timestamptz not null default now(),
  reason text not null,
  previous_record jsonb not null
);
alter table dt_contract_internal.register_revisions enable row level security;
revoke all on dt_contract_internal.register_revisions from public, anon, authenticated;
create temporary table supplied_contracts (
  contract_number text primary key, supervisor text not null, region text not null,
  start_date date not null, end_date date not null,
  check (end_date >= start_date)
) on commit drop;
insert into supplied_contracts values
  ('2407U', 'Jeff McCarter/Ronnie Wooldridge', 'Roanoke, VA', '2026-01-10', '2027-12-31'),
  ('2544G', 'Joe Dyer', 'West Virginia', '2026-01-31', '2028-03-31'),
  ('280L3', 'Joe Dyer/Vernon Patterson', 'Charlotte, NC', '2025-07-01', '2028-06-30'),
  ('2903Y', 'Eric Grant', 'Columbia, SC', '2026-08-08', '2028-08-06'),
  ('2909P', 'Eric Grant', 'Columbia, SC', '2026-08-08', '2028-08-06'),
  ('2909T', 'Eric Grant', 'Columbia, SC', '2026-08-08', '2028-08-06'),
  ('296B8', 'Eric Grant/Tonya Owens', 'Greenville, SC', '2026-07-01', '2028-05-31'),
  ('296C2', 'Kevin Shields/Bruce Stevens', 'Asheville, NC', '2026-07-01', '2028-05-31'),
  ('296C7', 'Eric Grant', 'Greenville, SC', '2026-07-01', '2028-05-31'),
  ('3074X', 'Joe Dyer/Jerry Bradwell', 'Chattanooga, TN', '2025-10-01', '2028-01-31'),
  ('307L0', 'Joe Dyer/Jerry Bradwell', 'Chattanooga, TN', '2026-07-01', '2028-03-31'),
  ('307L2', 'Joe Dyer/Jerry Bradwell', 'Chattanooga, TN', '2025-07-01', '2027-06-30'),
  ('3173X', 'Jeff McCarter', 'Albany, GA', '2025-07-01', '2027-06-30'),
  ('31730', 'Jeff McCarter', 'Albany, GA', '2026-07-01', '2028-06-30'),
  ('31744', 'Jeff McCarter', 'Albany, GA', '2026-07-01', '2028-06-30'),
  ('3179V', 'Jeff McCarter', 'Tallahassee, FL', '2026-01-31', '2028-03-31'),
  ('3253V', 'Joe Dyer/Jose Delrio', 'Pensacola, FL', '2026-01-10', '2027-12-31'),
  ('35034', 'Austin Carl', 'Birmingham, AL', '2025-07-01', '2028-06-30'),
  ('3504W', 'Austin Carl', 'Birmingham, AL', '2025-07-01', '2027-06-04'),
  ('350M3', 'Austin Carl', 'Birmingham, AL', '2026-07-01', '2028-06-30'),
  ('3507P', 'Austin Carl', 'Birmingham, AL', '2025-10-22', '2027-09-30'),
  ('354L1', 'Austin Carl', 'Tuscaloosa, AL', '2025-07-01', '2028-03-31'),
  ('355A4', 'Austin Carl', 'Jasper, AL', '2025-07-01', '2028-06-30'),
  ('356AG', 'Austin Carl/Jerry Loudermilk', 'Huntsville, AL', '2025-07-01', '2028-03-31'),
  ('356L2', 'Austin Carl/Jerry Loudermilk', 'Huntsville, AL', '2025-07-01', '2028-03-31'),
  ('356L3', 'Austin Carl/Jerry Loudermilk', 'Huntsville, AL', '2026-07-01', '2027-06-30'),
  ('357A8', 'Austin Carl/Jerry Loudermilk', 'Huntsville, AL', '2026-07-01', '2027-06-30'),
  ('3606M', 'Tony Smith/Gerald Austin', 'Montgomery, AL', '2026-04-01', '2028-03-31'),
  ('3636R', 'Tony Smith/Austin Doswell', 'Dothan, AL', '2026-07-01', '2028-06-30'),
  ('364A8', 'Tony Smith', 'Andalusia, AL', '2025-07-01', '2028-03-31'),
  ('36463', 'Tony Smith', 'Andalusia, AL', '2025-07-01', '2028-03-31'),
  ('3686R', 'Tony Smith', 'Opelika, AL', '2026-07-01', '2028-06-30'),
  ('3709C', 'Jason Proctor', 'Nashville, TN', '2025-07-01', '2027-05-07'),
  ('3736F', 'Joe Dyer/Jerry Bradwell', 'Chattanooga, TN', '2025-08-08', '2027-09-03'),
  ('3733G', 'Joe Dyer/Jerry Bradwell', 'Chattanooga, TN', '2025-10-01', '2027-09-30'),
  ('37333', 'Joe Dyer/Jerry Bradwell', 'Tellico Plains, TN', '2025-04-01', '2027-03-31'),
  ('373L6', 'Joe Dyer/Jerry Bradwell', 'Chattanooga, TN', '2026-10-01', '2028-03-31'),
  ('373M1', 'Joe Dyer/Jerry Bradwell', 'Chattanooga, TN', '2026-04-01', '2028-03-31'),
  ('373M2', 'Joe Dyer/Jerry Bradwell', 'Chattanooga, TN', '2026-04-01', '2028-03-31'),
  ('3766H', 'Kenny Jenkins', 'Johnson City, TN', '2025-07-01', '2027-08-06'),
  ('3763R', 'Kenny Jenkins', 'Johnson City, TN', '2025-07-01', '2027-04-23'),
  ('3773V', 'Jason Birchfield', 'Knoxville, TN', '2026-08-26', '2026-11-13'),
  ('3774C', 'Jason Birchfield', 'Knoxville, TN', '2026-10-17', '2028-10-16'),
  ('3774Q', 'Jason Birchfield', 'Knoxville, TN', '2026-10-17', '2028-10-16'),
  ('3774T', 'Jason Birchfield/Jason Proctor', 'Knoxville, TN', '2026-10-01', '2028-10-01'),
  ('3774W', 'Jason Birchfield', 'Knoxville, TN', '2026-11-23', '2026-12-26'),
  ('3776K', 'Jason Birchfield', 'Knoxville, TN', '2026-10-17', '2028-10-16'),
  ('3777A', 'Jason Birchfield', 'Knoxville, TN', '2026-10-17', '2028-10-16'),
  ('3807U', 'Jeff McCarter', 'Memphis, TN', '2025-04-01', '2027-03-31'),
  ('380P2', 'Jeff McCarter', 'Memphis, TN', '2026-04-01', '2028-03-31'),
  ('3824J', 'Stacy Vise', 'McKenzie, TN', '2026-07-23', '2028-07-31'),
  ('3837X', 'Stacy Vise', 'Jackson, TN', '2025-10-22', '2027-10-21'),
  ('383A4', 'Stacy Vise', 'Selmer, TN', '2026-04-01', '2028-03-31'),
  ('3886M', 'Jeff McCarter', 'Tupelo, MS', '2026-04-01', '2028-04-30'),
  ('3889P', 'Jeff McCarter', 'Memphis, TN', '2025-01-18', '2028-09-30'),
  ('3948A', 'Jeff McCarter', 'Hattiesburg, MS', '2025-02-01', '2027-06-30'),
  ('3949C', 'Jeff McCarter', 'Hattiesburg, MS', '2025-11-01', '2027-06-30'),
  ('6103A', 'Joe Dyer', 'Rockford, IL', '2026-01-31', '2028-01-28'),
  ('6506C', 'Jeff McCarter', 'Linn, MO', '2025-07-01', '2028-06-30'),
  ('2704V', 'Joe Dyer', 'Charlotte, NC', '2024-05-08', '2026-05-08'),
  ('28038', 'Joe Dyer/Vernon Patterson', 'Charlotte, NC', '2025-08-23', '2026-06-30'),
  ('307A4', 'Joe Dyer/Jerry Bradwell', 'Chattanooga, TN', '2024-05-04', '2026-05-03'),
  ('3103T', 'Amber Smith', 'Macon, GA', '2026-01-19', '2026-04-18'),
  ('3773F', 'Jason Birchfield', 'Knoxville, TN', '2026-05-09', '2026-05-29'),
  ('3773G', 'Jason Birchfield', 'Knoxville, TN', '2025-07-01', '2026-11-13'),
  ('378A5', 'Jason Birchfield', 'Knoxville, TN', '2026-07-01', '2026-11-13'),
  ('378L7', 'Jason Birchfield', 'Knoxville, TN', '2026-07-01', '2026-11-13'),
  ('378M8', 'Jason Birchfield', 'Knoxville, TN', '2026-04-01', '2026-11-13');

insert into dt_contract_internal.register_revisions(reason, previous_record)
select 'Before Emily contract register 2026-11-16', to_jsonb(c)
from public.contract_supervisors c
join supplied_contracts s using (contract_number);

insert into public.contract_supervisors
  (contract_number, supervisor, region, start_date, end_date, active, source)
select contract_number, supervisor, region, start_date, end_date,
  (now() at time zone 'America/New_York')::date between start_date and end_date, 'Emily contract register 2026-11-16'
from supplied_contracts
on conflict (contract_number) do update set
  supervisor = excluded.supervisor, region = excluded.region,
  start_date = excluded.start_date, end_date = excluded.end_date,
  active = excluded.active, source = excluded.source;

-- Verify all supplied metadata before committing. The active flag is a snapshot;
-- date-aware screens must evaluate start_date/end_date as the reporting date changes.
select c.contract_number, c.supervisor, c.region, c.start_date, c.end_date,
  case when current_date < c.start_date then 'Upcoming'
       when current_date > c.end_date then 'Ended' else 'Active' end as status
from public.contract_supervisors c
join supplied_contracts s using (contract_number)
order by c.contract_number;
commit;
