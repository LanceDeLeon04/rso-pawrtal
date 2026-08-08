-- ============================================================
-- Migration 034 — Self-serve clearance reconciliation for overdue
-- non-event assignments
-- ============================================================
-- Bug: a non-event assignment (a task with no linked event, e.g.
-- "Submit Officer List") is only supposed to block new Event
-- Applications once it's overdue — but the `clearances` row that
-- actually implements that block was only ever created client-side
-- in Assignments.jsx's reconcileClearanceIssues(), which is gated to
-- admin-tier and only runs when an admin happens to open the
-- Assignments page. There's no server cron. In practice this meant
-- an org's overdue task could sit unblocked indefinitely — the
-- Submission Bin's "New Application" button stayed clickable — until
-- an admin coincidentally visited Assignments after the deadline.
--
-- Fix: let an org insert its own overdue-assignment clearance row,
-- but ONLY when it strictly, verifiably reflects a real overdue
-- assignment that targets that org (directly, via a member, or via
-- a position tag) — never an arbitrary clearance row. This is safe
-- to self-serve because it only ever adds a restriction on the
-- inserting org itself, never removes one or affects another org.

drop policy if exists clearances_insert_admin on clearances;

create policy clearances_insert on clearances for insert
  with check (
    is_admin_tier()
    or (
      -- Caller must belong to the org they're filing the clearance
      -- issue against.
      org_id in (select org_id from org_memberships where profile_id = auth.uid())
      and status = 'overdue'
      and assignment_id is not null
      and event_id is null
      and exists (
        select 1 from assignments a
        where a.id = assignment_id
          and a.event_id is null
          and a.due_date is not null
          and a.due_date < current_date
          and a.status in ('pending', 'returned', 'conditional_approved')
          and (
            a.assigned_org_id = clearances.org_id
            or a.assigned_to in (select profile_id from org_memberships where org_id = clearances.org_id)
            or a.assigned_tag in (select position from org_memberships where org_id = clearances.org_id)
          )
      )
    )
  );
