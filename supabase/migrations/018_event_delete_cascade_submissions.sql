-- ============================================================
-- 018: Cascade event deletes through submissions
-- ============================================================
-- submissions.event_id had no ON DELETE action (default RESTRICT),
-- so deleting an events row from the Calendar (or anywhere else)
-- would fail with a foreign-key violation whenever a submission
-- still referenced that event — leaving the stale booking stuck on
-- the calendar with no way to remove it.
--
-- An events row IS the calendar booking for its submission, so if the
-- booking is deleted the application/report tied to it should go too
-- (matches the existing rejected-application behavior in Submission
-- Bin, which already deletes the events row and its submission
-- together). This keeps Calendar, Submission Bin, Assignments and
-- Clearance fully interconnected: deleting an event anywhere cascades
-- everywhere, instead of leaving orphaned rows other pages still show.
alter table submissions drop constraint if exists submissions_event_id_fkey;
alter table submissions add constraint submissions_event_id_fkey
  foreign key (event_id) references events(id) on delete cascade;
