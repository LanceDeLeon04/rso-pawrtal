-- ============================================================
-- 036: clearance gate now keys off the EVENT DATE, not status
-- ============================================================
--
-- Previously the insert-policy clearance gate only blocked a new Event
-- Application when the org had a clearance row already flipped to
-- 'overdue' (i.e. its 7-day post-activity report deadline had passed).
-- That let an org start a brand-new application in the gap between an
-- event happening and its report deadline arriving — e.g. event on
-- Aug 8, report not due until Aug 15, but the gate didn't kick in until
-- Aug 15 even though the org clearly still owed a report for an event
-- that had already happened.
--
-- New rule: the gate blocks as soon as the EVENT DATE of an open
-- ('pending' or 'overdue') clearance has passed — i.e. blocked starting
-- the day AFTER the event, regardless of the report deadline. The org
-- stays clear all the way through the day of the event itself.
--
-- Assignment-based clearance issues (event_id is null — an overdue
-- non-event task) have no event date to key off, so those keep gating
-- purely on status = 'overdue', same as before.
drop policy if exists submissions_insert on submissions;

create policy submissions_insert on submissions for insert
  with check (
    org_id in (select org_id from org_memberships where profile_id = auth.uid())
    and (
      -- clearance gate only blocks new event applications, never the
      -- report submission that would resolve the clearance itself
      type = 'report'
      or not exists (
        select 1 from clearances c
        left join events e on e.id = c.event_id
        where c.org_id = submissions.org_id
          and c.status in ('pending', 'overdue', 'extended')
          and (
            (c.event_id is not null and e.event_date < current_date)
            or (c.event_id is null and c.status = 'overdue')
          )
      )
    )
  );
