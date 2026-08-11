-- ============================================================
-- 048: Let an org cancel its own submission before it's approved
-- ============================================================
-- Previously the only way out of the approval chain was for a
-- reviewer to return/reject it, or for an admin to delete it outright.
-- Orgs can now withdraw their own Event Application / Merchandise
-- Proposal themselves, as long as the Academic Director hasn't
-- approved it yet (stage isn't already 'approved', and it isn't
-- already 'rejected' or 'cancelled').
--
-- Mirrors the existing submissions_resubmit_owner pattern: `using`
-- gates which existing rows the org may touch, `with check` pins what
-- the row is allowed to become.

alter type submission_stage add value if not exists 'cancelled';

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
