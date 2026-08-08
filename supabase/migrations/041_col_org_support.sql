-- ============================================================
-- 041: Council of Leaders (COL) org support
-- ============================================================
-- COL is a second org "type", distinguished purely by
-- organizations.category = 'COL' (category stays free-text, no enum
-- change needed). It reuses every RSO feature (events, Submission Bin,
-- clearance, calendar) as-is. Two things differ:
--
--   1. Accounts: COL orgs use their own position set (Programs Head,
--      Operations Head, President, Vice President, Secretary, Growth
--      Head) instead of the RSO position list — enforced client-side
--      only (Accounts.jsx), same as RSO's "Other (type in)..." escape
--      hatch already worked before this migration. No DB change
--      required for that part.
--
--   2. External approval chain: RSO orgs go
--        Adviser -> (Dean) -> SDG Representative -> SDAO Assistant ->
--        SDAO Supervisor -> Academic Director
--      COL orgs skip Adviser, Dean, AND the SDAO Assistant stage:
--        SDG Representative -> SDAO Supervisor -> Academic Director
--      i.e. for a COL submission the sdg_rep link is the *only*
--      external link, and approving it jumps the submission straight
--      to 'supervisor_endorsement' instead of 'assistant_review'.
--      Client-side, externalApprovalChain(category, type) in
--      src/lib/approvalLinks.js already drives the whole chain UI
--      dynamically off the returned array, so returning just
--      ['sdg_rep'] for category = 'COL' is enough there.

-- ------------------------------------------------------------
-- get_approval_link: for a COL org's sdg_rep link, there's no
-- Adviser/Dean ahead of it, so prior_chain_complete is trivially true.
-- ------------------------------------------------------------
create or replace function get_approval_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link approval_links;
  v_submission submissions;
  v_org organizations;
  v_adviser approval_links;
  v_dean approval_links;
  v_needs_dean boolean;
  v_is_col boolean;
  v_prior_complete boolean;
begin
  select * into v_link from approval_links where token = p_token;
  if v_link is null then
    return jsonb_build_object('error', 'invalid');
  end if;

  if v_link.status = 'pending' and v_link.expires_at < now() then
    update approval_links set status = 'expired' where id = v_link.id;
    v_link.status := 'expired';
  end if;

  select * into v_submission from submissions where id = v_link.submission_id;
  select * into v_org from organizations where id = v_submission.org_id;

  v_is_col := coalesce(v_org.category, '') = 'COL';
  v_needs_dean := (not v_is_col) and coalesce(v_org.category, '') in ('School Council', 'Academic');

  if v_link.role = 'dean' or (v_link.role = 'sdg_rep' and not v_is_col) then
    select * into v_adviser from approval_links
      where submission_id = v_link.submission_id and role = 'adviser';
  end if;
  if v_link.role = 'sdg_rep' and v_needs_dean then
    select * into v_dean from approval_links
      where submission_id = v_link.submission_id and role = 'dean';
  end if;

  if v_link.role = 'dean' then
    v_prior_complete := v_adviser.status = 'approved';
  elsif v_link.role = 'sdg_rep' then
    if v_is_col then
      v_prior_complete := true;
    else
      v_prior_complete := coalesce(v_adviser.status = 'approved', false)
        and (not v_needs_dean or coalesce(v_dean.status = 'approved', false));
    end if;
  else
    v_prior_complete := true;
  end if;

  return jsonb_build_object(
    'link', jsonb_build_object(
      'role', v_link.role,
      'status', v_link.status,
      'person_name', v_link.person_name,
      'expires_at', v_link.expires_at,
      'decided_at', v_link.decided_at,
      'comment', v_link.comment,
      'sdg_selections', v_link.sdg_selections
    ),
    'submission', jsonb_build_object(
      'id', v_submission.id,
      'title', v_submission.title,
      'contact_person', v_submission.contact_person,
      'contact_number', v_submission.contact_number,
      'event_date', v_submission.event_date,
      'start_time', v_submission.start_time,
      'end_time', v_submission.end_time,
      'medium', v_submission.medium,
      'venue', (select name from venues where id = v_submission.venue_id),
      'venue_detail', v_submission.venue_detail,
      'online_platform', v_submission.online_platform,
      'description', v_submission.description,
      'activity_type', v_submission.activity_type,
      'target_audience', v_submission.target_audience,
      'target_participants', v_submission.target_participants,
      'projected_budget', v_submission.projected_budget,
      'budget_source', v_submission.budget_source,
      'is_continuing', v_submission.is_continuing,
      'continuing_type', v_submission.continuing_type,
      'term_label', v_submission.term_label,
      'stage', v_submission.stage,
      'sdgs', v_submission.sdgs
    ),
    'organization', jsonb_build_object(
      'name', v_org.name, 'acronym', v_org.acronym, 'category', v_org.category
    ),
    'attachments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'document_type', document_type, 'file_url', file_url
      ) order by uploaded_at), '[]'::jsonb)
      from submission_attachments where submission_id = v_submission.id
    ),
    'adviser_status', case when v_link.role = 'dean'
      then coalesce(v_adviser.status::text, 'not_generated') else null end,
    'prior_chain_complete', case when v_link.role in ('dean', 'sdg_rep')
      then v_prior_complete else null end,
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'author', author, 'body', body, 'created_at', created_at
      ) order by created_at), '[]'::jsonb)
      from approval_link_messages where approval_link_id = v_link.id
    )
  );
end;
$$;

grant execute on function get_approval_link(text) to anon, authenticated;

-- ------------------------------------------------------------
-- submit_approval_decision: skip the Adviser/Dean gate for a COL
-- org's sdg_rep link, and on approval jump straight to
-- 'supervisor_endorsement' (skipping the SDAO Assistant stage) instead
-- of 'assistant_review'.
-- ------------------------------------------------------------
create or replace function submit_approval_decision(
  p_token text,
  p_decision approval_link_status,
  p_comment text default null,
  p_signature text default null,
  p_sdgs text[] default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link approval_links;
  v_submission submissions;
  v_org organizations;
  v_adviser approval_links;
  v_dean approval_links;
  v_needs_dean boolean;
  v_is_col boolean;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision';
  end if;

  select * into v_link from approval_links where token = p_token;
  if v_link is null then
    raise exception 'Invalid link';
  end if;
  if v_link.status <> 'pending' then
    raise exception 'This link has already been used';
  end if;
  if v_link.expires_at < now() then
    update approval_links set status = 'expired' where id = v_link.id;
    raise exception 'This link has expired';
  end if;
  if p_decision = 'approved' and trim(coalesce(p_signature, '')) = '' then
    raise exception 'A signature is required to approve';
  end if;
  if p_decision = 'approved' and v_link.role = 'sdg_rep' and coalesce(array_length(p_sdgs, 1), 0) = 0 then
    raise exception 'Please mark at least one SDG before approving';
  end if;

  select * into v_submission from submissions where id = v_link.submission_id;
  select * into v_org from organizations where id = v_submission.org_id;
  v_is_col := coalesce(v_org.category, '') = 'COL';
  v_needs_dean := (not v_is_col) and coalesce(v_org.category, '') in ('School Council', 'Academic');

  if v_link.role = 'dean' then
    select * into v_adviser from approval_links
      where submission_id = v_link.submission_id and role = 'adviser';
    if v_adviser is null or v_adviser.status <> 'approved' then
      raise exception 'The Adviser has not approved this application yet';
    end if;
  end if;

  if v_link.role = 'sdg_rep' and not v_is_col then
    select * into v_adviser from approval_links
      where submission_id = v_link.submission_id and role = 'adviser';
    if v_adviser is null or v_adviser.status <> 'approved' then
      raise exception 'The Adviser has not approved this application yet';
    end if;
    if v_needs_dean then
      select * into v_dean from approval_links
        where submission_id = v_link.submission_id and role = 'dean';
      if v_dean is null or v_dean.status <> 'approved' then
        raise exception 'The Dean has not approved this application yet';
      end if;
    end if;
  end if;
  -- COL orgs: sdg_rep is the first link in the chain, nothing to gate on.

  update approval_links set
    status = p_decision,
    comment = p_comment,
    signature_data = p_signature,
    sdg_selections = case when v_link.role = 'sdg_rep' then p_sdgs else sdg_selections end,
    decided_at = now()
  where id = v_link.id;

  insert into submission_status_history (submission_id, stage, action, actor_name, comment)
  values (
    v_link.submission_id,
    v_submission.stage,
    p_decision::text,
    v_link.person_name || ' (' || case v_link.role
      when 'sdg_rep' then 'SDG Representative' else initcap(v_link.role::text) end || ')',
    p_comment
  );

  if p_decision = 'rejected' then
    update submissions set stage = 'rejected', updated_at = now() where id = v_link.submission_id;
  else
    if v_link.role = 'sdg_rep' then
      update submissions set
        sdgs = coalesce(p_sdgs, '{}'),
        sdg_representative = v_link.person_name,
        sdg_marked_at = now(),
        sdg_marked_acp_generated = false,
        -- COL has no SDAO Assistant stage: go straight to the
        -- SDAO Supervisor. RSO orgs behave as before.
        stage = case when v_is_col then 'supervisor_endorsement' else 'assistant_review' end,
        updated_at = now()
      where id = v_link.submission_id;
    else
      -- Adviser (and Dean, if required) approving now hands off to the
      -- SDG Representative rather than straight to assistant_review —
      -- the submission's stage stays as-is (still pre-assistant_review)
      -- until the sdg_rep link above resolves it. (Not reachable for
      -- COL orgs, which never generate an adviser/dean link.)
      null;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision);
end;
$$;

grant execute on function submit_approval_decision(text, approval_link_status, text, text, text[]) to anon, authenticated;

-- ------------------------------------------------------------
-- COL event tagging: Programs Head / Operations Head can tag an
-- event_application submission with one or more of the org's
-- recurring flagship events. Reuses the free-array pattern already
-- used for `sdgs`/`learning_goals` — 'Others' entries are stored as
-- typed-in text alongside the fixed labels.
-- ------------------------------------------------------------
alter table submissions add column if not exists col_event_tags text[] not null default '{}';

comment on column submissions.col_event_tags is
  'COL-only: flagship event(s) this application is tagged under '
  '(Paskonalian, PiNUsuan, Open Day, Intramurals, University Week, '
  'OWeek, or a free-typed "Others" value). Set only by Programs Head '
  '/ Operations Head positions on a COL org, enforced by '
  'col_event_tags_guard below.';

create or replace function col_event_tags_guard() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_category text;
  v_position text;
begin
  if new.col_event_tags is distinct from coalesce(old.col_event_tags, '{}') then
    if is_admin_tier() then
      return new;
    end if;

    select category into v_org_category from organizations where id = new.org_id;
    if coalesce(v_org_category, '') <> 'COL' then
      raise exception 'Event tagging is only available for COL organizations';
    end if;

    select position into v_position from org_memberships
      where profile_id = auth.uid() and org_id = new.org_id
      limit 1;
    if v_position is null or v_position not in ('Programs Head', 'Operations Head') then
      raise exception 'Only the Programs Head or Operations Head can set event tags';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists col_event_tags_guard_trg on submissions;
create trigger col_event_tags_guard_trg
  before insert or update on submissions
  for each row execute function col_event_tags_guard();
