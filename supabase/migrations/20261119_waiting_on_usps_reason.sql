alter table public.missed_load_reviews
drop constraint if exists missed_load_reviews_reason_check;
alter table public.missed_load_reviews
add constraint missed_load_reviews_reason_check check (
 reason in (
  'Driver late','Mechanical breakdown','USPS delay','Waiting on USPS',
  'Traffic or weather','Missed stop / route issue','Other',
  'Driver Name Change','Incorrect Times','Incorrect Frequency',
  'Incorrect NASS Code','Incorrect Contract/Trip Assignment'
 )
);