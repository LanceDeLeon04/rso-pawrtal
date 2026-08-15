-- 063_push_notifications.sql
--
-- Browser/desktop push notifications (Web Push), on top of the existing
-- email notifications from migrations 049 and 061.
--
-- Scope (per product decision): push goes to anyone with an in-app
-- account — submitters (profiles.id = submissions.submitted_by) and
-- internal reviewers (SDAO Assistant/Supervisor, Academic Director,
-- SDAO-SHS, SHS Principal, Executive Director). External approvers
-- (Adviser/Dean/SDG Rep/Marketing Rep/Org President/Org Moderator)
-- have no account to subscribe from, so they stay email-only — the
-- migration 061 external-link trigger is untouched.
--
-- A browser subscription (one per profile per browser/device) is saved
-- to `push_subscriptions` once the user opts in and grants permission.
-- The same `app_config` (functions_base_url, email_webhook_secret) and
-- fire-and-forget pg_net pattern is reused: a misconfigured or offline
-- push pipeline must never block a status change or approval action.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_profile on push_subscriptions(profile_id);

alter table push_subscriptions enable row level security;

-- Each user manages only their own subscriptions.
drop policy if exists "push_subscriptions_own" on push_subscriptions;
create policy "push_subscriptions_own" on push_subscriptions
  for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ------------------------------------------------------------
-- 1. Submitter push — piggybacks on the same insert migration 049's
--    trg_notify_submission_status_email already watches.
-- ------------------------------------------------------------
create or replace function notify_submission_status_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_url text;
  v_secret text;
  v_submitted_by uuid;
  v_title text;
begin
  select value into v_base_url from app_config where key = 'functions_base_url';
  select value into v_secret from app_config where key = 'email_webhook_secret';
  if v_base_url is null or v_base_url = '' or v_secret is null or v_secret = '' then
    return NEW;
  end if;

  select submitted_by, title into v_submitted_by, v_title
  from submissions where id = NEW.submission_id;

  if v_submitted_by is null then
    return NEW;
  end if;

  perform net.http_post(
    url := v_base_url || '/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object(
      'profile_ids', jsonb_build_array(v_submitted_by),
      'title', 'RSO Pawrtal',
      'body', '"' || v_title || '" status update — tap to view.',
      'url', '/submissions'
    )
  );

  return NEW;
exception when others then
  return NEW;
end;
$$;

drop trigger if exists trg_notify_submission_status_push on submission_status_history;
create trigger trg_notify_submission_status_push
  after insert on submission_status_history
  for each row
  execute function notify_submission_status_push();

-- ------------------------------------------------------------
-- 2. Internal reviewer push — piggybacks on the same insert migration
--    061's trg_notify_submission_pending_approver already watches.
-- ------------------------------------------------------------
create or replace function notify_submission_pending_approver_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_url text;
  v_secret text;
  v_role_needed text;
  v_title text;
  v_profile_ids uuid[];
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

  select array_agg(id) into v_profile_ids
  from profiles where role = v_role_needed and is_active = true;

  if v_profile_ids is null or array_length(v_profile_ids, 1) is null then
    return NEW;
  end if;

  select title into v_title from submissions where id = NEW.submission_id;

  perform net.http_post(
    url := v_base_url || '/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object(
      'profile_ids', to_jsonb(v_profile_ids),
      'title', 'RSO Pawrtal — action needed',
      'body', '"' || v_title || '" is waiting on your review.',
      'url', '/submissions'
    )
  );

  return NEW;
exception when others then
  return NEW;
end;
$$;

drop trigger if exists trg_notify_submission_pending_approver_push on submission_status_history;
create trigger trg_notify_submission_pending_approver_push
  after insert on submission_status_history
  for each row
  execute function notify_submission_pending_approver_push();
