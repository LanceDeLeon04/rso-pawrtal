-- 061_approver_pending_notifications.sql
--
-- Migration 049 emails the SUBMITTER every time their submission's status
-- changes. This migration adds the other half: emailing the APPROVER
-- whose turn it now is, so SDAO Assistant / SDAO Supervisor / Academic
-- Director / SDAO-SHS / SHS Principal / Executive Director (internal),
-- and Adviser / Dean / SDG Rep / Marketing Rep / Org President / Org
-- Moderator (external) find out immediately that something is sitting in
-- their queue, instead of only discovering it if they happen to check
-- Submission Bin or their inbox for the external link.
--
-- Reuses the same `app_config` (functions_base_url, email_webhook_secret)
-- and the same fire-and-forget pg_net pattern as migration 049 — a
-- misconfigured or offline email pipeline must never block an approval,
-- endorsement, return, or link generation.

-- ------------------------------------------------------------
-- 1. Internal reviewers: fires whenever a submission_status_history row
--    lands the submission on a stage that requires an internal
--    reviewer's action. Piggybacks on the same table migration 049
--    already watches, so it fires exactly once per stage entry.
-- ------------------------------------------------------------
create or replace function notify_submission_pending_approver()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_url text;
  v_secret text;
  v_role_needed text;
begin
  v_role_needed := case NEW.stage
    when 'assistant_review'            then 'sdao_assistant'
    when 'supervisor_endorsement'      then 'sdao_supervisor'
    when 'director_approval'           then 'academic_director'
    when 'shs_review'                  then 'sdao_shs'
    when 'shs_supervisor_endorsement'  then 'sdao_supervisor'
    when 'shs_principal_approval'      then 'shs_principal'
    when 'shs_director_approval'       then 'academic_director'
    when 'shs_executive_approval'      then 'executive_director'
    else null
  end;

  if v_role_needed is null then
    return NEW;
  end if;

  select value into v_base_url from app_config where key = 'functions_base_url';
  select value into v_secret from app_config where key = 'email_webhook_secret';

  if v_base_url is null or v_base_url = '' or v_secret is null or v_secret = '' then
    return NEW;
  end if;

  perform net.http_post(
    url := v_base_url || '/notify-approver-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object(
      'kind', 'internal_stage',
      'submission_id', NEW.submission_id,
      'stage', NEW.stage,
      'role_needed', v_role_needed
    )
  );

  return NEW;
exception when others then
  -- Never let a notification failure roll back the actual status change.
  return NEW;
end;
$$;

drop trigger if exists trg_notify_submission_pending_approver on submission_status_history;
create trigger trg_notify_submission_pending_approver
  after insert on submission_status_history
  for each row
  execute function notify_submission_pending_approver();

-- ------------------------------------------------------------
-- 2. External approvers: fires whenever an approval_links row is
--    created or reissued back to 'pending' (generate_approval_link's
--    insert ... on conflict do update both go through this same
--    AFTER INSERT OR UPDATE trigger), so the adviser/dean/SDG rep/
--    marketing rep/president/moderator gets their signing link by
--    email the moment it's generated, not only if SDAO/the org
--    forwards it manually.
-- ------------------------------------------------------------
create or replace function notify_approval_link_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_url text;
  v_secret text;
begin
  if NEW.status <> 'pending' or NEW.person_email is null or NEW.person_email = '' then
    return NEW;
  end if;

  -- Only notify on genuinely new/reissued links, not on unrelated row
  -- touches (e.g. a message being appended elsewhere never hits this
  -- table, but guard anyway: reissue always resets decided_at to null
  -- and bumps created_at, which is what generate_approval_link does).
  if TG_OP = 'UPDATE' and OLD.token = NEW.token and OLD.status = 'pending' then
    return NEW;
  end if;

  select value into v_base_url from app_config where key = 'functions_base_url';
  select value into v_secret from app_config where key = 'email_webhook_secret';

  if v_base_url is null or v_base_url = '' or v_secret is null or v_secret = '' then
    return NEW;
  end if;

  perform net.http_post(
    url := v_base_url || '/notify-approver-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object(
      'kind', 'external_link',
      'link_id', NEW.id
    )
  );

  return NEW;
exception when others then
  return NEW;
end;
$$;

drop trigger if exists trg_notify_approval_link_pending on approval_links;
create trigger trg_notify_approval_link_pending
  after insert or update on approval_links
  for each row
  execute function notify_approval_link_pending();
