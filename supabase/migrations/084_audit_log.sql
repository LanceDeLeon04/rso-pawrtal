-- ============================================================
-- 084: System audit log
-- ============================================================
-- A single append-only `audit_logs` table recording security- and
-- account-relevant events across the system, surfaced under
-- Settings -> System Audit Log for top-tier admins only.
--
-- Rather than have every page/edge-function remember to log itself,
-- most entries are captured centrally via triggers on `profiles`
-- (the table almost every sensitive action already touches):
--   - INSERT                          -> 'account_created'
--   - is_active flips false -> true   -> 'account_reactivated'
--   - is_active flips true -> false   -> 'account_deactivated'
--   - role changes                    -> 'role_changed'
--   - full_name changes               -> 'profile_renamed'
--   - locked_at set                   -> 'account_locked'
--   - locked_at cleared               -> 'account_unlocked'
-- This also means migration 083's lockout functions (record_failed_login,
-- reset_account_lock) get 'account_locked'/'account_unlocked' logging
-- for free, since they just update the same columns.
--
-- Two things can't be captured by a profiles trigger and are logged
-- explicitly instead:
--   - Every wrong-password attempt (not just the ones that cross a
--     lockout threshold) -> logged inside record_failed_login itself.
--   - A successful login -> logged inside reset_login_attempts, which
--     already runs once per successful sign-in (see AuthContext.jsx).
--   - Account deletion, which happens via auth.admin.deleteUser() in
--     the delete-account Edge Function and cascades the profiles row
--     away before any AFTER DELETE trigger here could still read
--     useful context -> logged explicitly in that function instead,
--     using the service-role client.

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,
  actor_role text,
  action text not null,
  target_type text,
  target_id uuid,
  target_label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_created_at on audit_logs (created_at desc);
create index idx_audit_logs_actor_id on audit_logs (actor_id);
create index idx_audit_logs_action on audit_logs (action);

alter table audit_logs enable row level security;

-- Deliberately narrower than ADMIN_ROLES/isAdminTier() — the log can
-- contain other admins' account actions, so it's restricted to the
-- top tier that already has unrestricted account management access.
create policy audit_logs_select on audit_logs
  for select
  using (
    exists (
      select 1 from profiles
      where id = auth.uid()
        and role in ('system_admin', 'sdao_supervisor', 'executive_director')
    )
  );

-- No insert/update/delete policy is granted here on purpose: every row
-- is written by a security-definer function below (or the delete-account
-- Edge Function using the service-role key), never directly by a client.

-- ------------------------------------------------------------
-- profiles INSERT -> account_created
-- ------------------------------------------------------------
create or replace function log_profile_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor profiles%rowtype;
begin
  if NEW.created_by is not null then
    select * into v_actor from profiles where id = NEW.created_by;
  end if;

  insert into audit_logs (actor_id, actor_name, actor_role, action, target_type, target_id, target_label, metadata)
  values (
    NEW.created_by, v_actor.full_name, v_actor.role,
    'account_created', 'profile', NEW.id, NEW.full_name,
    jsonb_build_object('role', NEW.role, 'email', NEW.email)
  );
  return NEW;
exception when others then
  -- A logging failure must never block account creation.
  return NEW;
end;
$$;

drop trigger if exists trg_audit_profile_created on profiles;
create trigger trg_audit_profile_created
  after insert on profiles
  for each row execute function log_profile_created();

-- ------------------------------------------------------------
-- profiles UPDATE -> account_(de)activated / role_changed /
-- profile_renamed / account_locked / account_unlocked
-- ------------------------------------------------------------
create or replace function log_profile_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor profiles%rowtype;
begin
  -- auth.uid() reflects the JWT on the request that caused this
  -- update, regardless of this function's own (definer) privileges —
  -- so it correctly names the admin who clicked the button, even
  -- though this trigger runs with elevated rights to write the log.
  select * into v_actor from profiles where id = auth.uid();

  if NEW.is_active is distinct from OLD.is_active then
    insert into audit_logs (actor_id, actor_name, actor_role, action, target_type, target_id, target_label, metadata)
    values (
      auth.uid(), v_actor.full_name, v_actor.role,
      case when NEW.is_active then 'account_reactivated' else 'account_deactivated' end,
      'profile', NEW.id, NEW.full_name, '{}'::jsonb
    );
  end if;

  if NEW.role is distinct from OLD.role then
    insert into audit_logs (actor_id, actor_name, actor_role, action, target_type, target_id, target_label, metadata)
    values (
      auth.uid(), v_actor.full_name, v_actor.role, 'role_changed',
      'profile', NEW.id, NEW.full_name,
      jsonb_build_object('from', OLD.role, 'to', NEW.role)
    );
  end if;

  if NEW.full_name is distinct from OLD.full_name then
    insert into audit_logs (actor_id, actor_name, actor_role, action, target_type, target_id, target_label, metadata)
    values (
      auth.uid(), v_actor.full_name, v_actor.role, 'profile_renamed',
      'profile', NEW.id, NEW.full_name,
      jsonb_build_object('from', OLD.full_name, 'to', NEW.full_name)
    );
  end if;

  if NEW.locked_at is distinct from OLD.locked_at then
    insert into audit_logs (actor_id, actor_name, actor_role, action, target_type, target_id, target_label, metadata)
    values (
      auth.uid(), v_actor.full_name, v_actor.role,
      case when NEW.locked_at is not null then 'account_locked' else 'account_unlocked' end,
      'profile', NEW.id, NEW.full_name, '{}'::jsonb
    );
  end if;

  return NEW;
exception when others then
  return NEW;
end;
$$;

drop trigger if exists trg_audit_profile_updated on profiles;
create trigger trg_audit_profile_updated
  after update on profiles
  for each row execute function log_profile_updated();

-- ------------------------------------------------------------
-- Extend migration 083's record_failed_login to log every attempt,
-- and reset_login_attempts to log a successful sign-in.
-- ------------------------------------------------------------
create or replace function record_failed_login(p_email text)
returns table(is_locked boolean, cooldown_until timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles%rowtype;
  v_attempts int;
  v_base_url text;
  v_secret text;
begin
  select * into v_profile from profiles where email = lower(trim(p_email));

  if not found then
    insert into audit_logs (action, target_type, target_label, metadata)
    values ('login_failed', 'profile', lower(trim(p_email)), jsonb_build_object('reason', 'unknown_username'));
    return query select false, null::timestamptz;
    return;
  end if;

  if v_profile.locked_at is not null then
    insert into audit_logs (action, target_type, target_id, target_label, metadata)
    values ('login_failed', 'profile', v_profile.id, v_profile.full_name, jsonb_build_object('reason', 'already_locked'));
    return query select true, null::timestamptz;
    return;
  end if;

  if v_profile.login_cooldown_until is not null and v_profile.login_cooldown_until > now() then
    insert into audit_logs (action, target_type, target_id, target_label, metadata)
    values ('login_failed', 'profile', v_profile.id, v_profile.full_name, jsonb_build_object('reason', 'in_cooldown'));
    return query select false, v_profile.login_cooldown_until;
    return;
  end if;

  v_attempts := v_profile.failed_login_attempts + 1;

  if v_attempts >= 3 then
    if v_profile.login_cooldown_rounds >= 1 then
      update profiles
        set failed_login_attempts = 0,
            login_cooldown_until = null,
            locked_at = now()
        where id = v_profile.id;

      insert into audit_logs (action, target_type, target_id, target_label, metadata)
      values ('login_failed', 'profile', v_profile.id, v_profile.full_name,
        jsonb_build_object('reason', 'wrong_password', 'attempt', v_attempts, 'result', 'locked'));
      -- 'account_locked' itself is logged by trg_audit_profile_updated above.

      begin
        select value into v_base_url from app_config where key = 'functions_base_url';
        select value into v_secret from app_config where key = 'email_webhook_secret';
        if v_base_url is not null and v_base_url <> '' and v_secret is not null and v_secret <> '' then
          perform net.http_post(
            url := v_base_url || '/notify-account-locked',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-webhook-secret', v_secret
            ),
            body := jsonb_build_object('profile_id', v_profile.id)
          );
        end if;
      exception when others then
        null;
      end;

      return query select true, null::timestamptz;
    else
      update profiles
        set failed_login_attempts = 0,
            login_cooldown_until = now() + interval '30 minutes',
            login_cooldown_rounds = 1
        where id = v_profile.id;

      insert into audit_logs (action, target_type, target_id, target_label, metadata)
      values ('login_failed', 'profile', v_profile.id, v_profile.full_name,
        jsonb_build_object('reason', 'wrong_password', 'attempt', v_attempts, 'result', 'cooldown_started'));

      return query select false, now() + interval '30 minutes';
    end if;
  else
    update profiles set failed_login_attempts = v_attempts where id = v_profile.id;

    insert into audit_logs (action, target_type, target_id, target_label, metadata)
    values ('login_failed', 'profile', v_profile.id, v_profile.full_name,
      jsonb_build_object('reason', 'wrong_password', 'attempt', v_attempts, 'result', 'none'));

    return query select false, null::timestamptz;
  end if;
end;
$$;

create or replace function reset_login_attempts(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles%rowtype;
begin
  select * into v_profile from profiles where email = lower(trim(p_email)) and locked_at is null;
  if not found then return; end if;

  update profiles
    set failed_login_attempts = 0,
        login_cooldown_until = null,
        login_cooldown_rounds = 0
    where id = v_profile.id;

  insert into audit_logs (actor_id, actor_name, actor_role, action, target_type, target_id, target_label, metadata)
  values (v_profile.id, v_profile.full_name, v_profile.role, 'login_success', 'profile', v_profile.id, v_profile.full_name, '{}'::jsonb);
end;
$$;

-- ------------------------------------------------------------
-- Generic client-callable logger, for events that don't correspond to
-- a `profiles` row change (e.g. logout).
-- ------------------------------------------------------------
create or replace function log_audit_event(
  p_action text,
  p_target_type text default null,
  p_target_id uuid default null,
  p_target_label text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in to log an audit event.';
  end if;
  select * into v_actor from profiles where id = auth.uid();

  insert into audit_logs (actor_id, actor_name, actor_role, action, target_type, target_id, target_label, metadata)
  values (auth.uid(), v_actor.full_name, v_actor.role, p_action, p_target_type, p_target_id, p_target_label, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

grant execute on function log_audit_event(text, text, uuid, text, jsonb) to authenticated;

-- ------------------------------------------------------------
-- Paged read for the Settings UI. A plain `select * from audit_logs`
-- would work under the RLS policy above too, but this keeps the
-- ordering/limit/offset/optional filters in one place.
-- ------------------------------------------------------------
create or replace function list_audit_logs(
  p_limit int default 50,
  p_offset int default 0,
  p_action text default null,
  p_search text default null
)
returns setof audit_logs
language sql
security invoker
set search_path = public
as $$
  select *
  from audit_logs
  where (p_action is null or action = p_action)
    and (
      p_search is null or p_search = '' or
      actor_name ilike '%' || p_search || '%' or
      target_label ilike '%' || p_search || '%'
    )
  order by created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

grant execute on function list_audit_logs(int, int, text, text) to authenticated;
-- security invoker (the default) means this still runs under the
-- caller's own privileges, so the audit_logs_select RLS policy above
-- is what actually restricts who gets rows back.
