-- Migration 069: Gmail-based password reset via OTP.
--
-- Adds a `recovery_email` column on profiles (the person's own Gmail,
-- distinct from `profiles.email`/auth.users.email which is the fake
-- "<username>@pawrtal.local" address used only for Supabase Auth login —
-- see AuthContext.jsx). This is the address OTPs get sent to.
--
-- Also adds `password_reset_otps`, a short-lived table of hashed OTP
-- codes used by the send-password-reset-otp / verify-password-reset-otp
-- Edge Functions (service-role only — no client-facing RLS policy is
-- granted on this table beyond `select`, which nobody needs directly).

alter table profiles
  add column if not exists recovery_email text;

-- Loose format check — kept permissive (any real address works, not
-- only @gmail.com) since some staff may prefer a work Google Workspace
-- address. UI language nudges toward Gmail; this constraint just guards
-- against garbage input.
alter table profiles
  add constraint profiles_recovery_email_format
  check (recovery_email is null or recovery_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

create table if not exists password_reset_otps (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_otps_profile on password_reset_otps(profile_id);

alter table password_reset_otps enable row level security;

-- No self/anon access at all — this table is only ever touched by the
-- Edge Functions below using the service-role key, which bypasses RLS.
-- Explicitly enabling RLS with no policies means even a leaked anon/user
-- JWT can't read or write OTP hashes.

-- Housekeeping: let a cron/manual call clear stale rows. Not scheduled
-- automatically here since this project has no pg_cron migration yet;
-- safe to run periodically via the SQL editor or a scheduled function.
create or replace function purge_expired_password_reset_otps()
returns void
language sql
security definer
set search_path = public
as $$
  delete from password_reset_otps where expires_at < now() - interval '1 day';
$$;
