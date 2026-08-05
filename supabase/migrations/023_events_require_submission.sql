-- ============================================================
-- Migration 023 — All calendar activity must come from a submission
-- ============================================================
-- The Calendar page used to let admins/org members "Book Activity"
-- directly, inserting a row into `events` with no linked submission.
-- That UI has been removed (bookings now only ever come from an
-- approved/pencil-booked Event Application in the Submission Bin),
-- but the old RLS policy still allowed any insert with a valid
-- org_id — nothing stopped a manual insert via the API directly.
-- Tighten the insert policy so a row can only be created when it's
-- tied to a real submission belonging to that org.

drop policy if exists events_write_admin_or_owner on events;
create policy events_write_admin_or_owner on events for insert
  with check (
    submission_id is not null
    and (
      is_admin_tier()
      or org_id in (select org_id from org_memberships where profile_id = auth.uid())
    )
    and exists (
      select 1 from submissions s
      where s.id = events.submission_id and s.org_id = events.org_id
    )
  );
