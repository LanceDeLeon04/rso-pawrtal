-- ============================================================
-- Migration 006 — Accounts + several RLS gaps found while building it.
-- Run this if you already applied schema.sql + earlier migrations.
-- (If setting up fresh, just run schema.sql — it already includes this.)
-- ============================================================

-- Needed so admins can assign RSO officers to an org + position from
-- Accounts (this doubles as the cross-org tagging mechanism, e.g. "all
-- Treasurers" = every org_membership row with position = 'Treasurer').
create policy org_memberships_write_admin on org_memberships for all
  using (is_admin_tier())
  with check (is_admin_tier());

-- ---------- CRITICAL BUGFIX ----------
-- organizations had RLS enabled with NO policy at all — every org
-- dropdown across Calendar, Submission Bin, Assignments, and the
-- Dashboard's active-org count has been silently returning zero rows for
-- every role, admins included, since organizations select was never
-- explicitly granted.
create policy organizations_select on organizations for select using (true);

create policy organizations_write_admin on organizations for all
  using (is_admin_tier())
  with check (is_admin_tier());

-- ---------- SECURITY GAP ----------
-- venues, admin_viewer_scopes, and profile_tags never had RLS enabled at
-- all, meaning they were wide open — any authenticated user could
-- insert/update/delete rows in them, not just read.
alter table venues enable row level security;
alter table admin_viewer_scopes enable row level security;
alter table profile_tags enable row level security;

create policy venues_select on venues for select using (true);
create policy venues_write_admin on venues for all
  using (is_admin_tier())
  with check (is_admin_tier());

create policy admin_viewer_scopes_select on admin_viewer_scopes for select
  using (profile_id = auth.uid() or is_admin_tier());
create policy admin_viewer_scopes_write_admin on admin_viewer_scopes for all
  using (is_admin_tier())
  with check (is_admin_tier());

create policy profile_tags_select on profile_tags for select
  using (profile_id = auth.uid() or is_admin_tier());
create policy profile_tags_write_admin on profile_tags for all
  using (is_admin_tier())
  with check (is_admin_tier());
