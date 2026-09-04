-- ============================================================
-- 085: System-generated default passwords, admin-visible until
-- changed by the account holder
-- ============================================================
-- Previously every new/reset account got the same fixed string
-- ("password123"), which is neither system-generated nor meaningfully
-- secret. This migration doesn't change any Postgres-level password
-- rule — Supabase Auth's password itself is generated and set from
-- the create-account / reset-password Edge Functions — but it gives
-- those two functions somewhere durable to record what they generated,
-- so an admin can look it up later instead of only seeing it once in
-- the on-screen "account created" banner.
--
-- account_default_passwords holds *only* the current system-generated
-- default for an account. The moment that account's holder sets their
-- own password (AuthContext.completePasswordChange, used by both the
-- mandatory first-login gate and the optional Settings change), the
-- row is deleted — from then on nobody, including an admin, can read
-- their password back out.

create table account_default_passwords (
  profile_id uuid primary key references profiles(id) on delete cascade,
  password text not null,
  set_at timestamptz not null default now(),
  set_by uuid references profiles(id) on delete set null
);

comment on table account_default_passwords is 'Current system-generated default password for an account, if the holder has not yet changed it. Row is deleted the moment they set their own password.';

alter table account_default_passwords enable row level security;

-- Same tier allowed to call create-account / reset-password today
-- (ADMIN_ROLES ∪ SDAO-SHS ∪ SHS Principal) — see those Edge Functions.
create policy account_default_passwords_select on account_default_passwords
  for select
  using (
    exists (
      select 1 from profiles
      where id = auth.uid()
        and role in (
          'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor',
          'academic_director', 'system_admin', 'sdao_shs', 'shs_principal'
        )
    )
  );

-- A signed-in user may clear their OWN row the moment they set a real
-- password — this is the only client-writable path onto this table;
-- every insert/upsert is otherwise done by the create-account /
-- reset-password Edge Functions using the service-role key.
create policy account_default_passwords_delete_own on account_default_passwords
  for delete
  using (profile_id = auth.uid());
