-- 064_fix_push_role_cast.sql
--
-- Bugfix for migration 063's notify_submission_pending_approver_push().
-- profiles.role is the `user_role` enum, but the function compared it
-- against v_role_needed (declared plain `text`) with a bare `=`.
-- Postgres has no `user_role = text` operator, so this raised
-- "operator does not exist: user_role = text" on every single
-- invocation — and because the whole function body is wrapped in
-- `exception when others then return NEW`, that error was silently
-- swallowed. No log line, no net.http_post call, no invocation ever
-- reached send-push. This is why reviewer/approver push notifications
-- never fired on any stage, even for correctly-subscribed accounts,
-- while the submitter's own status-change push (which never compares
-- role) worked fine.
--
-- Fix: cast the text value to user_role before comparing.

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

  -- FIX: explicit cast to user_role — this line was the bug.
  select array_agg(id) into v_profile_ids
  from profiles where role = v_role_needed::user_role and is_active = true;

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

-- Trigger definition is unchanged, just re-affirming it points at the
-- now-fixed function.
drop trigger if exists trg_notify_submission_pending_approver_push on submission_status_history;
create trigger trg_notify_submission_pending_approver_push
  after insert on submission_status_history
  for each row
  execute function notify_submission_pending_approver_push();
