-- ============================================================
-- 052: Senior High School (SHS) Sub-System
-- ============================================================
-- Introduces a parallel, department-scoped track for Senior High
-- School RSOs/organizations, sharing the College's database, venues,
-- and Calendar, but with its own Submission Bin approval chain,
-- Assignments, and Clearance queues.
--
-- DEPARTMENTS
--   organizations.department: 'college' (default, all existing rows)
--                              | 'shs'
--   Every org, submission, event, assignment and clearance inherits
--   its department from the owning organization (via org_id), so no
--   department column is duplicated onto child tables — it's always
--   resolved through a join, the same pattern org category already
--   uses.
--
-- NEW ROLES (user_role)
--   sdao_shs       — SHS counterpart of SDAO Assistant. Dashboard +
--                    Calendar + Submission Bin + Assignments +
--                    Clearance, but scoped to department = 'shs' only.
--                    (Calendar is the one exception — see below.)
--   shs_principal  — SHS Principal, an internal approval stage
--                    between SDAO Supervisor and Academic Director.
--
-- NEW EXTERNAL APPROVAL-LINK ROLES (approval_link_role)
--   org_president  — the RSO's own President signs off first
--   org_moderator  — then the org's Moderator (SHS equivalent of an
--                    Adviser)
--   (sdg_rep already exists and is reused as-is — SDGs are marked the
--   same way for SHS applications)
--
-- FULL SHS EVENT-APPLICATION CHAIN
--   Org -> President (link) -> Moderator (link) -> SDG Rep (link)
--       -> SDAO-SHS -> SDAO Supervisor -> SHS Principal
--       -> Academic Director -> Executive Director -> Approved
--   Mirrors College's Adviser -> Dean -> SDG Rep -> Assistant ->
--   Supervisor -> Director chain, just longer and with different
--   external signatories.
--
-- CROSS-DEPARTMENT VISIBILITY
--   is_admin_tier() (SDAO Assistant, CRSO Chairperson, QMO, SDAO
--   Supervisor, Academic Director, System Admin, Executive Director)
--   is left completely untouched — those roles already see every org
--   regardless of department, so they automatically see College AND
--   SHS submissions/events/assignments/clearances, tagged by
--   department in the UI. SDAO-SHS and SHS Principal are NOT added to
--   is_admin_tier() — they get their own narrower policies below,
--   added as ADDITIONAL permissive policies (Postgres OR's every
--   permissive policy together, so this never restricts anyone who
--   already had access; it only grants new, narrower access to the
--   two new roles).
-- ============================================================

-- ---------- 1. Department column ----------

alter table organizations
  add column if not exists department text not null default 'college'
  check (department in ('college', 'shs'));

create index if not exists idx_organizations_department on organizations(department);

comment on column organizations.department is
  'Which sub-system this org belongs to. Drives Submission Bin/Assignments/Clearance scoping for SDAO-SHS + SHS Principal, and the department tag shown to full admin-tier roles.';

-- ---------- 2. New roles ----------

alter type user_role add value if not exists 'sdao_shs';
alter type user_role add value if not exists 'shs_principal';

-- ---------- 3. New external approval-link roles ----------

alter type approval_link_role add value if not exists 'org_president';
alter type approval_link_role add value if not exists 'org_moderator';

-- ---------- 4. New internal submission stages ----------
-- College's assistant_review / supervisor_endorsement / director_approval
-- are untouched and keep meaning exactly what they already mean for
-- college submissions. SHS gets its own named stages so SubmissionBin's
-- college branches never accidentally fire for an SHS record, and vice
-- versa — even though SDAO Supervisor and Academic Director are the
-- same physical reviewers/roles for both departments.

alter type submission_stage add value if not exists 'shs_review';                -- SDAO-SHS check
alter type submission_stage add value if not exists 'shs_supervisor_endorsement'; -- SDAO Supervisor
alter type submission_stage add value if not exists 'shs_principal_approval';     -- SHS Principal
alter type submission_stage add value if not exists 'shs_director_approval';      -- Academic Director
alter type submission_stage add value if not exists 'shs_executive_approval';     -- Executive Director (mandatory for SHS, unlike College's bypass-only use)
