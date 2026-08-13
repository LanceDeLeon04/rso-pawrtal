-- ============================================================
-- 059: Let SDAO-SHS / SHS Principal read SHS-scoped profiles
-- ============================================================
-- profiles_select (schema.sql) only checked is_admin_tier(), same gap
-- as org_bank_details_select (migration 058) — never extended to the
-- SHS reviewer roles from 052a/052b. Accounts.jsx's shsFacultyProfiles
-- and shsProfiles filters run client-side on whatever profiles RLS
-- actually returns, so SDAO-SHS/SHS Principal silently got zero rows
-- back for Faculty accounts and SHS org officer accounts — no error,
-- the list was just empty.
--
-- Scoped, not blanket admin: SHS reviewers can see 'shs_faculty'
-- profiles and profiles holding an org_membership in an SHS-department
-- organization, but not every profile in the system.

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
