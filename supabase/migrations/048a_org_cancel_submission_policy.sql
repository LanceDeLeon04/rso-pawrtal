-- ============================================================
-- 048a: RLS policy for org self-cancel (needs 048's enum value
-- committed first — see the note in 048_org_cancel_submission.sql)
-- ============================================================
-- Mirrors the existing submissions_resubmit_owner pattern: `using`
-- gates which existing rows the org may touch, `with check` pins what
-- the row is allowed to become.

create policy submissions_cancel_owner on submissions for update
  using (
    type in ('event_application', 'merchandise')
    and stage not in ('approved', 'rejected', 'cancelled')
    and org_id in (select org_id from org_memberships where profile_id = auth.uid())
  )
  with check (
    stage = 'cancelled'
    and org_id in (select org_id from org_memberships where profile_id = auth.uid())
  );
