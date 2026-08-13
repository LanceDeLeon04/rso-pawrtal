-- ============================================================
-- 058: Let SDAO-SHS / SHS Principal read organization_bank_details
-- ============================================================
-- org_bank_details_select (migration 035) only checked is_admin_tier(),
-- which covers the original 6 admin roles but was never extended to
-- the SHS reviewer roles added in 052a/052b. SDAO-SHS/SHS Principal
-- load the Accounts page (same as admin-tier) and hit a 403 fetching
-- organization_bank_details for the org list. Same class of gap as the
-- executive_director/sdao_shs omissions already noted in create-account.
--
-- Write-side (org_bank_details_write) is left untouched — SHS
-- reviewers can see bank details but still can't edit them, same as
-- before.

drop policy if exists org_bank_details_select on organization_bank_details;
create policy org_bank_details_select on organization_bank_details for select
  using (
    is_admin_tier()
    or current_role_name() in ('sdao_shs', 'shs_principal')
    or org_id in (select org_id from org_memberships where profile_id = auth.uid())
  );
