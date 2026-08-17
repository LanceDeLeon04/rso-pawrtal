-- ============================================================
-- 073: SHS President / Moderator Security PINs
-- ============================================================
-- SHS organizations have no Adviser — their external, account-less
-- approval chain starts with the org's President, then Moderator
-- (see 052a/052b), before SDG Representative. This adds the same
-- hidden 4-digit PIN gate (migration 072) on top of the President
-- and Moderator magic links.
--
-- Unlike Adviser/Dean/SDG Rep/Marketing (managed by any SDAO/Admin,
-- see 072), President and Moderator keys are SHS-only and are
-- managed EXCLUSIVELY by SDAO-SHS and System Admin — the College-side
-- sdao_assistant/sdao_supervisor/academic_director/etc. roles that
-- pass is_admin_tier() have no business here.
--
-- President/Moderator rows are seeded one-per-SHS-org, same shape as
-- the existing one-per-org Adviser row (external_approvers already
-- supports any approval_link_role, including the 'org_president'/
-- 'org_moderator' values added in 052a) — no table changes needed.

-- ------------------------------------------------------------
-- Authorization helper: who may manage a given external-approver
-- role's roster/PIN. President/Moderator -> SDAO-SHS + Admin only.
-- Everything else keeps the existing is_admin_tier() rule from 072.
-- ------------------------------------------------------------
create or replace function can_manage_external_approver(p_role approval_link_role) returns boolean
language sql stable security definer
as $$
  select case
    when p_role in ('org_president', 'org_moderator')
      then current_role_name() in ('sdao_shs', 'system_admin')
    else is_admin_tier()
  end;
$$;

-- ------------------------------------------------------------
-- RLS: let SDAO-SHS read/manage their own President/Moderator rows
-- directly (Settings page queries external_approvers straight from
-- the client). System Admin already covered by external_approvers_admin_only.
-- ------------------------------------------------------------
create policy external_approvers_sdao_shs on external_approvers for all
  using (current_role_name() = 'sdao_shs' and role in ('org_president', 'org_moderator'))
  with check (current_role_name() = 'sdao_shs' and role in ('org_president', 'org_moderator'));

-- ------------------------------------------------------------
-- Seed one President row + one Moderator row per currently active
-- SHS organization (College orgs get neither — they use Adviser).
-- ------------------------------------------------------------
insert into external_approvers (role, org_id, person_name)
select 'org_president', id, 'Unnamed President'
from organizations
where is_active and department = 'shs'
on conflict (role, org_id) do nothing;

insert into external_approvers (role, org_id, person_name)
select 'org_moderator', id, 'Unnamed Moderator'
from organizations
where is_active and department = 'shs'
on conflict (role, org_id) do nothing;

-- Keep the roster in sync going forward: every newly created SHS org
-- gets President + Moderator rows automatically (no PIN yet —
-- SDAO-SHS assigns one later). College orgs already get an Adviser
-- row from the 072 trigger; this only fires for department = 'shs'.
create or replace function seed_president_moderator_rows_for_org() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.department = 'shs' then
    insert into external_approvers (role, org_id, person_name)
    values ('org_president', new.id, 'Unnamed President')
    on conflict (role, org_id) do nothing;
    insert into external_approvers (role, org_id, person_name)
    values ('org_moderator', new.id, 'Unnamed Moderator')
    on conflict (role, org_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_seed_president_moderator_rows_for_org
  after insert on organizations
  for each row execute function seed_president_moderator_rows_for_org();

-- ============================================================
-- Admin management RPCs — re-declared to check
-- can_manage_external_approver(role) instead of a flat is_admin_tier(),
-- so President/Moderator rows are gated to SDAO-SHS/Admin while
-- Adviser/Dean/SDG Rep/Marketing keep the existing wider SDAO/Admin
-- access from 072.
-- ============================================================

create or replace function set_external_approver_pin(p_id uuid, p_pin text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role approval_link_role;
begin
  select role into v_role from external_approvers where id = p_id;
  if v_role is null or not can_manage_external_approver(v_role) then
    raise exception 'not authorized';
  end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;
  update external_approvers set pin = p_pin, updated_at = now() where id = p_id;
end;
$$;

create or replace function generate_external_approver_pin(p_id uuid) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role approval_link_role;
  v_pin text;
begin
  select role into v_role from external_approvers where id = p_id;
  if v_role is null or not can_manage_external_approver(v_role) then
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
  if not can_manage_external_approver(p_role) then
    raise exception 'not authorized';
  end if;
  if p_role in ('org_president', 'org_moderator') then
    raise exception 'President and Moderator entries are seeded per SHS organization and cannot be added manually';
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
declare
  v_role approval_link_role;
begin
  select role into v_role from external_approvers where id = p_id;
  if v_role is null or not can_manage_external_approver(v_role) then
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

-- President/Moderator rows follow the same "can't delete, only
-- deactivate" rule Adviser rows already follow (072) — the row needs
-- to keep existing so a PIN can be re-assigned later.
create or replace function remove_external_approver(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role approval_link_role;
begin
  select role into v_role from external_approvers where id = p_id;
  if v_role is null or not can_manage_external_approver(v_role) then
    raise exception 'not authorized';
  end if;
  if v_role in ('adviser', 'org_president', 'org_moderator') then
    update external_approvers set is_active = false, pin = null, updated_at = now() where id = p_id;
  else
    delete from external_approvers where id = p_id;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- get_external_approver_pin — re-declared so President/Moderator are
-- looked up by org (like Adviser), not by name. President/Moderator
-- names can change per submission (typed in on Submission Bin) while
-- the PIN itself belongs to whoever holds the office for that SHS
-- org, so org-based lookup is the correct match, same reasoning as
-- Adviser.
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
  if p_role in ('adviser', 'org_president', 'org_moderator') then
    select pin into v_pin from external_approvers
      where role = p_role and org_id = p_org_id and is_active limit 1;
  else
    select pin into v_pin from external_approvers
      where role = p_role and is_active and lower(trim(person_name)) = lower(trim(p_person_name))
      limit 1;
  end if;
  return v_pin;
end;
$$;
