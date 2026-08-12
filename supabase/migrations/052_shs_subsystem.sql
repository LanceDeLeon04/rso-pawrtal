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

-- ---------- 5. Helper functions ----------

-- Department-scoped reviewer tier: SDAO-SHS and SHS Principal. Kept
-- deliberately separate from is_admin_tier() (see header note).
create or replace function is_shs_reviewer() returns boolean as $$
  select current_role_name() in ('sdao_shs', 'shs_principal');
$$ language sql stable security definer;

-- True if org_id belongs to an SHS organization.
create or replace function org_is_shs(p_org_id uuid) returns boolean as $$
  select coalesce((select department = 'shs' from organizations where id = p_org_id), false);
$$ language sql stable security definer;

-- ---------- 6. RLS: organizations ----------
-- organizations_select already uses (true) — every authenticated role
-- can already see every org (needed for dropdowns/venue-sharing/etc).
-- No change needed there. SDAO-SHS/SHS Principal write access is
-- limited to their own department, same shape as the existing
-- organizations_write_admin policy.

create policy organizations_write_shs on organizations for all
  using (is_shs_reviewer() and department = 'shs')
  with check (is_shs_reviewer() and department = 'shs');

-- ---------- 7. RLS: submissions & children (SHS-scoped, additive) ----------

create policy submissions_select_shs on submissions for select
  using (is_shs_reviewer() and org_is_shs(org_id));

create policy submissions_update_shs on submissions for update
  using (is_shs_reviewer() and org_is_shs(org_id));

create policy submission_attachments_select_shs on submission_attachments for select
  using (
    is_shs_reviewer()
    and exists (select 1 from submissions s where s.id = submission_attachments.submission_id and org_is_shs(s.org_id))
  );

create policy submission_status_history_select_shs on submission_status_history for select
  using (
    is_shs_reviewer()
    and exists (select 1 from submissions s where s.id = submission_status_history.submission_id and org_is_shs(s.org_id))
  );

create policy submission_status_history_insert_shs on submission_status_history for insert
  with check (is_shs_reviewer());

create policy submission_checklist_select_shs on submission_checklist_items for select
  using (
    is_shs_reviewer()
    and exists (select 1 from submissions s where s.id = submission_checklist_items.submission_id and org_is_shs(s.org_id))
  );

create policy submission_checklist_write_shs on submission_checklist_items for all
  using (
    is_shs_reviewer()
    and exists (select 1 from submissions s where s.id = submission_checklist_items.submission_id and org_is_shs(s.org_id))
  )
  with check (
    is_shs_reviewer()
    and exists (select 1 from submissions s where s.id = submission_checklist_items.submission_id and org_is_shs(s.org_id))
  );

create policy submission_comments_select_shs on submission_comments for select
  using (
    is_shs_reviewer()
    and exists (select 1 from submissions s where s.id = submission_comments.submission_id and org_is_shs(s.org_id))
  );

create policy submission_comments_write_shs on submission_comments for insert
  with check (
    is_shs_reviewer()
    and exists (select 1 from submissions s where s.id = submission_comments.submission_id and org_is_shs(s.org_id))
  );

-- ---------- 8. RLS: approval_links (SHS-scoped, additive) ----------

create policy approval_links_select_shs on approval_links for select
  using (
    is_shs_reviewer()
    and exists (select 1 from submissions s where s.id = approval_links.submission_id and org_is_shs(s.org_id))
  );

create policy approval_links_write_shs on approval_links for all
  using (
    is_shs_reviewer()
    and exists (select 1 from submissions s where s.id = approval_links.submission_id and org_is_shs(s.org_id))
  )
  with check (
    is_shs_reviewer()
    and exists (select 1 from submissions s where s.id = approval_links.submission_id and org_is_shs(s.org_id))
  );

-- ---------- 9. RLS: events ----------
-- No new policy needed. events_select_all is already (true) — SDAO-SHS
-- (and every other role) already sees ALL events, both departments,
-- for venue streamlining, exactly as requested. events_write_admin_or_owner
-- / events_update_admin_or_owner already allow org-member writes, which
-- covers SHS org accounts writing their own bookings. SDAO-SHS reviewer
-- write access (e.g. rescheduling on behalf of an SHS org) is granted here:

create policy events_update_shs on events for update
  using (is_shs_reviewer() and org_is_shs(org_id));

-- ---------- 10. RLS: assignments (SHS-scoped, additive) ----------

create policy assignments_select_shs on assignments for select
  using (
    is_shs_reviewer()
    and (
      assigned_org_id is null or org_is_shs(assigned_org_id)
    )
  );

create policy assignments_insert_shs on assignments for insert
  with check (is_shs_reviewer() and (assigned_org_id is null or org_is_shs(assigned_org_id)));

create policy assignments_update_shs on assignments for update
  using (is_shs_reviewer() and (assigned_org_id is null or org_is_shs(assigned_org_id)));

create policy assignments_delete_shs on assignments for delete
  using (is_shs_reviewer() and (assigned_org_id is null or org_is_shs(assigned_org_id)));

create policy assignment_deliverables_select_shs on assignment_deliverables for select
  using (
    is_shs_reviewer()
    and exists (
      select 1 from assignments a where a.id = assignment_deliverables.assignment_id
      and (a.assigned_org_id is null or org_is_shs(a.assigned_org_id))
    )
  );

-- ---------- 11. RLS: clearances (SHS-scoped, additive) ----------

create policy clearances_select_shs on clearances for select
  using (is_shs_reviewer() and org_is_shs(org_id));

create policy clearances_insert_shs on clearances for insert
  with check (is_shs_reviewer() and org_is_shs(org_id));

create policy clearances_update_shs on clearances for update
  using (is_shs_reviewer() and org_is_shs(org_id));

create policy clearances_delete_shs on clearances for delete
  using (is_shs_reviewer() and org_is_shs(org_id));

-- ---------- 12. Accounts page visibility ----------
-- SDAO-SHS/SHS Principal are admin-panel-adjacent roles, so they need
-- to be creatable from Accounts (client-side role list — see
-- Accounts.jsx) and to see the org_memberships of SHS orgs.

create policy org_memberships_write_shs on org_memberships for all
  using (is_shs_reviewer() and org_is_shs(org_id))
  with check (is_shs_reviewer() and org_is_shs(org_id));

-- ---------- 13. generate_approval_link: allow the 2 new roles ----------
-- No function change needed — generate_approval_link already accepts
-- any approval_link_role value and only special-cases 'dean' (a
-- College-only rule that correctly never fires for 'org_president' /
-- 'org_moderator').

-- ---------- 14. get_approval_link / submit_approval_decision: SHS chain ----------
-- IMPORTANT: these two functions were already re-declared several
-- times (migrations 025, 038, 041, 044, 046) to add COL support,
-- marketing_rep, multi-venue fields, and the generic `prior_chain_complete`
-- flag. The version below is built on top of 046's (the latest), NOT
-- the original 019 version — extending it in place so every earlier
-- fix (COL bypass, marketing_rep gate, sdg_selections, multi-venue
-- venue_names) keeps working for College, while SHS's President ->
-- Moderator -> SDG Rep chain is added alongside it. submit_approval_decision
-- keeps its existing 5-arg signature (token, decision, comment,
-- signature, sdgs) so the single public /approve/:token page needs no
-- frontend change to support SHS links.

create or replace function get_approval_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link approval_links;
  v_submission submissions;
  v_org organizations;
  v_adviser approval_links;
  v_dean approval_links;
  v_president approval_links;
  v_moderator approval_links;
  v_needs_dean boolean;
  v_is_col boolean;
  v_is_shs boolean;
  v_prior_complete boolean;
begin
  select * into v_link from approval_links where token = p_token;
  if v_link is null then
    return jsonb_build_object('error', 'invalid');
  end if;

  if v_link.status = 'pending' and v_link.expires_at < now() then
    update approval_links set status = 'expired' where id = v_link.id;
    v_link.status := 'expired';
  end if;

  select * into v_submission from submissions where id = v_link.submission_id;
  select * into v_org from organizations where id = v_submission.org_id;

  v_is_shs := v_org.department = 'shs';
  v_is_col := (not v_is_shs) and coalesce(v_org.category, '') = 'COL';
  v_needs_dean := (not v_is_col) and (not v_is_shs) and coalesce(v_org.category, '') in ('School Council', 'Academic');

  if v_is_shs then
    -- SHS chain: President -> Moderator -> SDG Rep. No adviser/dean/COL
    -- branching at all.
    if v_link.role = 'org_moderator' then
      select * into v_president from approval_links
        where submission_id = v_link.submission_id and role = 'org_president';
      v_prior_complete := coalesce(v_president.status = 'approved', false);
    elsif v_link.role = 'sdg_rep' then
      select * into v_president from approval_links
        where submission_id = v_link.submission_id and role = 'org_president';
      select * into v_moderator from approval_links
        where submission_id = v_link.submission_id and role = 'org_moderator';
      v_prior_complete := coalesce(v_president.status = 'approved', false)
        and coalesce(v_moderator.status = 'approved', false);
    else
      v_prior_complete := true;
    end if;
  else
    -- last-role links (sdg_rep for events, marketing_rep for merch) look
    -- up the adviser/dean links only for non-COL orgs, which are the
    -- only orgs that ever have them.
    if v_link.role = 'dean' or (v_link.role in ('sdg_rep', 'marketing_rep') and not v_is_col) then
      select * into v_adviser from approval_links
        where submission_id = v_link.submission_id and role = 'adviser';
    end if;
    if v_link.role in ('sdg_rep', 'marketing_rep') and v_needs_dean then
      select * into v_dean from approval_links
        where submission_id = v_link.submission_id and role = 'dean';
    end if;

    if v_link.role = 'dean' then
      v_prior_complete := v_adviser.status = 'approved';
    elsif v_link.role in ('sdg_rep', 'marketing_rep') then
      if v_is_col then
        v_prior_complete := true;
      else
        v_prior_complete := coalesce(v_adviser.status = 'approved', false)
          and (not v_needs_dean or coalesce(v_dean.status = 'approved', false));
      end if;
    else
      v_prior_complete := true;
    end if;
  end if;

  return jsonb_build_object(
    'link', jsonb_build_object(
      'role', v_link.role,
      'status', v_link.status,
      'person_name', v_link.person_name,
      'expires_at', v_link.expires_at,
      'decided_at', v_link.decided_at,
      'comment', v_link.comment,
      'sdg_selections', v_link.sdg_selections
    ),
    'submission', jsonb_build_object(
      'id', v_submission.id,
      'title', v_submission.title,
      'contact_person', v_submission.contact_person,
      'contact_number', v_submission.contact_number,
      'event_date', v_submission.event_date,
      'start_time', v_submission.start_time,
      'end_time', v_submission.end_time,
      'medium', v_submission.medium,
      'venue', (select name from venues where id = v_submission.venue_id),
      'venue_names', (
        select coalesce(jsonb_agg(name order by name), '[]'::jsonb)
        from venues where id = any(coalesce(v_submission.venue_ids, array[]::uuid[]))
      ),
      'venue_detail', v_submission.venue_detail,
      'venue_details', v_submission.venue_details,
      'online_platform', v_submission.online_platform,
      'description', v_submission.description,
      'activity_type', v_submission.activity_type,
      'target_audience', v_submission.target_audience,
      'target_participants', v_submission.target_participants,
      'projected_budget', v_submission.projected_budget,
      'budget_source', v_submission.budget_source,
      'is_continuing', v_submission.is_continuing,
      'continuing_type', v_submission.continuing_type,
      'term_label', v_submission.term_label,
      'stage', v_submission.stage,
      'sdgs', v_submission.sdgs,
      'type', v_submission.type,
      'merchandise_types', v_submission.merchandise_types,
      'merchandise_duration', v_submission.merchandise_duration
    ),
    'organization', jsonb_build_object(
      'name', v_org.name, 'acronym', v_org.acronym, 'category', v_org.category,
      'department', v_org.department
    ),
    'attachments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'document_type', document_type, 'file_url', file_url
      ) order by uploaded_at), '[]'::jsonb)
      from submission_attachments where submission_id = v_submission.id
    ),
    'adviser_status', case when v_link.role = 'dean'
      then coalesce(v_adviser.status::text, 'not_generated') else null end,
    'president_status', case when v_link.role = 'org_moderator'
      then coalesce(v_president.status::text, 'not_generated') else null end,
    'prior_chain_complete', case when v_link.role in ('dean', 'sdg_rep', 'marketing_rep', 'org_moderator')
      then v_prior_complete else null end,
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'author', author, 'body', body, 'created_at', created_at
      ) order by created_at), '[]'::jsonb)
      from approval_link_messages where approval_link_id = v_link.id
    )
  );
end;
$$;

grant execute on function get_approval_link(text) to anon, authenticated;

create or replace function submit_approval_decision(
  p_token text,
  p_decision approval_link_status,
  p_comment text default null,
  p_signature text default null,
  p_sdgs text[] default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link approval_links;
  v_submission submissions;
  v_org organizations;
  v_adviser approval_links;
  v_dean approval_links;
  v_president approval_links;
  v_moderator approval_links;
  v_needs_dean boolean;
  v_is_col boolean;
  v_is_shs boolean;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision';
  end if;

  select * into v_link from approval_links where token = p_token;
  if v_link is null then
    raise exception 'Invalid link';
  end if;
  if v_link.status <> 'pending' then
    raise exception 'This link has already been used';
  end if;
  if v_link.expires_at < now() then
    update approval_links set status = 'expired' where id = v_link.id;
    raise exception 'This link has expired';
  end if;
  if p_decision = 'approved' and trim(coalesce(p_signature, '')) = '' then
    raise exception 'A signature is required to approve';
  end if;
  if p_decision = 'approved' and v_link.role = 'sdg_rep' and coalesce(array_length(p_sdgs, 1), 0) = 0 then
    raise exception 'Please mark at least one SDG before approving';
  end if;

  select * into v_submission from submissions where id = v_link.submission_id;
  select * into v_org from organizations where id = v_submission.org_id;
  v_is_shs := v_org.department = 'shs';
  v_is_col := (not v_is_shs) and coalesce(v_org.category, '') = 'COL';
  v_needs_dean := (not v_is_col) and (not v_is_shs) and coalesce(v_org.category, '') in ('School Council', 'Academic');

  if v_is_shs then
    if v_link.role = 'org_moderator' then
      select * into v_president from approval_links
        where submission_id = v_link.submission_id and role = 'org_president';
      if v_president is null or v_president.status <> 'approved' then
        raise exception 'The President has not approved this application yet';
      end if;
    elsif v_link.role = 'sdg_rep' then
      select * into v_president from approval_links
        where submission_id = v_link.submission_id and role = 'org_president';
      select * into v_moderator from approval_links
        where submission_id = v_link.submission_id and role = 'org_moderator';
      if v_president is null or v_president.status <> 'approved' then
        raise exception 'The President has not approved this application yet';
      end if;
      if v_moderator is null or v_moderator.status <> 'approved' then
        raise exception 'The Moderator has not approved this application yet';
      end if;
    end if;
  else
    if v_link.role = 'dean' then
      select * into v_adviser from approval_links
        where submission_id = v_link.submission_id and role = 'adviser';
      if v_adviser is null or v_adviser.status <> 'approved' then
        raise exception 'The Adviser has not approved this application yet';
      end if;
    end if;

    if v_link.role in ('sdg_rep', 'marketing_rep') and not v_is_col then
      select * into v_adviser from approval_links
        where submission_id = v_link.submission_id and role = 'adviser';
      if v_adviser is null or v_adviser.status <> 'approved' then
        raise exception 'The Adviser has not approved this application yet';
      end if;
      if v_needs_dean then
        select * into v_dean from approval_links
          where submission_id = v_link.submission_id and role = 'dean';
        if v_dean is null or v_dean.status <> 'approved' then
          raise exception 'The Dean has not approved this application yet';
        end if;
      end if;
    end if;
    -- COL orgs: sdg_rep / marketing_rep is the first (only) link in the
    -- chain, nothing to gate on.
  end if;

  update approval_links set
    status = p_decision,
    comment = p_comment,
    signature_data = p_signature,
    sdg_selections = case when v_link.role = 'sdg_rep' then p_sdgs else sdg_selections end,
    decided_at = now()
  where id = v_link.id;

  insert into submission_status_history (submission_id, stage, action, actor_name, comment)
  values (
    v_link.submission_id,
    v_submission.stage,
    p_decision::text,
    v_link.person_name || ' (' || case v_link.role
      when 'sdg_rep' then 'SDG Representative'
      when 'marketing_rep' then 'Marketing'
      when 'org_president' then 'President'
      when 'org_moderator' then 'Moderator'
      else initcap(v_link.role::text) end || ')',
    p_comment
  );

  if p_decision = 'rejected' then
    update submissions set stage = 'rejected', updated_at = now() where id = v_link.submission_id;
  elsif v_is_shs then
    if v_link.role = 'sdg_rep' then
      -- Last link of the SHS external chain: hand off to SDAO-SHS.
      update submissions set
        sdgs = coalesce(p_sdgs, '{}'),
        sdg_representative = v_link.person_name,
        sdg_marked_at = now(),
        sdg_marked_acp_generated = false,
        stage = 'shs_review',
        updated_at = now()
      where id = v_link.submission_id;
    end if;
    -- org_president / org_moderator approving just unlocks the next
    -- external link; stage stays 'submitted' until the SDG Rep signs off.
  else
    if v_link.role = 'sdg_rep' then
      update submissions set
        sdgs = coalesce(p_sdgs, '{}'),
        sdg_representative = v_link.person_name,
        sdg_marked_at = now(),
        sdg_marked_acp_generated = false,
        -- COL has no SDAO Assistant stage: go straight to the
        -- SDAO Supervisor. RSO orgs behave as before.
        stage = case when v_is_col then 'supervisor_endorsement'::submission_stage else 'assistant_review'::submission_stage end,
        updated_at = now()
      where id = v_link.submission_id;
    elsif v_link.role = 'marketing_rep' then
      update submissions set
        marketing_representative = v_link.person_name,
        marketing_reviewed_at = now(),
        stage = case when v_is_col then 'supervisor_endorsement'::submission_stage else 'assistant_review'::submission_stage end,
        updated_at = now()
      where id = v_link.submission_id;
    else
      -- Adviser (and Dean, if required) approving now hands off to the
      -- next external reviewer rather than straight to assistant_review.
      null;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision);
end;
$$;

grant execute on function submit_approval_decision(text, approval_link_status, text, text, text[]) to anon, authenticated;

-- ---------- 15. Exam scheduling: SHS vs College ----------
-- Holidays are university-wide and shown to everyone as-is (department
-- stays null). Exam periods differ between College and SHS (different
-- academic calendars sharing the same venues), so exam_period rows get
-- tagged by department; each Calendar only shows its own department's
-- exam weeks, while holidays keep showing for everyone, and full
-- admin-tier roles see both, tagged.

alter table restricted_periods
  add column if not exists department text
  check (department in ('college', 'shs'));

comment on column restricted_periods.department is
  'Only meaningful for kind = exam_period (College vs SHS have different exam calendars sharing the same venues). NULL for holidays, which are university-wide.';

alter table restricted_periods
  add constraint restricted_periods_exam_needs_department
  check (kind <> 'exam_period' or department is not null) not valid;
-- NOT VALID so it doesn't choke on any pre-existing exam_period rows —
-- backfill them with a department (e.g. 'college', since that's the
-- only department that has existed until now) then run:
--   alter table restricted_periods validate constraint restricted_periods_exam_needs_department;

-- SDAO-SHS can schedule/remove its own exam periods only (never
-- holidays, and never College's exam periods).
create policy restricted_periods_write_shs on restricted_periods for insert
  with check (is_shs_reviewer() and kind = 'exam_period' and department = 'shs');

create policy restricted_periods_update_shs on restricted_periods for update
  using (is_shs_reviewer() and kind = 'exam_period' and department = 'shs');

create policy restricted_periods_delete_shs on restricted_periods for delete
  using (is_shs_reviewer() and kind = 'exam_period' and department = 'shs');

-- ---------- 16. Seed: two example SHS organizations ----------
-- Comment out or edit before running in production if you'd rather
-- create SHS orgs by hand from Accounts.

-- insert into organizations (name, acronym, category, department, accreditation_status)
-- values
--   ('Supreme Student Government - SHS', 'SSG-SHS', 'School Council', 'shs', 'accredited'),
--   ('Sample SHS Organization', 'SAMPLE-SHS', 'Special Interest', 'shs', 'pending');
