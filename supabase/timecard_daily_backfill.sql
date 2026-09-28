-- Safely backfill aggregate daily contract hours onto an existing saved payroll.
-- Run after timecard_summary_history.sql. Safe to rerun.
create or replace function public.backfill_timecard_daily_summary(
  p_id uuid,
  p_expected_total_hundredths bigint,
  p_daily_summary jsonb
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total bigint;
  v_daily jsonb;
  v_start date;
  v_end date;
  v_archived timestamptz;
  v_sum bigint;
begin
  if auth.uid() is null or not public.is_payroll_tool_user() then
    raise exception 'Approved payroll account required' using errcode = '42501';
  end if;

  if p_id is null or p_expected_total_hundredths is null or p_expected_total_hundredths < 0
     or p_daily_summary is null or jsonb_typeof(p_daily_summary) <> 'array' then
    raise exception 'Invalid daily-hours backfill request' using errcode = '22023';
  end if;

  select total_hundredths, daily_summary, period_start, period_end, archived_at
    into v_total, v_daily, v_start, v_end, v_archived
  from public.timecard_summary_history
  where id = p_id
  for update;

  if not found then
    raise exception 'Saved payroll not found' using errcode = 'P0002';
  end if;
  if v_archived is not null then
    raise exception 'Archived payroll cannot be backfilled' using errcode = '22023';
  end if;
  if v_total <> p_expected_total_hundredths then
    return 'total_mismatch';
  end if;
  if jsonb_array_length(v_daily) > 0 then
    return 'already_complete';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_daily_summary) entry(item)
    where jsonb_typeof(entry.item) <> 'object'
       or coalesce(trim(entry.item ->> 'contract'), '') = ''
       or coalesce(entry.item ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(entry.item ->> 'hundredths', '') !~ '^\d+$'
       or (entry.item ->> 'hundredths')::bigint <= 0
       or (entry.item ->> 'date')::date < v_start
       or (entry.item ->> 'date')::date > v_end
  ) then
    raise exception 'Daily-hours detail failed validation' using errcode = '22023';
  end if;

  select coalesce(sum((entry.item ->> 'hundredths')::bigint), 0)
    into v_sum
  from jsonb_array_elements(p_daily_summary) entry(item);

  if v_sum <> p_expected_total_hundredths then
    raise exception 'Daily-hours total does not match saved payroll total' using errcode = '22023';
  end if;

  update public.timecard_summary_history
  set daily_summary = p_daily_summary
  where id = p_id
    and jsonb_array_length(daily_summary) = 0
    and total_hundredths = p_expected_total_hundredths;

  if not found then
    return 'already_complete';
  end if;

  return 'updated';
end;
$$;

revoke all on function public.backfill_timecard_daily_summary(uuid,bigint,jsonb) from public;
grant execute on function public.backfill_timecard_daily_summary(uuid,bigint,jsonb) to authenticated;
notify pgrst, 'reload schema';
