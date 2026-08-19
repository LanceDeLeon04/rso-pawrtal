-- ============================================================
-- 081: Unique Key (PIN) protection for Curricular Activity approvals
-- ============================================================
-- The Curricular Activities Dean/SDG Representative review page
-- (CurricularApproval.jsx) was a separate approval flow from the
-- RSO Event/Venue one (ExternalApproval.jsx) and never got the
-- Security PIN ("Unique Key") gate added in migration 072 for those
-- same two roles. Dean and SDG Representative reviewers are drawn
-- from the exact same `external_approvers` roster in both flows
-- (see get_dean_for_department / list_sdg_representatives), so this
-- reuses get_external_approver_pin() rather than adding a second PIN
-- store. Curricular activities aren't tied to an org, so org_id is
-- passed as null — get_external_approver_pin() already ignores
-- org_id for every role except 'adviser'.
--
-- Same backward-compatible shape as 072: a reviewer with no PIN
-- assigned yet reviews exactly as before.

-- ------------------------------------------------------------
-- get_curricular_approval — re-declared to add 'pin_required'.
-- ------------------------------------------------------------
create or replace function get_curricular_approval(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link curricular_approvals;
  v_activity curricular_activities;
  v_dean curricular_approvals;
  v_sdg curricular_approvals;
  v_pin text;
begin
  select * into v_link from curricular_approvals where token = p_token;
  if v_link is null then
    return jsonb_build_object('error', 'invalid');
  end if;

  if v_link.status = 'pending' and v_link.expires_at < now() then
    update curricular_approvals set status = 'expired' where id = v_link.id;
    v_link.status := 'expired';
  end if;

  select * into v_activity from curricular_activities where id = v_link.activity_id;
  select * into v_dean from curricular_approvals where activity_id = v_link.activity_id and role = 'dean';
  select * into v_sdg from curricular_approvals where activity_id = v_link.activity_id and role = 'sdg_rep';

  v_pin := get_external_approver_pin(v_link.role::approval_link_role, null, v_link.person_name);

  return jsonb_build_object(
    'link', jsonb_build_object(
      'role', v_link.role, 'status', v_link.status, 'person_name', v_link.person_name,
      'expires_at', v_link.expires_at, 'decided_at', v_link.decided_at, 'comment', v_link.comment,
      'pin_required', v_pin is not null
    ),
    'activity', jsonb_build_object(
      'event_code', v_activity.event_code, 'title', v_activity.title, 'description', v_activity.description,
      'department', v_activity.department, 'faculty_name', v_activity.faculty_name,
      'activity_type', v_activity.activity_type, 'target_audience', v_activity.target_audience,
      'target_participants', v_activity.target_participants, 'projected_budget', v_activity.projected_budget,
      'budget_source', v_activity.budget_source, 'event_date', v_activity.event_date,
      'start_time', v_activity.start_time, 'end_time', v_activity.end_time, 'medium', v_activity.medium,
      'venue', (select name from venues where id = v_activity.venue_id),
      'venue_detail', v_activity.venue_detail, 'online_platform', v_activity.online_platform,
      'status', v_activity.status
    ),
    'attachments', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'file_name', file_name, 'file_type', file_type, 'file_size', file_size) order by uploaded_at), '[]'::jsonb)
      from curricular_attachments where activity_id = v_link.activity_id
    ),
    'dean_status', coalesce(v_dean.status::text, 'not_generated'),
    'sdg_status', coalesce(v_sdg.status::text, 'not_generated')
  );
end;
$$;

grant execute on function get_curricular_approval(text) to anon, authenticated;

-- ------------------------------------------------------------
-- submit_curricular_decision — re-declared to add p_pin. Same
-- overload-drop pattern as 072 (parameter added -> new signature).
-- ------------------------------------------------------------
drop function if exists submit_curricular_decision(text, curricular_link_status, text, text);

create or replace function submit_curricular_decision(
  p_token text,
  p_decision curricular_link_status,
  p_comment text default null,
  p_signature text default null,
  p_pin text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link curricular_approvals;
  v_activity curricular_activities;
  v_other curricular_approvals;
  v_other_role curricular_approver_role;
  v_required_pin text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision';
  end if;

  select * into v_link from curricular_approvals where token = p_token;
  if v_link is null then
    raise exception 'Invalid link';
  end if;
  if v_link.status <> 'pending' then
    raise exception 'This link has already been used';
  end if;
  if v_link.expires_at < now() then
    update curricular_approvals set status = 'expired' where id = v_link.id;
    raise exception 'This link has expired';
  end if;
  if p_decision = 'approved' and trim(coalesce(p_signature, '')) = '' then
    raise exception 'A signature is required to approve';
  end if;

  v_required_pin := get_external_approver_pin(v_link.role::approval_link_role, null, v_link.person_name);
  if v_required_pin is not null and coalesce(p_pin, '') <> v_required_pin then
    raise exception 'Incorrect security PIN.';
  end if;

  select * into v_activity from curricular_activities where id = v_link.activity_id;
  if v_activity.status not in ('dean_review', 'sdg_review') then
    raise exception 'This activity is no longer awaiting reviewer decisions';
  end if;

  update curricular_approvals set
    status = p_decision, comment = p_comment, signature_data = p_signature, decided_at = now()
  where id = v_link.id;

  insert into curricular_history (activity_id, step, action, actor_name, comment)
  values (v_link.activity_id, v_link.role::text, p_decision::text, v_link.person_name, p_comment);

  if p_decision = 'rejected' then
    update curricular_activities set status = 'rejected', updated_at = now() where id = v_link.activity_id;
    return jsonb_build_object('ok', true, 'decision', p_decision);
  end if;

  -- Approved: check the other reviewer. Forward to Director only when
  -- BOTH have approved — regardless of which one just finished.
  v_other_role := case when v_link.role = 'dean' then 'sdg_rep' else 'dean' end;
  select * into v_other from curricular_approvals
    where activity_id = v_link.activity_id and role = v_other_role;

  if v_other is not null and v_other.status = 'approved' then
    update curricular_activities set status = 'director_review', updated_at = now() where id = v_link.activity_id;
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision);
end;
$$;

grant execute on function submit_curricular_decision(text, curricular_link_status, text, text, text) to anon, authenticated;
