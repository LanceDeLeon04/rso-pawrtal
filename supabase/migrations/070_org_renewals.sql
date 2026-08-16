-- ============================================================
-- 070: RSO Renewal Policy
-- ============================================================
-- Once SDAO sets a new Academic Year "current" (migration 040), SDAO
-- can open Renewal for that academic year from Settings. Opening
-- renewal auto-creates one org_renewals row (stage = 'assistant_review'
-- once submitted; 'draft' until then) per active organization, tagged
-- to that org's President position — this IS the "automatic
-- assignment" (no separate `assignments` row needed; the Renewal page
-- itself is the President's queue).
--
-- Approval chain mirrors the ACP/reschedule chain exactly:
--   Org (President) submits -> SDAO Assistant -> SDAO Supervisor ->
--   Academic Director -> approved. Any reviewer step can Return for
--   Revision, which kicks it back to 'draft' so the President can
--   fix and resubmit (no separate re-review of earlier steps skipped
--   — it always restarts at Assistant, same as the ACP chain).
--
-- Requirements (each an attachment, except Constitution & By-Laws
-- which SDAO can optionally allow as a checkbox declaration instead
-- of a file — see renewal_settings.allow_bylaws_checkbox):
--   General Plan of Action, List of Officers, Constitution and
--   By-Laws, Financial Statement, Summary of Evaluations,
--   Endorsement Letter for Adviser, Letter of Intent.

create type org_renewal_stage as enum (
  'draft',
  'assistant_review',
  'supervisor_endorsement',
  'director_approval',
  'approved',
  'returned'
);

-- ---------- Per-academic-year renewal policy ----------
create table renewal_settings (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null unique references academic_years(id) on delete cascade,
  is_open boolean not null default false,
  deadline date,
  -- When true, the President can check "Constitution & By-Laws on
  -- file, no changes" instead of re-uploading the document every year.
  allow_bylaws_checkbox boolean not null default false,
  opened_by uuid references profiles(id),
  opened_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table renewal_settings enable row level security;

create policy renewal_settings_select on renewal_settings for select
  using (auth.role() = 'authenticated');

create policy renewal_settings_write_sdao on renewal_settings for all
  using (current_role_name() in ('sdao_assistant', 'sdao_supervisor', 'system_admin'))
  with check (current_role_name() in ('sdao_assistant', 'sdao_supervisor', 'system_admin'));

-- ---------- Per-org renewal ----------
create table org_renewals (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references academic_years(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  stage org_renewal_stage not null default 'draft',
  -- Constitution & By-Laws declared on file instead of re-uploaded —
  -- only meaningful when renewal_settings.allow_bylaws_checkbox is true.
  bylaws_declared boolean not null default false,
  president_profile_id uuid references profiles(id),
  submitted_by uuid references profiles(id),
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year_id, org_id)
);

create index idx_org_renewals_academic_year on org_renewals(academic_year_id);
create index idx_org_renewals_org on org_renewals(org_id);
create index idx_org_renewals_stage on org_renewals(stage);

create table org_renewal_attachments (
  id uuid primary key default gen_random_uuid(),
  renewal_id uuid not null references org_renewals(id) on delete cascade,
  -- 'General Plan of Action' | 'List of Officers' | 'Constitution and By-Laws' |
  -- 'Financial Statement' | 'Summary of Evaluations' |
  -- 'Endorsement Letter for Adviser' | 'Letter of Intent'
  document_type text not null,
  file_url text not null,
  uploaded_at timestamptz not null default now()
);

create index idx_org_renewal_attachments_renewal on org_renewal_attachments(renewal_id);

-- Mirrors submission_status_history / reschedule_request_history.
create table org_renewal_history (
  id uuid primary key default gen_random_uuid(),
  renewal_id uuid not null references org_renewals(id) on delete cascade,
  stage org_renewal_stage not null,
  action text not null, -- 'assigned','submitted','checked','endorsed','approved','returned','deadline_extended'
  actor_id uuid references profiles(id),
  comment text,
  created_at timestamptz not null default now()
);

create index idx_org_renewal_history_renewal on org_renewal_history(renewal_id);

alter table org_renewals enable row level security;
alter table org_renewal_attachments enable row level security;
alter table org_renewal_history enable row level security;

create policy org_renewals_select on org_renewals for select
  using (
    is_admin_tier()
    or current_role_name() in ('sdao_assistant', 'sdao_supervisor', 'academic_director')
    or org_id in (select org_id from org_memberships where profile_id = auth.uid())
  );

-- Inserts/decisions go through the security-definer functions below.
create policy org_renewals_update_admin on org_renewals for update
  using (is_admin_tier());

create policy org_renewal_attachments_select on org_renewal_attachments for select
  using (
    is_admin_tier()
    or current_role_name() in ('sdao_assistant', 'sdao_supervisor', 'academic_director')
    or exists (
      select 1 from org_renewals r
      join org_memberships m on m.org_id = r.org_id and m.profile_id = auth.uid()
      where r.id = org_renewal_attachments.renewal_id
    )
  );

-- The President (or admin) uploads directly to this table while their
-- renewal is still a draft or has been returned for revision.
create policy org_renewal_attachments_write on org_renewal_attachments for insert
  with check (
    is_admin_tier()
    or exists (
      select 1 from org_renewals r
      join org_memberships m on m.org_id = r.org_id and m.profile_id = auth.uid()
      where r.id = org_renewal_attachments.renewal_id
        and r.stage in ('draft', 'returned')
        and m.position = 'President'
    )
  );

create policy org_renewal_attachments_delete on org_renewal_attachments for delete
  using (
    is_admin_tier()
    or exists (
      select 1 from org_renewals r
      join org_memberships m on m.org_id = r.org_id and m.profile_id = auth.uid()
      where r.id = org_renewal_attachments.renewal_id
        and r.stage in ('draft', 'returned')
        and m.position = 'President'
    )
  );

create policy org_renewal_history_select on org_renewal_history for select
  using (
    is_admin_tier()
    or current_role_name() in ('sdao_assistant', 'sdao_supervisor', 'academic_director')
    or exists (
      select 1 from org_renewals r
      join org_memberships m on m.org_id = r.org_id and m.profile_id = auth.uid()
      where r.id = org_renewal_history.renewal_id
    )
  );

-- ---------- Storage bucket + policies ----------
insert into storage.buckets (id, name, public)
values ('org-renewal-attachments', 'org-renewal-attachments', false)
on conflict (id) do nothing;

create policy org_renewal_attachments_storage_read on storage.objects
  for select using (bucket_id = 'org-renewal-attachments' and auth.role() = 'authenticated');

create policy org_renewal_attachments_storage_write on storage.objects
  for insert with check (bucket_id = 'org-renewal-attachments' and auth.role() = 'authenticated');

create policy org_renewal_attachments_storage_delete on storage.objects
  for delete using (bucket_id = 'org-renewal-attachments' and auth.role() = 'authenticated');

-- ============================================================
-- open_org_renewal(p_academic_year_id, p_deadline, p_allow_bylaws_checkbox)
-- SDAO Assistant/Supervisor/System Admin only. Upserts the settings
-- row for that academic year to is_open = true, and creates a
-- 'draft' org_renewals row for every active organization that
-- doesn't already have one for this academic year — auto-assigning
-- the renewal to whoever currently holds the President position.
-- ============================================================
create or replace function open_org_renewal(
  p_academic_year_id uuid,
  p_deadline date,
  p_allow_bylaws_checkbox boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org record;
  v_renewal_id uuid;
begin
  if current_role_name() not in ('sdao_assistant', 'sdao_supervisor', 'system_admin') then
    raise exception 'not authorized to open renewal';
  end if;

  insert into renewal_settings (academic_year_id, is_open, deadline, allow_bylaws_checkbox, opened_by, opened_at, updated_at)
  values (p_academic_year_id, true, p_deadline, coalesce(p_allow_bylaws_checkbox, false), auth.uid(), now(), now())
  on conflict (academic_year_id) do update
    set is_open = true,
        deadline = excluded.deadline,
        allow_bylaws_checkbox = excluded.allow_bylaws_checkbox,
        opened_by = excluded.opened_by,
        opened_at = now(),
        updated_at = now();

  for v_org in select id from organizations where is_active loop
    insert into org_renewals (academic_year_id, org_id, stage, president_profile_id)
    values (
      p_academic_year_id,
      v_org.id,
      'draft',
      (select profile_id from org_memberships where org_id = v_org.id and position = 'President' limit 1)
    )
    on conflict (academic_year_id, org_id) do nothing
    returning id into v_renewal_id;

    if v_renewal_id is not null then
      insert into org_renewal_history (renewal_id, stage, action, actor_id, comment)
      values (v_renewal_id, 'draft', 'assigned', auth.uid(), null);
    end if;
    v_renewal_id := null;
  end loop;
end;
$$;

-- ============================================================
-- update_org_renewal_deadline(p_academic_year_id, p_deadline, p_allow_bylaws_checkbox)
-- Lets SDAO change the deadline and/or the By-Laws checkbox allowance
-- at any point, open or not.
-- ============================================================
create or replace function update_org_renewal_deadline(
  p_academic_year_id uuid,
  p_deadline date,
  p_allow_bylaws_checkbox boolean default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_role_name() not in ('sdao_assistant', 'sdao_supervisor', 'system_admin') then
    raise exception 'not authorized to change the renewal deadline';
  end if;

  update renewal_settings
    set deadline = p_deadline,
        allow_bylaws_checkbox = coalesce(p_allow_bylaws_checkbox, allow_bylaws_checkbox),
        updated_at = now()
    where academic_year_id = p_academic_year_id;
end;
$$;

-- ============================================================
-- close_org_renewal(p_academic_year_id)
-- Stops new submissions from Draft; already-submitted renewals keep
-- moving through the approval chain untouched.
-- ============================================================
create or replace function close_org_renewal(p_academic_year_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_role_name() not in ('sdao_assistant', 'sdao_supervisor', 'system_admin') then
    raise exception 'not authorized to close renewal';
  end if;

  update renewal_settings set is_open = false, updated_at = now()
    where academic_year_id = p_academic_year_id;
end;
$$;

-- ============================================================
-- submit_org_renewal(p_renewal_id, p_bylaws_declared, p_comment)
-- Called by the org's President. Requires every requirement doc to
-- either be attached, or (Constitution & By-Laws only) declared via
-- checkbox when SDAO has allowed that for this academic year.
-- ============================================================
create or replace function submit_org_renewal(
  p_renewal_id uuid,
  p_bylaws_declared boolean default false,
  p_comment text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_renewal org_renewals;
  v_settings renewal_settings;
  v_have text[];
  v_required text[] := array[
    'General Plan of Action', 'List of Officers', 'Constitution and By-Laws',
    'Financial Statement', 'Summary of Evaluations',
    'Endorsement Letter for Adviser', 'Letter of Intent'
  ];
  v_doc text;
begin
  select * into v_renewal from org_renewals where id = p_renewal_id for update;
  if v_renewal is null then
    raise exception 'renewal not found';
  end if;

  if v_renewal.org_id not in (
    select org_id from org_memberships where profile_id = auth.uid() and position = 'President'
  ) and not is_admin_tier() then
    raise exception 'only the org President can submit renewal requirements';
  end if;

  if v_renewal.stage not in ('draft', 'returned') then
    raise exception 'this renewal is already under review or has been approved';
  end if;

  select * into v_settings from renewal_settings where academic_year_id = v_renewal.academic_year_id;
  if v_settings is null or not v_settings.is_open then
    raise exception 'renewal is not currently open';
  end if;

  select array_agg(distinct document_type) into v_have
    from org_renewal_attachments where renewal_id = p_renewal_id;
  v_have := coalesce(v_have, '{}');

  foreach v_doc in array v_required loop
    if v_doc = 'Constitution and By-Laws'
       and v_settings.allow_bylaws_checkbox
       and coalesce(p_bylaws_declared, false) then
      continue;
    end if;
    if not (v_doc = any(v_have)) then
      raise exception 'missing requirement: %', v_doc;
    end if;
  end loop;

  update org_renewals
    set stage = 'assistant_review',
        bylaws_declared = coalesce(p_bylaws_declared, false),
        submitted_by = auth.uid(),
        submitted_at = now(),
        updated_at = now()
    where id = p_renewal_id;

  insert into org_renewal_history (renewal_id, stage, action, actor_id, comment)
  values (p_renewal_id, 'assistant_review', 'submitted', auth.uid(), p_comment);
end;
$$;

-- ============================================================
-- decide_org_renewal(p_renewal_id, p_action, p_comment)
-- p_action: 'advance' (check/endorse/approve) or 'return'.
-- Enforces that only the role matching the current stage can act —
-- same shape as decide_reschedule_request.
-- ============================================================
create or replace function decide_org_renewal(
  p_renewal_id uuid,
  p_action text,
  p_comment text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_renewal org_renewals;
  v_role text := current_role_name();
  v_next org_renewal_stage;
  v_history_action text;
begin
  select * into v_renewal from org_renewals where id = p_renewal_id for update;
  if v_renewal is null then
    raise exception 'renewal not found';
  end if;

  if v_renewal.stage = 'assistant_review' and v_role <> 'sdao_assistant' and not is_admin_tier() then
    raise exception 'awaiting SDAO Assistant';
  elsif v_renewal.stage = 'supervisor_endorsement' and v_role <> 'sdao_supervisor' and not is_admin_tier() then
    raise exception 'awaiting SDAO Supervisor';
  elsif v_renewal.stage = 'director_approval' and v_role <> 'academic_director' and not is_admin_tier() then
    raise exception 'awaiting Academic Director';
  elsif v_renewal.stage not in ('assistant_review', 'supervisor_endorsement', 'director_approval') then
    raise exception 'renewal already decided or not yet submitted';
  end if;

  if p_action = 'return' then
    v_next := 'returned';
    v_history_action := 'returned';
  elsif p_action = 'advance' then
    if v_renewal.stage = 'assistant_review' then
      v_next := 'supervisor_endorsement';
      v_history_action := 'checked';
    elsif v_renewal.stage = 'supervisor_endorsement' then
      v_next := 'director_approval';
      v_history_action := 'endorsed';
    else
      v_next := 'approved';
      v_history_action := 'approved';
    end if;
  else
    raise exception 'unknown action %', p_action;
  end if;

  update org_renewals
    set stage = v_next,
        updated_at = now(),
        decided_at = case when v_next in ('approved', 'returned') then now() else decided_at end
    where id = p_renewal_id;

  insert into org_renewal_history (renewal_id, stage, action, actor_id, comment)
  values (p_renewal_id, v_next, v_history_action, auth.uid(), p_comment);
end;
$$;
