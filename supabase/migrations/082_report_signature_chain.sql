-- ============================================================
-- 082: Post-Activity Report signature chain (PARF/Liquidation/Narrative)
-- ============================================================
-- Extends the existing external "magic link" infrastructure
-- (approval_links, migration 019/072 — already used for Adviser/Dean/
-- SDG Rep/Marketing on event applications) to the report-submission
-- flow, so no new link/token table is needed. Reports use the same
-- `approval_links` table, keyed to the report `submissions` row.
--
-- Sign-off order for a submitted report:
--   1. Treasurer  \
--   2. Auditor     } "officers" — Auditor cannot sign until Treasurer
--   3. Secretary  /   has. Secretary is independent of the Finance
--                     pair (Narrative Report is her own document) and
--                     can sign any time, in parallel with 1+2.
--   4. Adviser        — only once ALL THREE officers above have signed.
--   5. Dean            — only once Adviser has signed. PIN-gated.
-- None of the officer roles (Treasurer/Auditor/Secretary) use a PIN —
-- Adviser/Dean reuse the same optional PIN roster as the event-application
-- chain (external_approvers / get_external_approver_pin(), migration 072).
--
-- Once the Dean signs, the report is fully externally signed and is
-- ready for SDAO Assistant to mark "Received" -> SDAO Supervisor to
-- Review -> File (submissions.stage 'submitted' -> 'sdao_supervisor_review'
-- -> 'approved'), at which point the existing report-approval branch in
-- SubmissionBin.jsx clears the clearance and marks assignments done.

alter type approval_link_role add value if not exists 'treasurer';
alter type approval_link_role add value if not exists 'auditor';
alter type approval_link_role add value if not exists 'secretary';

alter type submission_stage add value if not exists 'sdao_supervisor_review'; -- SDAO Supervisor final review of a signed report, before filing

-- Ordered chain, purely for reference/documentation — enforcement lives
-- in submit_report_decision below (mirrors lib/reportApprovals.js on
-- the client, which drives the UI's locked/unlocked step display).
comment on type approval_link_role is
  'adviser/dean/sdg_rep/marketing_rep = event-application chain roles; treasurer/auditor/secretary = report officer signers (see migration 082)';

-- ------------------------------------------------------------
-- get_report_approval(token)
-- Public (anon) entry point for the report-signing review page.
-- Returns the report's identifying info, the specific attachment(s)
-- relevant to that role (Treasurer/Auditor -> Liquidation Report;
-- Secretary -> Narrative Report; Adviser/Dean -> the PARF plus both),
-- whether this role's turn has actually arrived yet, and whether a
-- PIN is required.
-- ------------------------------------------------------------
create or replace function get_report_approval(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link approval_links;
  v_submission submissions;
  v_event events;
  v_org organizations;
  v_treasurer approval_links;
  v_auditor approval_links;
  v_secretary approval_links;
  v_adviser approval_links;
  v_unlocked boolean;
  v_pin text;
begin
  select * into v_link from approval_links where token = p_token;
  if v_link is null or v_link.role not in ('treasurer', 'auditor', 'secretary', 'adviser', 'dean') then
    return jsonb_build_object('error', 'invalid');
  end if;

  select * into v_submission from submissions where id = v_link.submission_id;
  if v_submission is null or v_submission.type <> 'report' then
    return jsonb_build_object('error', 'invalid');
  end if;

  if v_link.status = 'pending' and v_link.expires_at < now() then
    update approval_links set status = 'expired' where id = v_link.id;
    v_link.status := 'expired';
  end if;

  select * into v_event from events where id = v_submission.event_id;
  select * into v_org from organizations where id = v_submission.org_id;

  select * into v_treasurer from approval_links where submission_id = v_link.submission_id and role = 'treasurer';
  select * into v_auditor from approval_links where submission_id = v_link.submission_id and role = 'auditor';
  select * into v_secretary from approval_links where submission_id = v_link.submission_id and role = 'secretary';
  select * into v_adviser from approval_links where submission_id = v_link.submission_id and role = 'adviser';

  v_unlocked := case v_link.role
    when 'treasurer' then true
    when 'secretary' then true -- independent of the Finance pair
    when 'auditor' then coalesce(v_treasurer.status, 'pending') = 'approved'
    when 'adviser' then coalesce(v_treasurer.status, 'pending') = 'approved'
      and coalesce(v_auditor.status, 'pending') = 'approved'
      and coalesce(v_secretary.status, 'pending') = 'approved'
    when 'dean' then coalesce(v_adviser.status, 'pending') = 'approved'
    else false
  end;

  if v_link.role in ('adviser', 'dean') then
    v_pin := get_external_approver_pin(v_link.role, v_org.id, v_link.person_name);
  end if;

  return jsonb_build_object(
    'link', jsonb_build_object(
      'role', v_link.role, 'status', v_link.status, 'person_name', v_link.person_name,
      'expires_at', v_link.expires_at, 'decided_at', v_link.decided_at, 'comment', v_link.comment,
      'unlocked', v_unlocked,
      'pin_required', v_pin is not null
    ),
    'report', jsonb_build_object(
      'title', v_submission.title,
      'org_name', v_org.name,
      'event_title', v_event.title,
      'event_date', v_event.event_date
    ),
    'attachments', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'document_type', document_type, 'file_url', file_url) order by uploaded_at), '[]'::jsonb)
      from submission_attachments
      where submission_id = v_link.submission_id
        and document_type = any(case v_link.role
          when 'treasurer' then array['Liquidation Report', 'PARF Template']
          when 'auditor' then array['Liquidation Report', 'PARF Template']
          when 'secretary' then array['Narrative Report', 'PARF Template']
          else array['PARF Template', 'Liquidation Report', 'Narrative Report', 'Evaluation Report']
        end)
    ),
    'officers', jsonb_build_object(
      'treasurer', coalesce(v_treasurer.status::text, 'not_generated'),
      'auditor', coalesce(v_auditor.status::text, 'not_generated'),
      'secretary', coalesce(v_secretary.status::text, 'not_generated'),
      'adviser', coalesce(v_adviser.status::text, 'not_generated')
    )
  );
end;
$$;

grant execute on function get_report_approval(text) to anon, authenticated;

-- ------------------------------------------------------------
-- submit_report_decision(token, decision, comment, signature, pin)
-- Same shape as submit_curricular_decision (081) / submit_approval_decision
-- (019/072), but with report-specific ordering rules re-checked
-- server-side (never trust the 'unlocked' flag the client already saw).
-- ------------------------------------------------------------
create or replace function submit_report_decision(
  p_token text,
  p_decision approval_link_status,
  p_comment text default null,
  p_signature text default null,
  p_pin text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link approval_links;
  v_submission submissions;
  v_org organizations;
  v_treasurer approval_links;
  v_auditor approval_links;
  v_secretary approval_links;
  v_adviser approval_links;
  v_required_pin text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision';
  end if;

  select * into v_link from approval_links where token = p_token;
  if v_link is null or v_link.role not in ('treasurer', 'auditor', 'secretary', 'adviser', 'dean') then
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
    raise exception 'A signature is required to sign';
  end if;

  select * into v_submission from submissions where id = v_link.submission_id;
  if v_submission is null or v_submission.type <> 'report' then
    raise exception 'Invalid report';
  end if;
  select * into v_org from organizations where id = v_submission.org_id;

  select * into v_treasurer from approval_links where submission_id = v_link.submission_id and role = 'treasurer';
  select * into v_auditor from approval_links where submission_id = v_link.submission_id and role = 'auditor';
  select * into v_secretary from approval_links where submission_id = v_link.submission_id and role = 'secretary';
  select * into v_adviser from approval_links where submission_id = v_link.submission_id and role = 'adviser';

  if v_link.role = 'auditor' and coalesce(v_treasurer.status, 'pending') <> 'approved' then
    raise exception 'The Treasurer/Finance officer must sign before the Auditor.';
  end if;
  if v_link.role = 'adviser' and (
    coalesce(v_treasurer.status, 'pending') <> 'approved'
    or coalesce(v_auditor.status, 'pending') <> 'approved'
    or coalesce(v_secretary.status, 'pending') <> 'approved'
  ) then
    raise exception 'All officers (Treasurer, Auditor, Secretary) must sign before the Adviser.';
  end if;
  if v_link.role = 'dean' and coalesce(v_adviser.status, 'pending') <> 'approved' then
    raise exception 'The Adviser must sign before the Dean.';
  end if;

  if v_link.role in ('adviser', 'dean') then
    v_required_pin := get_external_approver_pin(v_link.role, v_org.id, v_link.person_name);
    if v_required_pin is not null and coalesce(p_pin, '') <> v_required_pin then
      raise exception 'Incorrect security PIN.';
    end if;
  end if;

  update approval_links set
    status = p_decision, comment = p_comment, signature_data = p_signature, decided_at = now()
  where id = v_link.id;

  insert into submission_status_history (submission_id, stage, action, actor_id, actor_name, comment)
  values (v_link.submission_id, v_submission.stage, p_decision::text, null, v_link.person_name || ' (' || v_link.role::text || ')', p_comment);

  if p_decision = 'rejected' then
    update submissions set stage = 'returned', updated_at = now() where id = v_link.submission_id;
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision);
end;
$$;

grant execute on function submit_report_decision(text, approval_link_status, text, text, text) to anon, authenticated;
