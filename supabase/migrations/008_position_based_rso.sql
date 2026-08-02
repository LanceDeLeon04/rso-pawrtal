-- ============================================================
-- Migration 008 — Position-based RSO accounts
-- RSO logins belong to a position (e.g. "SCS-SC President"), not to a
-- specific person. The create-account Edge Function already enforces
-- "one account per org+position" at write time; this adds the same
-- guarantee at the database level so it holds even for writes that
-- don't go through the function.
-- ============================================================

alter table org_memberships
  add constraint org_memberships_org_position_unique unique (org_id, position);
