-- ============================================================
-- Migration 030 — Night-before ingress request
-- For high-setup venues (Auditorium, Multi-Sports Center, Hoops Center,
-- Driveway, Football Pitch, LRC) applicants may request to start
-- ingress the night before the actual event date, 7:00 PM–9:00 PM,
-- as long as no other booking occupies that venue during that window.
-- This is a plain yes/no flag — the window itself is fixed
-- (7:00 PM–9:00 PM the day before), so no time value is stored.
-- ============================================================

alter table submissions
  add column night_before_ingress boolean not null default false;

alter table events
  add column night_before_ingress boolean not null default false;
