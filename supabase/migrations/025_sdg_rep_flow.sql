-- ============================================================
-- 025: SDG Representative sign-off flow
-- ============================================================
-- Students no longer check/mark SDGs on the Event Application form.
-- The `sdgs` column on `submissions` is now written exactly once,
-- externally, by the SDG Representative via their own magic link
-- (role = 'sdg_rep'), which sits right after Adviser/Dean and before
-- the SDAO Assistant. At least one SDG must be marked before the SDG
-- Rep can approve — see submit_approval_decision below.
--
-- ACP Form regeneration timeline:
--   1. On submit               -> ACP generated with sdgs = '{}' (blank boxes)
--   2. SDG Rep approves        -> submissions.sdgs updated, app regenerates
--                                  the ACP with the marked boxes (client-side,
--                                  see SubmissionBin.jsx)
--   3. Director approves       -> final ACP regenerated with the AQ
--                                  Validation / QR verification block
--
-- `sdg_marked_acp_generated` lets the client know whether step 2's
-- regeneration has already happened for this submission, so it only
-- fires once even if the reviewer re-opens the record.

alter table submissions add column if not exists sdg_marked_at timestamptz;
alter table submissions add column if not exists sdg_marked_acp_generated boolean not null default false;

-- What the SDG Representative actually checked, kept on their own
-- link row too (so re-issuing/auditing doesn't depend on submissions
-- having already been updated).
alter table approval_links add column if not exists sdg_selections text[];

-- ------------------------------------------------------------
-- generate_approval_link: no functional change needed for sdg_rep
-- (it already only special-cases 'dean'), but re-declared here so
-- the migration file is self-contained and easy to diff against 019.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- get_approval_link(token): also report whether the Adviser/Dean
-- chain ahead of an 'sdg_rep' link is fully cleared, the same way it
-- already reports adviser_status for a 'dean' link, plus the current
-- sdgs on the submission (so a re-opened/re-issued sdg_rep link shows
-- what was previously marked).
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

  v_needs_dean := coalesce(v_org.category, '') in ('School Council', 'Academic');

  if v_link.role = 'dean' or v_link.role = 'sdg_rep' then
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
    v_prior_complete := coalesce(v_adviser.status = 'approved', false)
      and (not v_needs_dean or coalesce(v_dean.status = 'approved', false));
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
-- submit_approval_decision: adds p_sdgs so the SDG Representative
-- can submit which SDGs they've marked as approving. Deans are still
-- blocked until Adviser approves; SDG Reps are now blocked until the
-- whole Adviser/Dean chain ahead of them is approved. On an sdg_rep
-- approval, `submissions.sdgs` is (re)written from what they marked,
-- `sdg_marked_at` is stamped, and `sdg_marked_acp_generated` is reset
-- to false so the app regenerates the ACP with the marks on next view.
-- ------------------------------------------------------------
-- Drop the 019 signature first — PostgREST resolves RPC calls by
-- matching named JSON args against a function's parameter names, and
-- having both a 4-arg and 5-arg overload with the same leading names
-- makes that resolution ambiguous.
drop function if exists submit_approval_decision(text, approval_link_status, text, text);

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
  v_needs_dean := coalesce(v_org.category, '') in ('School Council', 'Academic');

  if v_link.role = 'dean' then
    select * into v_adviser from approval_links
      where submission_id = v_link.submission_id and role = 'adviser';
    if v_adviser is null or v_adviser.status <> 'approved' then
      raise exception 'The Adviser has not approved this application yet';
    end if;
  end if;

  if v_link.role = 'sdg_rep' then
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
        stage = 'assistant_review',
        updated_at = now()
      where id = v_link.submission_id;
    else
      v_needs_dean := coalesce(v_org.category, '') in ('School Council', 'Academic');
      -- Adviser (and Dean, if required) approving now hands off to the
      -- SDG Representative rather than straight to assistant_review —
      -- the submission's stage stays as-is (still pre-assistant_review)
      -- until the sdg_rep link above resolves it.
      if v_link.role = 'dean' or (v_link.role = 'adviser' and not v_needs_dean) then
        -- no stage change here; the SDAO side generates the SDG Rep
        -- link next and that link's approval is what advances the
        -- submission to 'assistant_review'.
        null;
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision);
end;
$$;

grant execute on function submit_approval_decision(text, approval_link_status, text, text, text[]) to anon, authenticated;
