-- ============================================================
-- 071: Renewal override-approve (System Admin) + auto-accreditation
-- ============================================================
-- Two additions to the renewal chain from migration 070:
--
-- 1. Whenever a renewal reaches 'approved' — whether it got there by
--    walking the normal Assistant -> Supervisor -> Director chain, or
--    by a System Admin override — the org's accreditation_status is
--    automatically flipped to 'accredited'. Centralized in one helper
--    so both paths stay in sync.
--
-- 2. override_approve_org_renewal(p_renewal_id, p_comment): System
--    Admin only. Marks a renewal 'approved' directly from whatever
--    stage it's currently in (draft/returned/any pending step),
--    skipping the remaining chain, and accredits the org the same way.

create or replace function accredit_org_for_renewal(p_org_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update organizations set accreditation_status = 'accredited' where id = p_org_id;
end;
$$;

-- Re-declare decide_org_renewal so the normal chain's final approval
-- step (Director advancing from 'director_approval') also accredits
-- the org, on top of everything migration 070 already does.
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

  if v_next = 'approved' then
    perform accredit_org_for_renewal(v_renewal.org_id);
  end if;
end;
$$;

-- ============================================================
-- override_approve_org_renewal(p_renewal_id, p_comment)
-- System Admin only. Skips the remaining chain and marks the
-- renewal approved directly, accrediting the org the same way a
-- normal Director approval would.
-- ============================================================
create or replace function override_approve_org_renewal(
  p_renewal_id uuid,
  p_comment text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_renewal org_renewals;
begin
  if current_role_name() <> 'system_admin' then
    raise exception 'only System Admin can override-approve a renewal';
  end if;

  select * into v_renewal from org_renewals where id = p_renewal_id for update;
  if v_renewal is null then
    raise exception 'renewal not found';
  end if;

  if v_renewal.stage = 'approved' then
    raise exception 'renewal is already approved';
  end if;

  update org_renewals
    set stage = 'approved',
        updated_at = now(),
        decided_at = now()
    where id = p_renewal_id;

  insert into org_renewal_history (renewal_id, stage, action, actor_id, comment)
  values (p_renewal_id, 'approved', 'override_approved', auth.uid(), p_comment);

  perform accredit_org_for_renewal(v_renewal.org_id);
end;
$$;
