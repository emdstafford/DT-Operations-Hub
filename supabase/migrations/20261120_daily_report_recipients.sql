create table if not exists public.daily_report_recipients (
  name text primary key,
  email text not null check (email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'),
  recipient_type text not null check (recipient_type in ('supervisor','distribution','bcc')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.daily_report_recipients enable row level security;
create policy "DT admins view daily recipients" on public.daily_report_recipients
for select to authenticated using (public.is_approved(array['admin']::text[]));
create policy "DT admins add daily recipients" on public.daily_report_recipients
for insert to authenticated with check (public.is_approved(array['admin']::text[]));
create policy "DT admins update daily recipients" on public.daily_report_recipients
for update to authenticated using (public.is_approved(array['admin']::text[]))
with check (public.is_approved(array['admin']::text[]));
revoke all on public.daily_report_recipients from anon;
grant select,insert,update on public.daily_report_recipients to authenticated;
insert into public.daily_report_recipients(name,email,recipient_type) values
('Jerry Bradwell','jerrybradwell7@gmail.com','supervisor'),
('Joe Dyer','joe.faith.dyer@gmail.com','supervisor'),
('Jose Delrio','jdelrio@dtexpress.net','supervisor'),
('Kenny Jenkins','h1kerdude37618@gmail.com','supervisor'),
('Kevin Shields','keshields1@gmail.com','supervisor'),
('Vernon Patterson','vernonpatton18@gmail.com','supervisor'),
('Jeff McCarter','jmccarter5@yahoo.com','supervisor'),
('Ronnie Wooldridge','ronniewoold@yahoo.com','supervisor'),
('Amber Smith','asmith@dtexpress.net','supervisor'),
('Andrew Carr','acarr@dtexpress.net','supervisor'),
('Austin Carl','acarl@dtexpress.net','supervisor'),
('Austin Doswell','adoswell@dtexpress.net','supervisor'),
('Eric Grant','etruckn83@aol.com','supervisor'),
('Gerald Austin','gaustin@dtexpress.net','supervisor'),
('Jason Birchfield','jbirchfield@dtexpress.net','supervisor'),
('Jason Proctor','jjp4457@gmail.com','supervisor'),
('Stacy Vise','visefarm@tds.net','supervisor'),
('Tony Smith','tsmith@dtexpress.net','supervisor'),
('Bruce Stevens','0612bruce@gmail.com','supervisor'),
('Kenneth Roebuck','kroebuck@dtexpress.net','supervisor'),
('Randy Davis','rdavis@dtexpress.net','supervisor'),
('Rubin Whitehorn','rwhitehorn@dtexpress.net','supervisor'),
('Emily Stafford','estafford@dtexpress.net','distribution'),
('Chasity Cochran','ccochran@dtexpress.net','distribution'),
('Gary','davenporttransportation@yahoo.com','distribution'),
('Sabrina Lunsford','slunsford@dtexpress.net','distribution'),
('Rachelle Coffey','rcoffey@dtexpress.net','bcc'),
('Cindy Manus','cmanus@dtexpress.net','bcc')
on conflict (name) do nothing;