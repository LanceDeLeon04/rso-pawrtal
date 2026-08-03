-- ============================================================
-- 013: "Returned" calendar booking state + admin delete support
-- ============================================================
-- Calendar behavior:
--   * submitted / under review  -> events.booking_status = 'pencil'
--   * approved                  -> events.booking_status = 'reserved'
--   * rejected                  -> the events row is deleted (calendar
--                                   cleared); a fresh 'pencil' row is
--                                   created only if/when re-submitted
--   * returned                  -> events.booking_status = 'returned'
--                                   (shown grayed-out — still pencil
--                                   booked, but kicked back for fixes)
alter type booking_status add value if not exists 'returned';

-- ---------- Admin delete policies ----------
-- Events and submissions previously had no delete policy at all, so
-- admins couldn't remove a bad booking or a mistaken application/report.
create policy events_delete_admin on events for delete
  using (is_admin_tier());

create policy submissions_delete_admin on submissions for delete
  using (is_admin_tier());

create policy assignments_delete_admin on assignments for delete
  using (is_admin_tier());

create policy clearances_delete_admin on clearances for delete
  using (is_admin_tier());

-- organizations_write_admin ("for all") already covers delete, and
-- profiles are removed through the delete-account edge function — no
-- new policy needed for either.

-- ---------- Cascades so org/event deletes don't get blocked by FKs ----------
alter table events drop constraint if exists events_org_id_fkey;
alter table events add constraint events_org_id_fkey
  foreign key (org_id) references organizations(id) on delete cascade;

alter table submissions drop constraint if exists submissions_org_id_fkey;
alter table submissions add constraint submissions_org_id_fkey
  foreign key (org_id) references organizations(id) on delete cascade;

alter table clearances drop constraint if exists clearances_org_id_fkey;
alter table clearances add constraint clearances_org_id_fkey
  foreign key (org_id) references organizations(id) on delete cascade;

alter table clearances drop constraint if exists clearances_event_id_fkey;
alter table clearances add constraint clearances_event_id_fkey
  foreign key (event_id) references events(id) on delete cascade;

alter table clearances drop constraint if exists clearances_report_submission_id_fkey;
alter table clearances add constraint clearances_report_submission_id_fkey
  foreign key (report_submission_id) references submissions(id) on delete set null;

alter table assignments drop constraint if exists assignments_assigned_org_id_fkey;
alter table assignments add constraint assignments_assigned_org_id_fkey
  foreign key (assigned_org_id) references organizations(id) on delete set null;
