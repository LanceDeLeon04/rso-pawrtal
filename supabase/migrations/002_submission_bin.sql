-- ============================================================
-- Migration 002 — Submission Bin
-- Run this if you already applied the original schema.sql.
-- (If you're setting up fresh, just run schema.sql — it already
-- includes everything below.)
-- ============================================================

create type activity_medium as enum ('f2f', 'online', 'off_campus');

alter table submissions
  add column contact_number text,
  add column venue_id uuid references venues(id),
  add column event_date date,
  add column start_time time,
  add column end_time time,
  add column medium activity_medium,
  add column description text;

alter table events
  add column medium activity_medium;

-- Fix: the clearance gate previously blocked ALL submissions for an org
-- with an open clearance — including the report that would clear it.
drop policy if exists submissions_insert on submissions;
create policy submissions_insert on submissions for insert
  with check (
    org_id in (select org_id from org_memberships where profile_id = auth.uid())
    and (
      type = 'report'
      or not exists (
        select 1 from clearances
        where org_id = submissions.org_id and status in ('pending', 'overdue')
      )
    )
  );

drop policy if exists events_update_admin_or_owner on events;
create policy events_update_admin_or_owner on events for update
  using (
    is_admin_tier()
    or org_id in (select org_id from org_memberships where profile_id = auth.uid())
  );

drop policy if exists submissions_update_admin on submissions;
create policy submissions_update_admin on submissions for update
  using (is_admin_tier());

drop policy if exists submission_attachments_select on submission_attachments;
create policy submission_attachments_select on submission_attachments for select
  using (
    is_admin_tier()
    or exists (
      select 1 from submissions s
      join org_memberships m on m.org_id = s.org_id and m.profile_id = auth.uid()
      where s.id = submission_attachments.submission_id
    )
  );

drop policy if exists submission_attachments_insert on submission_attachments;
create policy submission_attachments_insert on submission_attachments for insert
  with check (
    is_admin_tier()
    or exists (
      select 1 from submissions s
      join org_memberships m on m.org_id = s.org_id and m.profile_id = auth.uid()
      where s.id = submission_attachments.submission_id
    )
  );

drop policy if exists submission_status_history_select on submission_status_history;
create policy submission_status_history_select on submission_status_history for select
  using (
    is_admin_tier()
    or exists (
      select 1 from submissions s
      join org_memberships m on m.org_id = s.org_id and m.profile_id = auth.uid()
      where s.id = submission_status_history.submission_id
    )
  );

drop policy if exists submission_status_history_insert on submission_status_history;
create policy submission_status_history_insert on submission_status_history for insert
  with check (is_admin_tier());

drop policy if exists clearances_insert_admin on clearances;
create policy clearances_insert_admin on clearances for insert
  with check (is_admin_tier());

-- Storage bucket for submission attachments (ACP Form, Attachments
-- Template, PARF, Liquidation/Narrative/Evaluation Reports).
-- Create the bucket itself from the Supabase dashboard: Storage -> New
-- bucket -> name it "submission-attachments" (private). Then run this:

create policy submission_attachments_storage_read on storage.objects
  for select using (bucket_id = 'submission-attachments' and auth.role() = 'authenticated');

create policy submission_attachments_storage_write on storage.objects
  for insert with check (bucket_id = 'submission-attachments' and auth.role() = 'authenticated');
