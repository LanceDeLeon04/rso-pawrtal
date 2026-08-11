-- 049_status_email_notifications.sql
--
-- Automatic email notifications on every submission status change
-- (checked / endorsed / returned / approved / rejected / deadline_extended),
-- sent to BOTH the submitter's NU email and their personal email
-- (Gmail/Outlook/etc). Fires for internal reviewer actions AND external
-- adviser/dean/SDG-rep/marketing-rep decisions, because both paths write
-- through the same `submission_status_history` table (see migrations
-- 019, 025, 038, 041, 046) — so a single AFTER INSERT trigger here
-- covers every step of the chain, including reports.
--
-- Delivery is via a Postgres Edge Function ("notify-status-email") that
-- sends through Gmail SMTP with an App Password. The trigger below just
-- fires an async HTTP call via pg_net so it never blocks or fails the
-- underlying status-change transaction.

-- 1. Second email address on submissions. `email` (added earlier) is kept
--    as the NU/school email so nothing else in the app (ACP/FRF PDFs,
--    printed forms) needs to change; `personal_email` is the new field.
alter table submissions add column if not exists personal_email text;

comment on column submissions.email is 'NU (school) email address of the submitter — printed on ACP/FRF forms and used for status emails.';
comment on column submissions.personal_email is 'Personal email address (Gmail/Outlook/etc) of the submitter — used for status emails alongside the NU email.';

-- 2. pg_net for outbound async HTTP calls from a trigger.
create extension if not exists pg_net with schema extensions;

-- 3. Small server-only config table holding the deployed Edge Function
--    base URL and a shared webhook secret. Never exposed to clients —
--    RLS is enabled with zero policies, so only the postgres/service
--    role (which bypasses RLS) can read it. Populate after deploying:
--
--      update app_config set value = 'https://<project-ref>.functions.supabase.co'
--        where key = 'functions_base_url';
--      update app_config set value = '<a long random string>'
--        where key = 'email_webhook_secret';
--
--    and set the SAME secret on the Edge Function:
--      supabase secrets set EMAIL_WEBHOOK_SECRET=<the same long random string>
create table if not exists app_config (
  key text primary key,
  value text
);

alter table app_config enable row level security;
-- Intentionally no policies: nobody using the anon/authenticated client
-- can read or write this table. Only SECURITY DEFINER functions (which
-- run as the table owner) and the service role can touch it.

insert into app_config (key, value) values
  ('functions_base_url', null),
  ('email_webhook_secret', null)
on conflict (key) do nothing;

-- 4. Trigger function: on every new status-history row, fire-and-forget
--    a POST to the notify-status-email Edge Function with just enough
--    info for it to look up the submission and send the email. Never
--    raises — a misconfigured/offline email pipeline must not block
--    approvals, endorsements, or returns.
create or replace function notify_submission_status_email()
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
    -- Not configured yet — skip silently rather than erroring out every
    -- status change until an admin finishes setup.
    return NEW;
  end if;

  perform net.http_post(
    url := v_base_url || '/notify-status-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object(
      'history_id', NEW.id,
      'submission_id', NEW.submission_id,
      'stage', NEW.stage,
      'action', NEW.action,
      'comment', NEW.comment,
      'actor_name', NEW.actor_name
    )
  );

  return NEW;
exception when others then
  -- Never let a notification failure roll back the actual approval action.
  return NEW;
end;
$$;

drop trigger if exists trg_notify_submission_status_email on submission_status_history;
create trigger trg_notify_submission_status_email
  after insert on submission_status_history
  for each row
  execute function notify_submission_status_email();
