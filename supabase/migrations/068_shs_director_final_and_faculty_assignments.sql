-- ============================================================
-- 068 — SHS chain ends at Academic Director (no more Executive
-- Director stop), and SDAO-SHS can assign tasks straight to SHS
-- Faculty.
-- ============================================================
-- Part A: the routing that used to send an SHS event application from
-- shs_director_approval -> shs_executive_approval -> approved now only
-- lives in the frontend (SubmissionBin.jsx's nextActionFor). This part
-- fixes up the DATA side: any submission currently parked at the
-- legacy shs_executive_approval stage is auto-forwarded to 'approved',
-- since Academic Director's sign-off is now considered final and
-- there's no reviewer role left whose "turn" that stage represents.
-- Safe/idempotent to re-run — it only touches rows still sitting in
-- that exact stage.

update submissions
set stage = 'approved', updated_at = now()
where stage = 'shs_executive_approval';
-- (No submission_status_history row is inserted for this system-level
-- flip since there's no real actor to attribute it to — the stage
-- change and updated_at bump are sufficient audit trail.)

-- Part B: SDAO-SHS assigning tasks to SHS Faculty.
-- shs_assignment_target_ok() (061) already allows assigned_to to be a
-- profile with role = 'shs_faculty'. This re-affirms that + the
-- policies that depend on it, and re-affirms profiles_select (059) so
-- SDAO-SHS can actually see Faculty profiles to pick from — both were
-- correct in their original migrations, this just guarantees they're
-- actually applied together as one unit, since "add assignments to
-- Faculty" failing usually means one of these two didn't make it into
-- the live database.

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

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (
    id = auth.uid()
    or is_admin_tier()
    or (
      current_role_name() in ('sdao_shs', 'shs_principal')
      and (
        role = 'shs_faculty'
        or id in (
          select om.profile_id
          from org_memberships om
          join organizations o on o.id = om.org_id
          where o.department = 'shs'
        )
      )
    )
  );
