-- 078: One-time backfill — creates the "Generate Evaluation form for: ..."
-- assignment for event applications (College and SHS alike) that were
-- already approved BEFORE this feature was added, so the SDAO
-- Supervisor/Assistant still gets prompted for them. No schema change:
-- reuses the existing assignments + assignment_deliverables tables, same
-- as new approvals going forward. Safe to re-run — skips events that
-- already have this assignment.

do $$
declare
  evaluator uuid;
  n_backfilled integer := 0;
begin
  select id into evaluator from profiles where role = 'sdao_supervisor' order by created_at asc limit 1;
  if evaluator is null then
    select id into evaluator from profiles where role = 'sdao_assistant' order by created_at asc limit 1;
  end if;
  -- Last-resort fallback so this never silently no-ops for lack of a
  -- Supervisor/Assistant account — any admin/staff can still pick the
  -- task up in the app (see canActOnAssignment in Assignments.jsx).
  if evaluator is null then
    select id into evaluator from profiles where role = 'system_admin' order by created_at asc limit 1;
  end if;

  if evaluator is null then
    raise notice 'No sdao_supervisor, sdao_assistant, or system_admin profile found — nothing to backfill. Create one of those accounts first, then re-run this migration.';
  else
    insert into assignments (title, description, event_id, assigned_to, assigned_by, status, auto_generated)
    select
      'Generate Evaluation form for: ' || s.title,
      'Upload the QR code image as the file deliverable, and paste the Evaluation Form link in the note field below.',
      s.event_id,
      evaluator,
      evaluator,
      'pending',
      true
    from submissions s
    where s.type = 'event_application'
      and s.stage = 'approved'
      and s.event_id is not null
      and not exists (
        select 1 from assignments a
        where a.event_id = s.event_id
          and a.title like 'Generate Evaluation form for:%'
      );
    get diagnostics n_backfilled = row_count;
    raise notice 'Backfilled % evaluation-form assignment(s), assigned to profile %.', n_backfilled, evaluator;
  end if;
end $$;
