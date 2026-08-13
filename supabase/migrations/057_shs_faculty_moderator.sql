-- ============================================================
-- 057: SHS Faculty-Moderator accounts
-- ============================================================
-- Product decision: an SHS org's Moderator account is no longer created
-- from the "Create RSO Account" form (Moderator is removed from that
-- position dropdown for SHS orgs — see Accounts.jsx). Instead it's
-- created from "Create SHS Faculty Account", via a checkbox ("Is this
-- faculty member also a Moderator?") + an SHS org dropdown. Moderators
-- remain RSO officers under the hood — the created account's role
-- stays 'rso_officer' with a normal org_memberships row
-- (position = 'Moderator', same as before), NOT a new 'shs_faculty'
-- row. What changes is just the account-creation UX (personal
-- username, like Faculty, instead of an org+position-derived one) and
-- that the resulting account ALSO gets Faculty's Venue Request access
-- layered on top of its ordinary RSO Officer functionality (Submission
-- Bin, Templates, etc. — those already work for any 'rso_officer' with
-- an org_membership, no change needed there).
--
-- Client-side this combined identity is computed from the profile
-- (role = 'rso_officer' + a Moderator org_membership on an org whose
-- department = 'shs' — see isSHSFacultyModerator() in AuthContext.jsx)
-- rather than a new role value, so the same check is mirrored here at
-- the RLS/function level as is_shs_faculty_moderator().
-- ============================================================

create or replace function is_shs_faculty_moderator() returns boolean as $$
  select exists (
    select 1
    from org_memberships m
    join organizations o on o.id = m.org_id
    where m.profile_id = auth.uid()
      and m.position = 'Moderator'
      and o.department = 'shs'
  ) and current_role_name() = 'rso_officer';
$$ language sql stable security definer;

comment on function is_shs_faculty_moderator() is
  'True for an rso_officer profile that holds the Moderator position on an SHS org — created via Create SHS Faculty Account with the "Also a Moderator?" checkbox (migration 057), not via Create RSO Account. Grants Venue Request access (Faculty -> SDAO-SHS -> SHS Principal) on top of ordinary RSO Officer access.';

-- ---------- shs_venue_requests: let a Faculty-Moderator submit/see/cancel their own ----------

drop policy if exists shs_venue_requests_select_faculty_approved on shs_venue_requests;
create policy shs_venue_requests_select_faculty_approved
  on shs_venue_requests for select
  using ((current_role_name() = 'shs_faculty' or is_shs_faculty_moderator()) and status = 'approved');

drop policy if exists shs_venue_requests_insert_own on shs_venue_requests;
create policy shs_venue_requests_insert_own
  on shs_venue_requests for insert
  with check (
    (current_role_name() = 'shs_faculty' or is_shs_faculty_moderator())
    and requester_id = auth.uid()
    and status = 'pending_sdao_shs'
  );

-- cancel_shs_venue_request: Faculty-Moderator can withdraw their own
-- request the same way a pure Faculty account can.
create or replace function cancel_shs_venue_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_role text := current_role_name();
  v_req shs_venue_requests%rowtype;
begin
  select * into v_req from shs_venue_requests where id = p_request_id for update;
  if v_req is null then
    raise exception 'Venue request not found';
  end if;

  if v_role = 'shs_faculty' or (v_role = 'rso_officer' and is_shs_faculty_moderator()) then
    if v_req.requester_id <> auth.uid() then
      raise exception 'You can only cancel your own venue requests';
    end if;
  elsif v_role not in ('sdao_shs', 'shs_principal') then
    raise exception 'Not permitted';
  end if;

  if v_req.status in ('rejected', 'cancelled') then
    raise exception 'This request is already closed';
  end if;

  update shs_venue_requests set status = 'cancelled', updated_at = now() where id = p_request_id;
  return jsonb_build_object('ok', true);
end;
$$;
