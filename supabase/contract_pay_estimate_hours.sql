-- Aggregate saved payroll hours without exposing employee-level timecard summaries.
-- Run after contract_pay_rates.sql and timecard_summary_history.sql.
create or replace function public.contract_pay_estimate_hours(
  p_contract text, p_start date, p_end date
)
returns table(hours numeric, payrolls integer, first_period date, last_period date)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_contract_financial_user() then
    raise exception 'Approved contract financial account required' using errcode = '42501';
  end if;
  if p_contract is null or upper(trim(p_contract)) !~ '^[0-9A-Z]{5,6}$'
     or p_start is null or p_end is null or p_start > p_end or p_end - p_start > 3660 then
    raise exception 'Invalid contract or date range' using errcode = '22023';
  end if;
  return query
  with latest as (
    select distinct on (h.period_start, h.period_end)
      h.id, h.period_start, h.period_end, h.summary
    from public.timecard_summary_history h
    where h.archived_at is null and h.period_start >= p_start and h.period_end <= p_end
    order by h.period_start, h.period_end, h.saved_at desc, h.id desc
  ), matching as (
    select l.id, l.period_start, l.period_end, (entry.item ->> 'hundredths')::numeric as hundredths
    from latest l cross join lateral jsonb_array_elements(l.summary) as entry(item)
    where upper(trim(entry.item ->> 'contract')) = upper(trim(p_contract))
  )
  select coalesce(sum(m.hundredths), 0) / 100,
         count(distinct m.id)::integer, min(m.period_start), max(m.period_end)
  from matching m;
end;
$$;
revoke all on function public.contract_pay_estimate_hours(text,date,date) from public;
grant execute on function public.contract_pay_estimate_hours(text,date,date) to authenticated;
notify pgrst, 'reload schema';
