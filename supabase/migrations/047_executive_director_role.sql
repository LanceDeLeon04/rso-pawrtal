-- ============================================================
-- 047: Executive Director role
-- ============================================================
-- Executive Director is a top-tier "personal account" role (default
-- account: Engr. Elcy C. Lacambra / username eclacambra), created the
-- same way as FMO — via Accounts -> "Create Account for Administrators"
-- -> Role: Executive Director. Do NOT insert it directly into
-- auth.users (see supabase/seed_fmo_account.sql for why).
--
-- Access (enforced client-side in Layout.jsx / App.jsx):
--   - Dashboard   -> full org-wide analytics (added to ADMIN_ROLES /
--                    is_admin_tier(), same tier as Director/QMO)
--   - Calendar    -> full access, same as any admin-tier role
--   - Submission Bin -> can approve ANY submission from ANY stage,
--                    bypassing SDAO Assistant / Supervisor / Academic
--                    Director entirely (see nextActionFor() in
--                    SubmissionBin.jsx). Requires a mandatory
--                    justification comment, shows a warning banner in
--                    the UI, and is logged to submission_status_history
--                    with action 'approved (Executive Director bypass)'.
--   - Excluded from: Templates, Clearance, Assignments, Accounts.
--
-- is_admin_tier() already gates submissions_update_admin (the policy
-- that lets `stage` advance) and submissions_select's cross-org
-- visibility, events/clearances access, etc. — so adding this role to
-- is_admin_tier() below is what makes the bypass-approve write and the
-- full-analytics reads possible at the database level.

alter type user_role add value if not exists 'executive_director';

create or replace function is_admin_tier() returns boolean as $$
  select current_role_name() in (
    'sdao_assistant','crso_chairperson','qmo',
    'sdao_supervisor','academic_director','system_admin',
    'executive_director'
  );
$$ language sql stable security definer;
