-- ============================================================
-- 038: Org Merchandise Proposal flow
-- ============================================================
-- - app_settings: a tiny key/value table for portal-wide feature
--   toggles. First (only) key so far: allow_merchandise_submission —
--   editable by SDAO (assistant/supervisor) and System Admin only,
--   readable by everyone so Submission Bin can show/hide the "New
--   Merchandise Proposal" button for RSO officers.
-- - submissions gets merchandise-specific columns, parallel to the
--   sdgs/sdg_representative pair used for event applications:
--     merchandise_types      -- checklist the student fills in
--     marketing_representative -- filled by the external Marketing
--                                  reviewer on approval, same pattern
--                                  as sdg_representative
-- - get_approval_link / submit_approval_decision are re-declared to
--   treat 'marketing_rep' exactly like 'sdg_rep' for chain-gating
--   (blocked until Adviser/Dean ahead of it have approved, advances
--   the submission to 'assistant_review' on approval) but without
--   the "at least one SDG marked" requirement — Marketing simply
--   views attachments, comments, and returns/accepts.

create table if not exists app_settings (
  key text primary key,
  value boolean not null default false,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

insert into app_settings (key, value)
values ('allow_merchandise_submission', false)
on conflict (key) do nothing;

alter table app_settings enable row level security;

create or replace function is_sdao_or_admin() returns boolean as $$
  select current_role_name() in ('sdao_assistant', 'sdao_supervisor', 'system_admin');
$$ language sql stable security definer;

drop policy if exists app_settings_select on app_settings;
create policy app_settings_select on app_settings for select using (true);

drop policy if exists app_settings_write on app_settings;
create policy app_settings_write on app_settings for all
  using (is_sdao_or_admin())
  with check (is_sdao_or_admin());

alter table submissions add column if not exists merchandise_types text[] not null default '{}';
alter table submissions add column if not exists marketing_representative text;
alter table submissions add column if not exists marketing_reviewed_at timestamptz;

-- ------------------------------------------------------------
-- get_approval_link(token): same as 025, plus marketing_rep treated
-- like sdg_rep for the prior-chain-complete gate.
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

  if v_link.role in ('dean', 'sdg_rep', 'marketing_rep') then
    select * into v_adviser from approval_links
      where submission_id = v_link.submission_id and role = 'adviser';
  end if;
  if v_link.role in ('sdg_rep', 'marketing_rep') and v_needs_dean then
    select * into v_dean from approval_links
      where submission_id = v_link.submission_id and role = 'dean';
  end if;

  if v_link.role = 'dean' then
    v_prior_complete := v_adviser.status = 'approved';
  elsif v_link.role in ('sdg_rep', 'marketing_rep') then
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
      'sdgs', v_submission.sdgs,
      'type', v_submission.type,
      'merchandise_types', v_submission.merchandise_types
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
    'prior_chain_complete', case when v_link.role in ('dean', 'sdg_rep', 'marketing_rep')
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
-- submit_approval_decision: marketing_rep gates the same way
-- sdg_rep does, but never requires p_sdgs and instead stamps
-- submissions.marketing_representative / marketing_reviewed_at.
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

  if v_link.role in ('sdg_rep', 'marketing_rep') then
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
      when 'sdg_rep' then 'SDG Representative'
      when 'marketing_rep' then 'Marketing'
      else initcap(v_link.role::text) end || ')',
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
    elsif v_link.role = 'marketing_rep' then
      update submissions set
        marketing_representative = v_link.person_name,
        marketing_reviewed_at = now(),
        stage = 'assistant_review',
        updated_at = now()
      where id = v_link.submission_id;
    else
      -- Adviser (and Dean, if required) approving now hands off to the
      -- next external reviewer (SDG Rep / Marketing) rather than
      -- straight to assistant_review — the submission's stage stays
      -- as-is until that link resolves it. Types without a trailing
      -- external reviewer step (none currently) would fall through
      -- unchanged here too, which is harmless.
      null;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision);
end;
$$;

grant execute on function submit_approval_decision(text, approval_link_status, text, text, text[]) to anon, authenticated;
