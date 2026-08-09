-- Extends get_approval_link() (from 019/025/038/041) to also return
-- `venue_names`: the names of every venue in v_submission.venue_ids (the
-- full multi-venue selection), so the External Approval page can show a
-- bullet list instead of only the single primary venue. `venue` (single
-- name) is left in place for older reviewers' cached UI, but the new
-- `venue_names` array is the one the frontend now renders.
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
      'venue_names', (
        select coalesce(jsonb_agg(name order by name), '[]'::jsonb)
        from venues where id = any(coalesce(v_submission.venue_ids, array[]::uuid[]))
      ),
      'venue_detail', v_submission.venue_detail,
      'venue_details', v_submission.venue_details,
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
