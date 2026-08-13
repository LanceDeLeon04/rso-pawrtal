-- ============================================================
-- 061: Scope SDAO-SHS assignments to SHS Faculty/RSO targets only
-- ============================================================
-- 052b already added assignments_select_shs / insert_shs / update_shs /
-- delete_shs, but their scoping only checked assigned_org_id (`is null
-- or org_is_shs(...)`) — a null assigned_org_id (a user-targeted or
-- tag-targeted assignment) fell through unchecked, so SDAO-SHS could in
-- principle target a College user or a cross-department position tag.
-- The frontend (Assignments.jsx) already only offers SHS-scoped targets
-- to SDAO-SHS (no "Tagged Group" option, org picker limited to SHS
-- orgs) — this migration makes the RLS actually enforce that instead of
-- just relying on the UI.
--
-- assigned_tag is disallowed entirely for SDAO-SHS inserts (cross-org by
-- design — see EMPTY_FORM/asg-target-tabs in Assignments.jsx — there's
-- no way to scope a bare position string to one department).

create or replace function shs_assignment_target_ok(p_assigned_to uuid, p_assigned_org_id uuid) returns boolean as $$
  select
    (p_assigned_to is null and p_assigned_org_id is null)
    or (p_assigned_org_id is not null and org_is_shs(p_assigned_org_id))
    or (p_assigned_to is not null and exists (
      select 1 from profiles pr where pr.id = p_assigned_to and pr.role = 'shs_faculty'
    ))
    or (p_assigned_to is not null and exists (
      select 1 from org_memberships om
      join organizations o on o.id = om.org_id
      where om.profile_id = p_assigned_to and o.department = 'shs'
    ));
$$ language sql stable security definer;

comment on function shs_assignment_target_ok(uuid, uuid) is
  'True if an assignment target (assigned_to and/or assigned_org_id) is entirely within the SHS sub-system — an SHS Faculty profile, a profile holding any org_membership on an SHS org (covers RSO officers and Faculty-Moderators), an SHS org itself, or no target at all yet. Used to scope SDAO-SHS assignment creation (061), tightening the looser assigned_org_id-only check from 052b.';

drop policy if exists assignments_select_shs on assignments;
create policy assignments_select_shs on assignments for select
  using (is_shs_reviewer() and shs_assignment_target_ok(assigned_to, assigned_org_id));

drop policy if exists assignments_insert_shs on assignments;
create policy assignments_insert_shs on assignments for insert
  with check (
    is_shs_reviewer()
    and assigned_by = auth.uid()
    and assigned_tag is null
    and shs_assignment_target_ok(assigned_to, assigned_org_id)
  );

drop policy if exists assignments_update_shs on assignments;
create policy assignments_update_shs on assignments for update
  using (is_shs_reviewer() and shs_assignment_target_ok(assigned_to, assigned_org_id));

drop policy if exists assignments_delete_shs on assignments;
create policy assignments_delete_shs on assignments for delete
  using (is_shs_reviewer() and shs_assignment_target_ok(assigned_to, assigned_org_id));

drop policy if exists assignment_deliverables_select_shs on assignment_deliverables;
create policy assignment_deliverables_select_shs on assignment_deliverables for select
  using (
    is_shs_reviewer()
    and exists (
      select 1 from assignments a where a.id = assignment_deliverables.assignment_id
      and shs_assignment_target_ok(a.assigned_to, a.assigned_org_id)
    )
  );
