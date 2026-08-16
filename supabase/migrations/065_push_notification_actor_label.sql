-- 065_push_notification_actor_label.sql
--
-- Enhancement: the submitter's push notification currently just says
-- '"<title>" status update — tap to view.' This adds who did what,
-- e.g. '"Freshers Week" was endorsed by LDL SV.' or
-- '"Freshers Week" was approved by LDL Director.', by joining
-- submission_status_history.actor_id -> profiles.full_name and
-- mapping the raw action ('checked','endorsed','approved','returned',
-- 'rejected','deadline_extended') to a readable past-tense verb.

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
  v_actor_name text;
  v_action_label text;
  v_body text;
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

  select full_name into v_actor_name from profiles where id = NEW.actor_id;

  v_action_label := case NEW.action
    when 'checked'            then 'Checked'
    when 'endorsed'           then 'Endorsed'
    when 'approved'           then 'Approved'
    when 'returned'           then 'Returned for revision'
    when 'rejected'           then 'Rejected'
    when 'deadline_extended'  then 'Given a deadline extension'
    else initcap(NEW.action)
  end;

  v_body := case
    when v_actor_name is not null then
      v_action_label || ' by ' || v_actor_name || ' — "' || v_title || '"'
    else
      '"' || v_title || '" ' || lower(v_action_label) || ' — tap to view.'
  end;

  perform net.http_post(
    url := v_base_url || '/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object(
      'profile_ids', jsonb_build_array(v_submitted_by),
      'title', 'RSO Pawrtal',
      'body', v_body,
      'url', '/submissions'
    )
  );

  return NEW;
exception when others then
  return NEW;
end;
$$;

-- Trigger definition unchanged, re-affirmed to point at the updated function.
drop trigger if exists trg_notify_submission_status_push on submission_status_history;
create trigger trg_notify_submission_status_push
  after insert on submission_status_history
  for each row
  execute function notify_submission_status_push();
