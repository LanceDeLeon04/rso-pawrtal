-- ============================================================
-- 072: External Approver Security PINs
-- ============================================================
-- Adds an optional 4-digit PIN gate on top of the existing magic-link
-- system (migration 019+) for the four external, account-less
-- reviewer roles: Adviser, Dean, SDG Representative, Marketing.
--
-- SDAO/System Admin manage a roster of these people from Settings
-- (hidden behind a "Manage External Approver PINs" modal — never
-- shown inline) and can type or auto-generate a 4-digit PIN for each.
-- Advisers are one row per organization (there's already an
-- organizations.adviser_name); Dean and SDG Representative start
-- pre-seeded with the known, fixed roster; Marketing has no fixed
-- roster, so SDAO adds/removes entries freely.
--
-- Once a PIN is set for a person, the external reviewer must supply
-- it (in addition to holding the emailed link) before their
-- approve/reject decision is accepted — see the p_pin parameter added
-- to submit_approval_decision below. Links for people with no PIN
-- assigned yet work exactly as before (fully backward compatible).

create table external_approvers (
  id uuid primary key default gen_random_uuid(),
  role approval_link_role not null, -- 'adviser' | 'dean' | 'sdg_rep' | 'marketing_rep'
  -- Advisers only: which org this Adviser belongs to. One row per org.
  org_id uuid references organizations(id) on delete cascade,
  person_name text not null,
  -- Dean only, for display in the Dean dropdown on applications
  -- (e.g. "School of Engineering and Architecture").
  school text,
  pin text check (pin is null or pin ~ '^[0-9]{4}$'),
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role, org_id) -- one Adviser row per org
);

create index idx_external_approvers_role on external_approvers(role);
create index idx_external_approvers_org on external_approvers(org_id);

alter table external_approvers enable row level security;

-- Admin-only, full stop — this table is never exposed to org accounts
-- and the PIN itself never appears anywhere outside this table.
create policy external_approvers_admin_only on external_approvers for all
  using (is_admin_tier())
  with check (is_admin_tier());

-- ---------- Seed the fixed Dean and SDG Representative rosters ----------
insert into external_approvers (role, person_name, school) values
  ('dean', 'Engr. Bryan De Guzman', 'School of Engineering and Architecture'),
  ('dean', 'Mr. Vincent Rivera', 'School of Computer Studies'),
  ('dean', 'Dr. Don Magpantay', 'School of Accountancy, Business, and Management'),
  ('dean', 'Dr. Carlito Loyola', 'School of Arts and Sciences')
on conflict do nothing;

insert into external_approvers (role, person_name) values
  ('sdg_rep', 'Mr. Gil Mallen'),
  ('sdg_rep', 'Ms. Merly Matibag'),
  ('sdg_rep', 'Mr. Kim Licerio'),
  ('sdg_rep', 'Mr. Joseph De Grano')
on conflict do nothing;

-- One Adviser row per currently active organization, seeded from
-- whatever's already on file.
insert into external_approvers (role, org_id, person_name)
select 'adviser', id, coalesce(nullif(trim(adviser_name), ''), 'Unnamed Adviser')
from organizations
where is_active
on conflict (role, org_id) do nothing;

-- Keep the roster in sync going forward: every newly created org gets
-- an Adviser row automatically (no PIN yet — SDAO assigns one later).
create or replace function seed_adviser_row_for_org() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into external_approvers (role, org_id, person_name)
  values ('adviser', new.id, coalesce(nullif(trim(new.adviser_name), ''), 'Unnamed Adviser'))
  on conflict (role, org_id) do nothing;
  return new;
end;
$$;

create trigger trg_seed_adviser_row_for_org
  after insert on organizations
  for each row execute function seed_adviser_row_for_org();

-- ============================================================
-- Admin management RPCs — all gated to is_admin_tier().
-- ============================================================

create or replace function set_external_approver_pin(p_id uuid, p_pin text) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_tier() then
    raise exception 'not authorized';
  end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;
  update external_approvers set pin = p_pin, updated_at = now() where id = p_id;
end;
$$;

-- Generates a random 4-digit PIN, saves it, and returns it (the one
-- and only time it needs generating — after this it's just stored,
-- editable, and viewable through the normal admin-only select).
create or replace function generate_external_approver_pin(p_id uuid) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pin text;
begin
  if not is_admin_tier() then
    raise exception 'not authorized';
  end if;
  v_pin := lpad(floor(random() * 10000)::int::text, 4, '0');
  update external_approvers set pin = v_pin, updated_at = now() where id = p_id;
  return v_pin;
end;
$$;

create or replace function add_external_approver(
  p_role approval_link_role,
  p_person_name text,
  p_school text default null,
  p_org_id uuid default null
) returns external_approvers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row external_approvers;
begin
  if not is_admin_tier() then
    raise exception 'not authorized';
  end if;
  if trim(coalesce(p_person_name, '')) = '' then
    raise exception 'Name is required';
  end if;
  insert into external_approvers (role, org_id, person_name, school, created_by)
  values (p_role, p_org_id, trim(p_person_name), nullif(trim(coalesce(p_school, '')), ''), auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function update_external_approver(
  p_id uuid,
  p_person_name text,
  p_school text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_tier() then
    raise exception 'not authorized';
  end if;
  if trim(coalesce(p_person_name, '')) = '' then
    raise exception 'Name is required';
  end if;
  update external_approvers
    set person_name = trim(p_person_name),
        school = nullif(trim(coalesce(p_school, '')), ''),
        updated_at = now()
    where id = p_id;
end;
$$;

-- Advisers (one per org) can't be deleted, only deactivated — the row
-- needs to keep existing so a PIN can be re-assigned later. Dean/SDG
-- Rep/Marketing entries can be removed outright.
create or replace function remove_external_approver(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role approval_link_role;
begin
  if not is_admin_tier() then
    raise exception 'not authorized';
  end if;
  select role into v_role from external_approvers where id = p_id;
  if v_role = 'adviser' then
    update external_approvers set is_active = false, pin = null, updated_at = now() where id = p_id;
  else
    delete from external_approvers where id = p_id;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- get_external_approver_pin(role, org_id, person_name)
-- Internal helper (not granted to anon/authenticated) used by
-- get_approval_link/submit_approval_decision to look up whether the
-- person on a given link has a PIN assigned, and if so, what it is.
-- Adviser is matched by org (name may differ/change); everyone else
-- is matched by role + exact name, same identity the link itself
-- was issued under.
-- ------------------------------------------------------------
create or replace function get_external_approver_pin(
  p_role approval_link_role,
  p_org_id uuid,
  p_person_name text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pin text;
begin
  if p_role = 'adviser' then
    select pin into v_pin from external_approvers
      where role = 'adviser' and org_id = p_org_id and is_active limit 1;
  else
    select pin into v_pin from external_approvers
      where role = p_role and is_active and lower(trim(person_name)) = lower(trim(p_person_name))
      limit 1;
  end if;
  return v_pin;
end;
$$;

-- ============================================================
-- get_approval_link(token) — re-declared to add 'pin_required' (never
-- the PIN itself) so the public review page knows whether to show
-- the Security PIN field.
-- ============================================================
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
  v_president approval_links;
  v_moderator approval_links;
  v_needs_dean boolean;
  v_is_col boolean;
  v_is_shs boolean;
  v_prior_complete boolean;
  v_pin text;
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

  v_is_shs := v_org.department = 'shs';
  v_is_col := (not v_is_shs) and coalesce(v_org.category, '') = 'COL';
  v_needs_dean := (not v_is_col) and (not v_is_shs) and coalesce(v_org.category, '') in ('School Council', 'Academic');

  if v_is_shs then
    if v_link.role = 'org_moderator' then
      select * into v_president from approval_links
        where submission_id = v_link.submission_id and role = 'org_president';
      v_prior_complete := coalesce(v_president.status = 'approved', false);
    elsif v_link.role = 'sdg_rep' then
      select * into v_president from approval_links
        where submission_id = v_link.submission_id and role = 'org_president';
      select * into v_moderator from approval_links
        where submission_id = v_link.submission_id and role = 'org_moderator';
      v_prior_complete := coalesce(v_president.status = 'approved', false)
        and coalesce(v_moderator.status = 'approved', false);
    else
      v_prior_complete := true;
    end if;
  else
    if v_link.role = 'dean' or (v_link.role in ('sdg_rep', 'marketing_rep') and not v_is_col) then
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
      if v_is_col then
        v_prior_complete := true;
      else
        v_prior_complete := coalesce(v_adviser.status = 'approved', false)
          and (not v_needs_dean or coalesce(v_dean.status = 'approved', false));
      end if;
    else
      v_prior_complete := true;
    end if;
  end if;

  v_pin := get_external_approver_pin(v_link.role, v_submission.org_id, v_link.person_name);

  return jsonb_build_object(
    'link', jsonb_build_object(
      'role', v_link.role,
      'status', v_link.status,
      'person_name', v_link.person_name,
      'expires_at', v_link.expires_at,
      'decided_at', v_link.decided_at,
      'comment', v_link.comment,
      'sdg_selections', v_link.sdg_selections,
      'pin_required', v_pin is not null
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
      'sdgs', v_submission.sdgs,
      'type', v_submission.type,
      'merchandise_types', v_submission.merchandise_types,
      'merchandise_duration', v_submission.merchandise_duration
    ),
    'organization', jsonb_build_object(
      'name', v_org.name, 'acronym', v_org.acronym, 'category', v_org.category,
      'department', v_org.department
    ),
    'attachments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'document_type', document_type, 'file_url', file_url
      ) order by uploaded_at), '[]'::jsonb)
      from submission_attachments where submission_id = v_submission.id
    ),
    'adviser_status', case when v_link.role = 'dean'
      then coalesce(v_adviser.status::text, 'not_generated') else null end,
    'president_status', case when v_link.role = 'org_moderator'
      then coalesce(v_president.status::text, 'not_generated') else null end,
    'prior_chain_complete', case when v_link.role in ('dean', 'sdg_rep', 'marketing_rep', 'org_moderator')
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

-- ============================================================
-- submit_approval_decision — re-declared to add p_pin. When the
-- reviewer has a PIN assigned, p_pin must match exactly or the
-- decision is rejected before anything else changes.
-- Function identity in Postgres is name + parameter TYPES, so adding
-- a parameter creates a new overload rather than replacing the old
-- one — drop the previous 5-arg version first (same pattern used in
-- migration 025 when p_sdgs was added).
-- ============================================================
drop function if exists submit_approval_decision(text, approval_link_status, text, text, text[]);

create or replace function submit_approval_decision(
  p_token text,
  p_decision approval_link_status,
  p_comment text default null,
  p_signature text default null,
  p_sdgs text[] default null,
  p_pin text default null
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
  v_president approval_links;
  v_moderator approval_links;
  v_needs_dean boolean;
  v_is_col boolean;
  v_is_shs boolean;
  v_required_pin text;
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

  select * into v_submission from submissions where id = v_link.submission_id;
  select * into v_org from organizations where id = v_submission.org_id;

  v_required_pin := get_external_approver_pin(v_link.role, v_submission.org_id, v_link.person_name);
  if v_required_pin is not null and coalesce(p_pin, '') <> v_required_pin then
    raise exception 'Incorrect security PIN.';
  end if;

  if p_decision = 'approved' and v_link.role = 'sdg_rep' and coalesce(array_length(p_sdgs, 1), 0) = 0 then
    raise exception 'Please mark at least one SDG before approving';
  end if;

  v_is_shs := v_org.department = 'shs';
  v_is_col := (not v_is_shs) and coalesce(v_org.category, '') = 'COL';
  v_needs_dean := (not v_is_col) and (not v_is_shs) and coalesce(v_org.category, '') in ('School Council', 'Academic');

  if v_is_shs then
    if v_link.role = 'org_moderator' then
      select * into v_president from approval_links
        where submission_id = v_link.submission_id and role = 'org_president';
      if v_president is null or v_president.status <> 'approved' then
        raise exception 'The President has not approved this application yet';
      end if;
    elsif v_link.role = 'sdg_rep' then
      select * into v_president from approval_links
        where submission_id = v_link.submission_id and role = 'org_president';
      select * into v_moderator from approval_links
        where submission_id = v_link.submission_id and role = 'org_moderator';
      if v_president is null or v_president.status <> 'approved' then
        raise exception 'The President has not approved this application yet';
      end if;
      if v_moderator is null or v_moderator.status <> 'approved' then
        raise exception 'The Moderator has not approved this application yet';
      end if;
    end if;
  else
    if v_link.role = 'dean' then
      select * into v_adviser from approval_links
        where submission_id = v_link.submission_id and role = 'adviser';
      if v_adviser is null or v_adviser.status <> 'approved' then
        raise exception 'The Adviser has not approved this application yet';
      end if;
    end if;

    if v_link.role in ('sdg_rep', 'marketing_rep') and not v_is_col then
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
      when 'org_president' then 'President'
      when 'org_moderator' then 'Moderator'
      else initcap(v_link.role::text) end || ')',
    p_comment
  );

  if p_decision = 'rejected' then
    update submissions set stage = 'rejected', updated_at = now() where id = v_link.submission_id;
  elsif v_is_shs then
    if v_link.role = 'sdg_rep' then
      update submissions set
        sdgs = coalesce(p_sdgs, '{}'),
        sdg_representative = v_link.person_name,
        sdg_marked_at = now(),
        sdg_marked_acp_generated = false,
        stage = 'shs_review',
        updated_at = now()
      where id = v_link.submission_id;
    end if;
  else
    if v_link.role = 'sdg_rep' then
      update submissions set
        sdgs = coalesce(p_sdgs, '{}'),
        sdg_representative = v_link.person_name,
        sdg_marked_at = now(),
        sdg_marked_acp_generated = false,
        stage = case when v_is_col then 'supervisor_endorsement'::submission_stage else 'assistant_review'::submission_stage end,
        updated_at = now()
      where id = v_link.submission_id;
    elsif v_link.role = 'marketing_rep' then
      update submissions set
        marketing_representative = v_link.person_name,
        marketing_reviewed_at = now(),
        stage = case when v_is_col then 'supervisor_endorsement'::submission_stage else 'assistant_review'::submission_stage end,
        updated_at = now()
      where id = v_link.submission_id;
    else
      null;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision);
end;
$$;

-- ------------------------------------------------------------
-- list_external_approver_names(role) — authenticated, name+school
-- only (never the PIN). Powers the Dean/SDG Representative dropdowns
-- on the application's approval-link form in Submission Bin.
-- ------------------------------------------------------------
create or replace function list_external_approver_names(p_role approval_link_role)
returns table (person_name text, school text)
language sql
security definer
set search_path = public
stable
as $$
  select person_name, school from external_approvers
  where role = p_role and is_active
  order by person_name;
$$;

grant execute on function list_external_approver_names(approval_link_role) to authenticated;

grant execute on function get_external_approver_pin(approval_link_role, uuid, text) to authenticated;
grant execute on function submit_approval_decision(text, approval_link_status, text, text, text[], text) to anon, authenticated;
