-- ============================================================
-- 074: Curricular Activities (Faculty intake, no Pawrtal account)
-- ============================================================
-- Faculty members submitting a Curricular Activity never get a Pawrtal
-- account. Instead SDAO (or Admin) generates a shareable application
-- link from the new "Curricular Activities" admin page. Faculty opens
-- that link, fills out the application (same shape as the RSO Event
-- Application, minus anything org-specific), and submits. On submit
-- the system:
--   1. mints a short human-readable event code (CA-2026-000123)
--   2. emails the code to the faculty member
--   3. shows the code on screen with a copy button
--
-- Approval chain (deliberately NOT the RSO submissions/approval_links
-- machinery, which is tightly coupled to organizations/org category —
-- built as its own small, self-contained state machine instead):
--   Dean -> SDG Representative (external, magic-link, no account) ->
--   Academic Director (internal, decides inside the app)
--
-- Anyone can check progress via /track using only the event code — the
-- tracking RPC returns status + chain position only, never faculty PII.
-- ============================================================

-- ---------- ENUMS ----------
create type curricular_status as enum (
  'dean_review', 'sdg_review', 'director_review', 'approved', 'returned', 'rejected'
);

create type curricular_approver_role as enum ('dean', 'sdg_rep');

create type curricular_link_status as enum ('pending', 'approved', 'rejected', 'expired');

-- ---------- APPLY LINKS (SDAO/Admin-generated, faculty-facing) ----------
create table curricular_apply_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  label text, -- optional free-text note, e.g. "College of Engineering"
  is_active boolean not null default true,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- CURRICULAR ACTIVITIES (the application itself) ----------
create sequence curricular_event_code_seq;

create table curricular_activities (
  id uuid primary key default gen_random_uuid(),
  event_code text not null unique,
  apply_link_id uuid references curricular_apply_links(id) on delete set null,

  faculty_name text not null,
  faculty_email text not null,
  department text, -- free text, e.g. "College of Engineering" — no more dept codes

  title text not null,
  description text,
  activity_type text,
  activity_type_other text,
  target_audience text,
  target_participants integer,
  projected_budget numeric(12,2),
  budget_source text,

  venue_id uuid references venues(id),
  venue_detail text,
  online_platform text,
  event_date date not null,
  start_time time,
  end_time time,
  medium activity_medium,

  status curricular_status not null default 'dean_review',
  director_comment text,
  decided_by uuid references profiles(id),
  decided_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_curricular_activities_status on curricular_activities(status);
create index idx_curricular_activities_code on curricular_activities(event_code);

-- ---------- EXTERNAL APPROVER LINKS (Dean / SDG Rep) ----------
create table curricular_approvals (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references curricular_activities(id) on delete cascade,
  role curricular_approver_role not null,
  token text not null unique,
  person_name text not null,
  person_email text,
  status curricular_link_status not null default 'pending',
  comment text,
  signature_data text,
  decided_at timestamptz,
  expires_at timestamptz not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  unique (activity_id, role)
);

create index idx_curricular_approvals_activity on curricular_approvals(activity_id);
create index idx_curricular_approvals_token on curricular_approvals(token);

-- ---------- AUDIT TRAIL (also feeds /track, so kept PII-free) ----------
create table curricular_history (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references curricular_activities(id) on delete cascade,
  step text not null, -- 'submitted' | 'dean' | 'sdg_rep' | 'director'
  action text not null, -- 'submitted' | 'approved' | 'rejected' | 'returned'
  actor_name text,
  comment text,
  created_at timestamptz not null default now()
);

create index idx_curricular_history_activity on curricular_history(activity_id);

-- ============================================================
-- RLS
-- ============================================================
alter table curricular_apply_links enable row level security;
alter table curricular_activities enable row level security;
alter table curricular_approvals enable row level security;
alter table curricular_history enable row level security;

-- Staff-facing tables: visible/manageable only to the same admin tier
-- that already works Submission Bin (is_admin_tier() from schema.sql).
-- All faculty/Dean/SDG-Rep access goes through the SECURITY DEFINER
-- RPCs below, which validate their own tokens and never touch these
-- tables under the caller's own role.
create policy curricular_apply_links_all on curricular_apply_links for all
  using (is_admin_tier()) with check (is_admin_tier());

create policy curricular_activities_select on curricular_activities for select
  using (is_admin_tier());

create policy curricular_activities_update on curricular_activities for update
  using (is_admin_tier());

create policy curricular_approvals_select on curricular_approvals for select
  using (is_admin_tier());

create policy curricular_approvals_write on curricular_approvals for all
  using (is_admin_tier()) with check (is_admin_tier());

create policy curricular_history_select on curricular_history for select
  using (is_admin_tier());

-- ============================================================
-- RPCs
-- ============================================================

-- ------------------------------------------------------------
-- generate_curricular_apply_link(label)
-- SDAO/Admin generates a reusable application link.
-- ------------------------------------------------------------
create or replace function generate_curricular_apply_link(p_label text default null)
returns curricular_apply_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row curricular_apply_links;
begin
  if not is_admin_tier() then
    raise exception 'Not authorized';
  end if;

  insert into curricular_apply_links (token, label, created_by)
  values (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    nullif(trim(coalesce(p_label, '')), ''),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function generate_curricular_apply_link(text) to authenticated;

-- ------------------------------------------------------------
-- set_curricular_apply_link_active(id, active)
-- ------------------------------------------------------------
create or replace function set_curricular_apply_link_active(p_id uuid, p_active boolean)
returns curricular_apply_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row curricular_apply_links;
begin
  if not is_admin_tier() then
    raise exception 'Not authorized';
  end if;

  update curricular_apply_links set is_active = p_active where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function set_curricular_apply_link_active(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- get_curricular_apply_link(token) — public, resolves a link before
-- rendering the application form.
-- ------------------------------------------------------------
create or replace function get_curricular_apply_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link curricular_apply_links;
begin
  select * into v_link from curricular_apply_links where token = p_token;
  if v_link is null then
    return jsonb_build_object('error', 'invalid');
  end if;
  if not v_link.is_active then
    return jsonb_build_object('error', 'inactive');
  end if;
  return jsonb_build_object('ok', true, 'label', v_link.label);
end;
$$;

grant execute on function get_curricular_apply_link(text) to anon, authenticated;

-- ------------------------------------------------------------
-- submit_curricular_activity(token, payload) — public. Inserts the
-- application and mints the event code.
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
    event_code, apply_link_id, faculty_name, faculty_email, department,
    title, description, activity_type, activity_type_other, target_audience,
    target_participants, projected_budget, budget_source,
    venue_id, venue_detail, online_platform, event_date, start_time, end_time, medium
  ) values (
    v_code, v_link.id,
    trim(p_payload->>'faculty_name'), trim(p_payload->>'faculty_email'), nullif(trim(coalesce(p_payload->>'department', '')), ''),
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

  insert into curricular_history (activity_id, step, action, actor_name)
  values (v_activity.id, 'submitted', 'submitted', v_activity.faculty_name);

  return jsonb_build_object('ok', true, 'event_code', v_activity.event_code, 'id', v_activity.id);
end;
$$;

grant execute on function submit_curricular_activity(text, jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- track_curricular_activity(event_code) — public. Status + chain
-- position only, never faculty PII.
-- ------------------------------------------------------------
create or replace function track_curricular_activity(p_event_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity curricular_activities;
begin
  select * into v_activity from curricular_activities where event_code = upper(trim(p_event_code));
  if v_activity is null then
    return jsonb_build_object('error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'event_code', v_activity.event_code,
    'title', v_activity.title,
    'status', v_activity.status,
    'submitted_at', v_activity.created_at,
    'updated_at', v_activity.updated_at,
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'step', step, 'action', action, 'created_at', created_at
      ) order by created_at), '[]'::jsonb)
      from curricular_history where activity_id = v_activity.id
    )
  );
end;
$$;

grant execute on function track_curricular_activity(text) to anon, authenticated;

-- ------------------------------------------------------------
-- generate_curricular_approval(activity_id, role, name, email)
-- SDAO/Admin issues (or reissues) the Dean / SDG Rep magic link.
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

  if p_role = 'dean' and v_activity.status not in ('dean_review') then
    raise exception 'This activity is no longer awaiting Dean review';
  end if;
  if p_role = 'sdg_rep' and v_activity.status not in ('dean_review', 'sdg_review') then
    raise exception 'This activity is not ready for SDG Representative review';
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
-- get_curricular_approval(token) — public review page.
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

  if v_link.role = 'sdg_rep' then
    select * into v_dean from curricular_approvals
      where activity_id = v_link.activity_id and role = 'dean';
  end if;

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
    'dean_status', case when v_link.role = 'sdg_rep' then coalesce(v_dean.status::text, 'not_generated') else null end
  );
end;
$$;

grant execute on function get_curricular_approval(text) to anon, authenticated;

-- ------------------------------------------------------------
-- submit_curricular_decision(token, decision, comment, signature)
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
  v_dean curricular_approvals;
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

  if v_link.role = 'sdg_rep' then
    select * into v_dean from curricular_approvals
      where activity_id = v_link.activity_id and role = 'dean';
    if v_dean is null or v_dean.status <> 'approved' then
      raise exception 'The Dean has not approved this activity yet';
    end if;
  end if;

  update curricular_approvals set
    status = p_decision, comment = p_comment, signature_data = p_signature, decided_at = now()
  where id = v_link.id;

  insert into curricular_history (activity_id, step, action, actor_name, comment)
  values (v_link.activity_id, v_link.role::text, p_decision::text, v_link.person_name, p_comment);

  if p_decision = 'rejected' then
    update curricular_activities set status = 'rejected', updated_at = now() where id = v_link.activity_id;
  elsif v_link.role = 'dean' then
    update curricular_activities set status = 'sdg_review', updated_at = now() where id = v_link.activity_id;
  elsif v_link.role = 'sdg_rep' then
    update curricular_activities set status = 'director_review', updated_at = now() where id = v_link.activity_id;
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision);
end;
$$;

grant execute on function submit_curricular_decision(text, curricular_link_status, text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- decide_curricular_activity(activity_id, decision, comment)
-- Academic Director's final internal decision.
-- ------------------------------------------------------------
create or replace function decide_curricular_activity(
  p_activity_id uuid,
  p_decision text, -- 'approved' | 'returned'
  p_comment text default null
) returns curricular_activities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity curricular_activities;
  v_actor_name text;
begin
  if not is_admin_tier() then
    raise exception 'Not authorized';
  end if;
  if p_decision not in ('approved', 'returned') then
    raise exception 'Invalid decision';
  end if;

  select * into v_activity from curricular_activities where id = p_activity_id;
  if v_activity is null then
    raise exception 'Curricular activity not found';
  end if;
  if v_activity.status <> 'director_review' then
    raise exception 'This activity is not awaiting Academic Director decision';
  end if;

  select full_name into v_actor_name from profiles where id = auth.uid();

  update curricular_activities set
    status = p_decision::curricular_status,
    director_comment = p_comment,
    decided_by = auth.uid(),
    decided_at = now(),
    updated_at = now()
  where id = p_activity_id
  returning * into v_activity;

  insert into curricular_history (activity_id, step, action, actor_name, comment)
  values (p_activity_id, 'director', p_decision, coalesce(v_actor_name, 'Academic Director'), p_comment);

  return v_activity;
end;
$$;

grant execute on function decide_curricular_activity(uuid, text, text) to authenticated;

-- ============================================================
-- EMAIL NOTIFICATIONS — same fire-and-forget pg_net pattern as
-- migrations 049/061 (reuses app_config: functions_base_url,
-- email_webhook_secret). A misconfigured/offline email pipeline must
-- never block a submission or a decision.
-- ============================================================

-- 1. Faculty gets their event code the moment they submit.
create or replace function notify_curricular_code_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_url text;
  v_secret text;
begin
  select value into v_base_url from app_config where key = 'functions_base_url';
  select value into v_secret from app_config where key = 'email_webhook_secret';
  if v_base_url is null or v_base_url = '' or v_secret is null or v_secret = '' then
    return NEW;
  end if;

  perform net.http_post(
    url := v_base_url || '/notify-curricular-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object('kind', 'code', 'activity_id', NEW.id)
  );
  return NEW;
exception when others then
  return NEW;
end;
$$;

drop trigger if exists trg_notify_curricular_code_email on curricular_activities;
create trigger trg_notify_curricular_code_email
  after insert on curricular_activities
  for each row execute function notify_curricular_code_email();

-- 2. Dean/SDG Rep gets emailed their review link whenever SDAO/Admin
--    issues or reissues one (fires on insert, and on reissue since
--    the upsert always changes `token`).
create or replace function notify_curricular_approver_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_url text;
  v_secret text;
begin
  if TG_OP = 'UPDATE' and NEW.token = OLD.token then
    return NEW;
  end if;

  select value into v_base_url from app_config where key = 'functions_base_url';
  select value into v_secret from app_config where key = 'email_webhook_secret';
  if v_base_url is null or v_base_url = '' or v_secret is null or v_secret = '' then
    return NEW;
  end if;

  perform net.http_post(
    url := v_base_url || '/notify-curricular-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object('kind', 'approver', 'approval_id', NEW.id)
  );
  return NEW;
exception when others then
  return NEW;
end;
$$;

drop trigger if exists trg_notify_curricular_approver_email on curricular_approvals;
create trigger trg_notify_curricular_approver_email
  after insert or update of token on curricular_approvals
  for each row execute function notify_curricular_approver_email();

-- 3. Academic Director gets emailed once the activity reaches
--    director_review (i.e. once the SDG Rep approves).
create or replace function notify_curricular_director_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_url text;
  v_secret text;
begin
  if NEW.status <> 'director_review' or OLD.status = 'director_review' then
    return NEW;
  end if;

  select value into v_base_url from app_config where key = 'functions_base_url';
  select value into v_secret from app_config where key = 'email_webhook_secret';
  if v_base_url is null or v_base_url = '' or v_secret is null or v_secret = '' then
    return NEW;
  end if;

  perform net.http_post(
    url := v_base_url || '/notify-curricular-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object('kind', 'director_pending', 'activity_id', NEW.id)
  );
  return NEW;
exception when others then
  return NEW;
end;
$$;

drop trigger if exists trg_notify_curricular_director_email on curricular_activities;
create trigger trg_notify_curricular_director_email
  after update of status on curricular_activities
  for each row execute function notify_curricular_director_email();
