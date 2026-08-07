-- ============================================================
-- 026: Facilities Management Office (FMO) role
-- ============================================================
-- FMO is a limited account tier — access is restricted to just the
-- Dashboard and Calendar of Activities (enforced client-side in
-- Layout.jsx / App.jsx). Unlike admin-tier roles, FMO cannot review
-- submissions, manage clearance, or create accounts.
--
-- FMO's calendar powers:
--   1. Block dates on the calendar for specific venues (venue_blocks)
--   2. Move (reschedule) existing bookings — date, time, and/or venue
--      — directly on the calendar (events table update)

alter type user_role add value if not exists 'fmo';
