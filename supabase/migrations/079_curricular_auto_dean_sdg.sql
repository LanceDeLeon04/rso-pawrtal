-- ============================================================
-- 079: Curricular Activities — auto-detect Dean by Department,
-- faculty picks the SDG Representative, and both approval links are
-- auto-generated at submission time (no admin step needed — same
-- account-less token/link mechanism the Dean/SDG Rep already use).
-- ============================================================

-- System-generated approval links (created at anon submission time,
-- not by a logged-in admin) have no admin actor to attribute to.
alter table curricular_approvals alter column created_by drop not null;

-- Faculty picks their SDG Representative from the fixed roster
-- (external_approvers, role='sdg_rep') instead of SDAO typing it in
-- after the fact.
alter table curricular_activities add column if not exists sdg_rep_id uuid references external_approvers(id);

-- ------------------------------------------------------------
-- Public, read-only lookups for the apply form (anon — faculty have
-- no PAWrtal account/session). Only ever return name/school, never
-- PINs or any other admin-only column.
-- ------------------------------------------------------------
create or replace function get_dean_for_department(p_department text)
returns table (id uuid, person_name text)
language sql
security definer
set search_path = public
stable
as $$
  select id, person_name from external_approvers
  where role = 'dean' and school = p_department and is_active
  limit 1;
$$;

grant execute on function get_dean_for_department(text) to anon, authenticated;

create or replace function list_sdg_representatives()
returns table (id uuid, person_name text)
language sql
security definer
set search_path = public
stable
as $$
  select id, person_name from external_approvers
  where role = 'sdg_rep' and is_active
  order by person_name;
$$;

grant execute on function list_sdg_representatives() to anon, authenticated;

-- ------------------------------------------------------------
-- submit_curricular_activity — now also stores sdg_rep_id and, right
-- after inserting the activity, auto-generates BOTH the Dean and SDG
-- Representative approval links (same token/expiry shape
-- generate_curricular_approval already produces), using the
-- auto-detected Dean for the submitted department and the faculty's
-- chosen SDG Representative. Either lookup coming up empty just
-- leaves that link ungenerated — SDAO can still fill it in by hand
-- from the Curricular Activities admin page, same fallback as before.
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
  v_dean external_approvers;
  v_sdg external_approvers;
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
    venue_id, venue_detail, online_platform, event_date, start_time, end_time, medium,
    sdg_rep_id
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
    (p_payload->>'medium')::activity_medium,
    nullif(p_payload->>'sdg_rep_id', '')::uuid
  )
  returning * into v_activity;

  if jsonb_typeof(p_payload->'attachments') = 'array' then
    for v_att in select * from jsonb_array_elements(p_payload->'attachments') loop
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

  -- Auto-detect the Dean from the submitted Department and, if found,
  -- immediately issue their approval link — no SDAO step needed.
  if v_activity.department is not null then
    select * into v_dean from external_approvers
      where role = 'dean' and school = v_activity.department and is_active
      limit 1;
    if v_dean is not null then
      insert into curricular_approvals (activity_id, role, token, person_name, status, expires_at, created_by)
      values (
        v_activity.id, 'dean',
        replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
        v_dean.person_name, 'pending', now() + interval '7 days', null
      )
      on conflict (activity_id, role) do nothing;
    end if;
  end if;

  -- Faculty's chosen SDG Representative gets their link the same way.
  if v_activity.sdg_rep_id is not null then
    select * into v_sdg from external_approvers
      where id = v_activity.sdg_rep_id and role = 'sdg_rep' and is_active;
    if v_sdg is not null then
      insert into curricular_approvals (activity_id, role, token, person_name, status, expires_at, created_by)
      values (
        v_activity.id, 'sdg_rep',
        replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
        v_sdg.person_name, 'pending', now() + interval '7 days', null
      )
      on conflict (activity_id, role) do nothing;
    end if;
  end if;

  insert into curricular_history (activity_id, step, action, actor_name)
  values (v_activity.id, 'submitted', 'submitted', v_activity.faculty_name);

  return jsonb_build_object('ok', true, 'event_code', v_activity.event_code, 'id', v_activity.id);
end;
$$;

grant execute on function submit_curricular_activity(text, jsonb) to anon, authenticated;
