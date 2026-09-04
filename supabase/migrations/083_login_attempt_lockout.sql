-- ============================================================
-- 083: Password attempt cooldown + account lockout
-- ============================================================
-- Product requirement:
--   - 3 wrong password attempts  -> 30 minute cooldown on that account
--   - Another 3 wrong attempts (after the cooldown window)
--       -> account is locked for security reasons; the person is told
--          to contact their SDAO Administrator to have it reset
--   - SDAO Administrators (ADMIN_ROLES) are emailed the moment a
--     specific account locks, so they know who to expect a reset
--     request from.
--
-- Supabase Auth (auth.users / signInWithPassword) has no concept of
-- this two-stage cooldown-then-lock policy and no client-visible failed
-- attempt counter, so it's tracked here on `profiles` (keyed by the
-- same fake "<username>@pawrtal.local" address AuthContext.jsx already
-- uses to log in — see migration/comment there). The three RPCs below
-- are called from AuthContext.signIn() itself: once *before* calling
-- supabase.auth.signInWithPassword (to short-circuit an already
-- locked/cooling-down account without spending another Auth attempt),
-- and once *after* a failed/successful attempt to record the result.
-- They're security definer so an anon (not-yet-authenticated) caller
-- can invoke them by username, same trust boundary as existing
-- password-reset OTP flow (migration 069).

alter table profiles
  add column if not exists failed_login_attempts int not null default 0,
  add column if not exists login_cooldown_until timestamptz,
  add column if not exists login_cooldown_rounds int not null default 0,
  add column if not exists locked_at timestamptz,
  add column if not exists lock_notified_at timestamptz;

comment on column profiles.failed_login_attempts is 'Wrong-password streak within the current round (resets to 0 once a cooldown is applied, and on any successful login).';
comment on column profiles.login_cooldown_until is 'If set and in the future, the account cannot attempt login until this time.';
comment on column profiles.login_cooldown_rounds is 'How many 30-minute cooldowns this account has already gone through since its last successful login. A second round of 3 wrong attempts locks the account.';
comment on column profiles.locked_at is 'If set, the account is locked for security reasons and can only be restored by an SDAO Administrator (see AccountsPage reset action).';

-- ------------------------------------------------------------
-- Read-only status check, called before attempting sign-in.
-- ------------------------------------------------------------
create or replace function get_login_lock_status(p_email text)
returns table(is_locked boolean, cooldown_until timestamptz)
language sql
security definer
set search_path = public
as $$
  select
    (locked_at is not null),
    case when login_cooldown_until > now() then login_cooldown_until else null end
  from profiles
  where email = lower(trim(p_email));
$$;

grant execute on function get_login_lock_status(text) to anon, authenticated;

-- ------------------------------------------------------------
-- Records one wrong-password attempt. Returns the resulting state so
-- the client can show the right message immediately, without a
-- second round trip.
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

  -- Unknown username: nothing to record. Login.jsx already shows a
  -- generic "incorrect username or password" for this case.
  if not found then
    return query select false, null::timestamptz;
    return;
  end if;

  -- Already locked, or still inside an active cooldown: don't count
  -- this attempt further, just report the existing state back.
  if v_profile.locked_at is not null then
    return query select true, null::timestamptz;
    return;
  end if;

  if v_profile.login_cooldown_until is not null and v_profile.login_cooldown_until > now() then
    return query select false, v_profile.login_cooldown_until;
    return;
  end if;

  v_attempts := v_profile.failed_login_attempts + 1;

  if v_attempts >= 3 then
    if v_profile.login_cooldown_rounds >= 1 then
      -- Second round of 3 wrong attempts -> lock the account.
      update profiles
        set failed_login_attempts = 0,
            login_cooldown_until = null,
            locked_at = now()
        where id = v_profile.id;

      -- Fire-and-forget email to SDAO Administrators. A misconfigured
      -- or offline email pipeline must never block the lockout itself.
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
      -- First round of 3 wrong attempts -> 30 minute cooldown.
      update profiles
        set failed_login_attempts = 0,
            login_cooldown_until = now() + interval '30 minutes',
            login_cooldown_rounds = 1
        where id = v_profile.id;

      return query select false, now() + interval '30 minutes';
    end if;
  else
    update profiles set failed_login_attempts = v_attempts where id = v_profile.id;
    return query select false, null::timestamptz;
  end if;
end;
$$;

grant execute on function record_failed_login(text) to anon, authenticated;

-- ------------------------------------------------------------
-- Called on a successful sign-in to clear any attempt history. Does
-- nothing on an already-locked account (locking can only be undone by
-- an Administrator, not by the person guessing the right password on
-- a later try — see reset_account_lock below for the admin path).
-- ------------------------------------------------------------
create or replace function reset_login_attempts(p_email text)
returns void
language sql
security definer
set search_path = public
as $$
  update profiles
    set failed_login_attempts = 0,
        login_cooldown_until = null,
        login_cooldown_rounds = 0
    where email = lower(trim(p_email)) and locked_at is null;
$$;

grant execute on function reset_login_attempts(text) to anon, authenticated;

-- ------------------------------------------------------------
-- Admin-only unlock action (surfaced as a "Reset lock" button on the
-- Accounts page for ADMIN_ROLES). Clears the lock and every counter so
-- the account starts clean.
-- ------------------------------------------------------------
create or replace function reset_account_lock(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role user_role;
begin
  select role into v_caller_role from profiles where id = auth.uid();

  if v_caller_role is null or v_caller_role not in (
    'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor',
    'academic_director', 'system_admin', 'executive_director'
  ) then
    raise exception 'Only an SDAO Administrator can reset an account lock.';
  end if;

  update profiles
    set failed_login_attempts = 0,
        login_cooldown_until = null,
        login_cooldown_rounds = 0,
        locked_at = null,
        lock_notified_at = null
    where id = p_profile_id;
end;
$$;

grant execute on function reset_account_lock(uuid) to authenticated;
