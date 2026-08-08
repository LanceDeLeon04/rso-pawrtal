-- ============================================================
-- Migration 033 — Data Privacy Act consent log
-- ============================================================
-- Republic Act No. 10173 (Data Privacy Act of 2012) requires that
-- consent to the processing of personal data be demonstrable, not
-- just displayed once and forgotten. The app now shows a Data
-- Privacy Notice on every login (see src/pages/PrivacyNotice.jsx)
-- and records an explicit acknowledgement here each time a user
-- accepts it — this table is the accountability trail, and is
-- append-only (no update/delete) by design.

create table if not exists privacy_consents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  notice_version text not null default '2026-08-08',
  accepted_at timestamptz not null default now(),
  user_agent text
);

create index if not exists privacy_consents_profile_id_idx on privacy_consents(profile_id);

alter table privacy_consents enable row level security;

-- Users can log their own acceptance, and can read their own history
-- (e.g. to confirm they already accepted this version).
drop policy if exists privacy_consents_insert_own on privacy_consents;
create policy privacy_consents_insert_own on privacy_consents for insert
  with check (profile_id = auth.uid());

drop policy if exists privacy_consents_select_own on privacy_consents;
create policy privacy_consents_select_own on privacy_consents for select
  using (profile_id = auth.uid());

-- Admin tier can audit everyone's consent history (e.g. for an NPC
-- compliance check), but nobody — including admins — can update or
-- delete a logged acceptance. No update/delete policies are defined
-- on purpose, so those operations fall through and are denied.
drop policy if exists privacy_consents_select_admin on privacy_consents;
create policy privacy_consents_select_admin on privacy_consents for select
  using (is_admin_tier());
