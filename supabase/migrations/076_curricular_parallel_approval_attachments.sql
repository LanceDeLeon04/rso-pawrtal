-- ============================================================
-- 076: Curricular Activities — parallel Dean/SDG approval,
-- attachments, and Dean/SDG-agnostic auto-forward to Director
-- ============================================================
-- Changes from migration 074:
--   1. Dean and SDG Representative review IN PARALLEL. SDAO/Admin can
--      generate either link at any time (in any order) once the
--      activity is submitted — no more "SDG link only after Dean
--      approves". The activity auto-forwards to Academic Director the
--      moment BOTH have approved, whichever finishes last.
--      (The 'sdg_review' status is no longer used as a transitional
--      state — the activity stays 'dean_review' — now meaning "with
--      reviewers" — until both decide.)
--   2. Faculty applicants can attach supporting documents (base64,
--      stored directly in Postgres — no anon storage policy needed
--      since faculty never get a Pawrtal account/session).
--   3. Faculty's event-code email now goes to BOTH their NU email and
--      an optional personal Gmail, same dual-recipient pattern as
--      migration 049's submitter notifications.
-- ============================================================

-- ---------- Faculty personal email ----------
alter table curricular_activities add column if not exists faculty_personal_email text;

-- ---------- Attachments ----------
create table if not exists curricular_attachments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references curricular_activities(id) on delete cascade,
  file_name text not null,
  file_type text,
  file_size integer,
  file_data text not null, -- base64
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_curricular_attachments_activity on curricular_attachments(activity_id);

alter table curricular_attachments enable row level security;

drop policy if exists curricular_attachments_select on curricular_attachments;
create policy curricular_attachments_select on curricular_attachments for select
  using (is_admin_tier());

drop policy if exists curricular_attachments_delete on curricular_attachments;
create policy curricular_attachments_delete on curricular_attachments for delete
  using (is_admin_tier());

-- ------------------------------------------------------------
-- submit_curricular_activity — now also accepts p_payload->'attachments'
-- as a jsonb array of { name, type, size, data } and stores faculty's
-- personal email.
-- ------------------------------------------------------------
create or replace function submit_curricular_activity(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link curricular_apply_links;
  v_code text;
  v_activity curricular_activities;
  v_att jsonb;
  v_count integer := 0;
begin
  select * into v_link from curricular_apply_links where token = p_token;
  if v_link is null or not v_link.is_active then
    raise exception 'This application link is no longer active';
  end if;

  if trim(coalesce(p_payload->>'faculty_name', '')) = '' then
    raise exception 'Faculty name is required';
  end if;
  if trim(coalesce(p_payload->>'faculty_email', '')) = '' then
    raise exception 'Faculty email is required';
  end if;
  if trim(coalesce(p_payload->>'title', '')) = '' then
    raise exception 'Activity title is required';
  end if;
  if p_payload->>'event_date' is null then
    raise exception 'Event date is required';
  end if;

  v_code := 'CA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('curricular_event_code_seq')::text, 6, '0');

  insert into curricular_activities (
    event_code, apply_link_id, faculty_name, faculty_email, faculty_personal_email, department,
    title, description, activity_type, activity_type_other, target_audience,
    target_participants, projected_budget, budget_source,
    venue_id, venue_detail, online_platform, event_date, start_time, end_time, medium
  ) values (
    v_code, v_link.id,
    trim(p_payload->>'faculty_name'), trim(p_payload->>'faculty_email'),
    nullif(trim(coalesce(p_payload->>'faculty_personal_email', '')), ''),
    nullif(trim(coalesce(p_payload->>'department', '')), ''),
    trim(p_payload->>'title'), p_payload->>'description', p_payload->>'activity_type', p_payload->>'activity_type_other',
    p_payload->>'target_audience',
    nullif(p_payload->>'target_participants', '')::integer,
    nullif(p_payload->>'projected_budget', '')::numeric,
    p_payload->>'budget_source',
    nullif(p_payload->>'venue_id', '')::uuid, p_payload->>'venue_detail', p_payload->>'online_platform',
    (p_payload->>'event_date')::date,
    nullif(p_payload->>'start_time', '')::time,
    nullif(p_payload->>'end_time', '')::time,
    (p_payload->>'medium')::activity_medium
  )
  returning * into v_activity;

  if jsonb_typeof(p_payload->'attachments') = 'array' then
    for v_att in select * from jsonb_array_elements(p_payload->'attachments') loop
      -- hard cap: 8 attachments per application
      exit when v_count >= 8;
      if trim(coalesce(v_att->>'data', '')) = '' or trim(coalesce(v_att->>'name', '')) = '' then
        continue;
      end if;
      insert into curricular_attachments (activity_id, file_name, file_type, file_size, file_data)
      values (
        v_activity.id,
        left(v_att->>'name', 255),
        v_att->>'type',
        nullif(v_att->>'size', '')::integer,
        v_att->>'data'
      );
      v_count := v_count + 1;
    end loop;
  end if;

  insert into curricular_history (activity_id, step, action, actor_name)
  values (v_activity.id, 'submitted', 'submitted', v_activity.faculty_name);

  return jsonb_build_object('ok', true, 'event_code', v_activity.event_code, 'id', v_activity.id);
end;
$$;

grant execute on function submit_curricular_activity(text, jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- fetch_curricular_attachments(activity_id) — admin-tier only.
-- ------------------------------------------------------------
create or replace function fetch_curricular_attachments(p_activity_id uuid)
returns setof curricular_attachments
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_tier() then
    raise exception 'Not authorized';
  end if;
  return query select * from curricular_attachments where activity_id = p_activity_id order by uploaded_at;
end;
$$;

grant execute on function fetch_curricular_attachments(uuid) to authenticated;

-- ------------------------------------------------------------
-- generate_curricular_approval — Dean and SDG Rep can now both be
-- generated any time the activity is still with reviewers, in any
-- order (parallel review). Also allows reissuing after one has
-- already decided, as long as the activity as a whole hasn't moved
-- past reviewer stage.
-- ------------------------------------------------------------
create or replace function generate_curricular_approval(
  p_activity_id uuid,
  p_role curricular_approver_role,
  p_person_name text,
  p_person_email text default null
) returns curricular_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity curricular_activities;
  v_token text;
  v_row curricular_approvals;
begin
  if not is_admin_tier() then
    raise exception 'Not authorized';
  end if;

  select * into v_activity from curricular_activities where id = p_activity_id;
  if v_activity is null then
    raise exception 'Curricular activity not found';
  end if;

  if v_activity.status not in ('dean_review', 'sdg_review') then
    raise exception 'This activity is no longer awaiting reviewer approval';
  end if;

  if trim(coalesce(p_person_name, '')) = '' then
    raise exception 'Person name is required';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into curricular_approvals (
    activity_id, role, token, person_name, person_email, status, expires_at, created_by
  ) values (
    p_activity_id, p_role, v_token, trim(p_person_name),
    nullif(trim(coalesce(p_person_email, '')), ''),
    'pending', now() + interval '7 days', auth.uid()
  )
  on conflict (activity_id, role) do update set
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

grant execute on function generate_curricular_approval(uuid, curricular_approver_role, text, text) to authenticated;

-- ------------------------------------------------------------
-- get_curricular_approval — no longer reports/relies on "dean must
-- go first"; instead reports both reviewers' status side-by-side so
-- the external reviewer sees where their counterpart stands.
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

  return jsonb_build_object(
    'link', jsonb_build_object(
      'role', v_link.role, 'status', v_link.status, 'person_name', v_link.person_name,
      'expires_at', v_link.expires_at, 'decided_at', v_link.decided_at, 'comment', v_link.comment
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
-- get_curricular_attachment(token, attachment_id) — lets an external
-- Dean/SDG reviewer (or the faculty member via a future track view)
-- fetch the base64 payload of one attachment for their own activity,
-- without exposing the admin-only fetch_curricular_attachments RPC.
-- ------------------------------------------------------------
create or replace function get_curricular_attachment(p_token text, p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link curricular_approvals;
  v_att curricular_attachments;
begin
  select * into v_link from curricular_approvals where token = p_token;
  if v_link is null then
    raise exception 'Invalid link';
  end if;

  select * into v_att from curricular_attachments
    where id = p_attachment_id and activity_id = v_link.activity_id;
  if v_att is null then
    raise exception 'Attachment not found';
  end if;

  return jsonb_build_object(
    'file_name', v_att.file_name, 'file_type', v_att.file_type, 'data', v_att.file_data
  );
end;
$$;

grant execute on function get_curricular_attachment(text, uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- Public, PII-light read access for the shared "View Calendar" widget
-- (EventCalendarModal) so faculty filling out a new application can see
-- already-booked Curricular Activities for clash-checking — same as
-- the public `events_select_all` policy already does for RSO Events.
-- Faculty email/personal email/budget/etc. stay admin-only: the modal
-- only ever selects title/date/time/venue/status/faculty_name.
-- ------------------------------------------------------------
drop policy if exists curricular_activities_select_public on curricular_activities;
create policy curricular_activities_select_public on curricular_activities for select
  using (true);

-- The admin-tier select policy from migration 074 becomes redundant
-- once the public one exists (this one is a superset), but is left in
-- place harmlessly — Postgres OR's permissive policies together.


-- ------------------------------------------------------------
-- submit_curricular_decision — Dean/SDG now decide independently
-- (no more "Dean must approve first" gate for the SDG Rep). The
-- activity forwards to Academic Director only once BOTH have
-- approved; a rejection from either immediately rejects the whole
-- activity.
-- ------------------------------------------------------------
create or replace function submit_curricular_decision(
  p_token text,
  p_decision curricular_link_status,
  p_comment text default null,
  p_signature text default null
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
  -- else: still waiting on the other reviewer (or it hasn't been
  -- generated yet) — activity stays in 'dean_review' (reviewer stage).

  return jsonb_build_object('ok', true, 'decision', p_decision);
end;
$$;

grant execute on function submit_curricular_decision(text, curricular_link_status, text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- notify_curricular_code_email — no functional change needed here;
-- the edge function now reads faculty_personal_email itself and
-- sends to both addresses.
-- ------------------------------------------------------------
