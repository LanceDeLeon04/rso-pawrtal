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
begin
  select id into evaluator from profiles where role = 'sdao_supervisor' order by created_at asc limit 1;
  if evaluator is null then
    select id into evaluator from profiles where role = 'sdao_assistant' order by created_at asc limit 1;
  end if;

  if evaluator is not null then
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
  end if;
end $$;
