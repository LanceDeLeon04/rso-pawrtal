-- ============================================================
-- 032: Carry venue_detail (specific room/lab) onto events
-- ============================================================
-- submissions.venue_detail already records which Building/Floor/Room or
-- which Laboratory was picked on the event application (see migration
-- 009 + 031), but that detail was never copied onto the `events` row
-- that actually drives the Calendar. This meant the Calendar's venue
-- filter and "Move Schedule" venue picker could only ever work at the
-- venue level (e.g. "Room" in general) and could not tell one room or
-- lab apart from another.
--
-- This adds the same free-text venue_detail column to events, so it
-- can be set when a submission materializes into an event, and edited
-- directly from the Calendar's Move Schedule form.

alter table events
  add column venue_detail text;
