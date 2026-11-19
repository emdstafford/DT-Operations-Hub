-- Permit approved read-only management reviewers to change review status only.
-- All explanations, reason codes, identity, and ticket statuses remain admin/uploader-controlled.
create or replace function public.set_missed_load_review_status(p_review_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_approved(array['admin','uploader','viewer']::text[]) then
    raise exception 'An approved operations reviewer account is required.' using errcode='42501';
  end if;
  if p_status not in ('needs_review','reviewed','follow_up') then
    raise exception 'Invalid review status';
  end if;
  update public.missed_load_reviews
  set review_status = p_status
  where id = p_review_id;
  if not found then raise exception 'Review not found'; end if;
end;
$$;
revoke all on function public.set_missed_load_review_status(uuid,text) from public, anon;
grant execute on function public.set_missed_load_review_status(uuid,text) to authenticated;