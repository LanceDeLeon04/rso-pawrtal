-- 066_assignment_push_notifications.sql
--
-- RSOs currently get an email + push alert on every submission status
-- change (migrations 049/063), including 'returned' and 'rejected' — so
-- those two are already covered. The one gap this migration closes is
-- getting no notification at all when SDAO assigns them a new task via
-- the Assignments page (assignments table, see migration 010).
--
-- On every new assignments row, resolve which profiles it targets —
-- a specific user (assigned_to), every member holding a given position
-- tag (assigned_tag), or every member of a specific org
-- (assigned_org_id) — and fire the same fire-and-forget push notice
-- used elsewhere (send-push, via app_config/pg_net so a misconfigured
-- or offline pipeline never blocks assignment creation).

create or replace function notify_assignment_created_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_url text;
  v_secret text;
  v_profile_ids uuid[];
begin
  select value into v_base_url from app_config where key = 'functions_base_url';
  select value into v_secret from app_config where key = 'email_webhook_secret';
  if v_base_url is null or v_base_url = '' or v_secret is null or v_secret = '' then
    return NEW;
  end if;

  if NEW.assigned_to is not null then
    v_profile_ids := array[NEW.assigned_to];
  elsif NEW.assigned_org_id is not null then
    select array_agg(distinct om.profile_id) into v_profile_ids
    from org_memberships om
    where om.org_id = NEW.assigned_org_id;
  elsif NEW.assigned_tag is not null then
    select array_agg(distinct om.profile_id) into v_profile_ids
    from org_memberships om
    where om.position = NEW.assigned_tag;
  end if;

  if v_profile_ids is null or array_length(v_profile_ids, 1) is null then
    return NEW;
  end if;

  perform net.http_post(
    url := v_base_url || '/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object(
      'profile_ids', to_jsonb(v_profile_ids),
      'title', 'RSO Pawrtal — new task assigned',
      'body', '"' || NEW.title || '" was assigned to you' || case when NEW.due_date is not null then ', due ' || NEW.due_date else '' end || '.',
      'url', '/assignments'
    )
  );

  return NEW;
exception when others then
  -- Never let a notification failure roll back assignment creation.
  return NEW;
end;
$$;

drop trigger if exists trg_notify_assignment_created_push on assignments;
create trigger trg_notify_assignment_created_push
  after insert on assignments
  for each row
  execute function notify_assignment_created_push();
