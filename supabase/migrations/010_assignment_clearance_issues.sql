-- ============================================================
-- Migration 010 — Non-event assignments can become clearance issues.
--
-- Previously `clearances` only existed for post-activity report
-- obligations (one row per org+event). Now, an assignment that is NOT
-- tied to an event (event_id is null) and goes past its due_date also
-- opens a clearance issue for the org(s) it targets — same blocking
-- effect as an unresolved report: no new event applications until it's
-- resolved.
-- ============================================================

-- event_id is no longer required — an assignment-based issue has no event.
alter table clearances alter column event_id drop not null;

-- Which non-event assignment this clearance issue came from.
alter table clearances add column assignment_id uuid references assignments(id) on delete cascade;

-- Free-text reason shown in the Clearance UI when there's no event to
-- describe the obligation (e.g. "Overdue task: Submit Officer List").
alter table clearances add column reason text;

-- Every clearance row must be about *something* — either the report
-- obligation for an event, or an overdue non-event assignment.
alter table clearances add constraint clearances_target_check
  check (event_id is not null or assignment_id is not null);

-- One clearance issue per (org, assignment) — avoids duplicate rows if
-- the reconciliation job runs more than once for the same overdue task.
create unique index clearances_org_assignment_unique
  on clearances (org_id, assignment_id) where assignment_id is not null;

create index idx_clearances_assignment on clearances(assignment_id);
