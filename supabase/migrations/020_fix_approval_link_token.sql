-- ============================================================
-- 020: fix generate_approval_link() token generation
-- ============================================================
-- gen_random_bytes() (pgcrypto) lives in the `extensions` schema on
-- Supabase, not `public`, so it wasn't visible under this function's
-- `search_path = public` and every call failed with
-- "function gen_random_bytes(integer) does not exist". Rebuild the
-- token from gen_random_uuid() instead — same function already used
-- everywhere else in this schema, so no search_path issue.

create or replace function generate_approval_link(
  p_submission_id uuid,
  p_role approval_link_role,
  p_person_name text,
  p_person_email text default null
) returns approval_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission submissions;
  v_org organizations;
  v_token text;
  v_row approval_links;
begin
  select * into v_submission from submissions where id = p_submission_id;
  if v_submission is null then
    raise exception 'Submission not found';
  end if;

  if not (
    is_admin_tier()
    or exists (
      select 1 from org_memberships
      where org_id = v_submission.org_id and profile_id = auth.uid()
    )
  ) then
    raise exception 'Not authorized to generate a link for this submission';
  end if;

  select * into v_org from organizations where id = v_submission.org_id;

  if p_role = 'dean' and coalesce(v_org.category, '') = 'Special Interest' then
    raise exception 'Special Interest organizations do not require a Dean link';
  end if;

  if trim(coalesce(p_person_name, '')) = '' then
    raise exception 'Person name is required';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into approval_links (
    submission_id, role, token, person_name, person_email,
    status, expires_at, created_by
  ) values (
    p_submission_id, p_role, v_token, trim(p_person_name),
    nullif(trim(coalesce(p_person_email, '')), ''),
    'pending', now() + interval '7 days', auth.uid()
  )
  on conflict (submission_id, role) do update set
    token = excluded.token,
    person_name = excluded.person_name,
    person_email = excluded.person_email,
    status = 'pending',
    comment = null,
    signature_data = null,
    decided_at = null,
    expires_at = excluded.expires_at,
    created_by = excluded.created_by,
    created_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function generate_approval_link(uuid, approval_link_role, text, text) to authenticated;
