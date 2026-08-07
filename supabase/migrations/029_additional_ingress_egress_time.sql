-- ============================================================
-- Migration 029 — Additional ingress/egress time request
-- Every booking auto-gets a 2-hour ingress buffer before its start and
-- a 2-hour egress buffer after its end, but the venue itself can only
-- be entered from 6:00 AM and must be cleared by 9:00 PM. Applicants
-- can request additional ingress/egress time beyond that (e.g. arriving
-- before the normal buffer, or staying later) — if the requested time
-- falls outside 6:00 AM–9:00 PM, a Security Office letter is required.
-- ============================================================

alter table submissions
  add column additional_ingress_time time,
  add column additional_egress_time time;

alter table events
  add column additional_ingress_time time,
  add column additional_egress_time time;
