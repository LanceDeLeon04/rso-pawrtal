-- ============================================================
-- Migration 022 — Allow deleting submission_attachments rows
-- ============================================================
-- Bug: on approval, SubmissionBin.jsx deletes the pre-approval
-- "ACP Form" attachment row before inserting the QR-stamped
-- replacement, so only one ACP shows up. But there was never a
-- DELETE policy on submission_attachments, so RLS silently
-- blocked the delete (0 rows affected, no error thrown) — both
-- the old and new ACP ended up attached. Same gap existed on the
-- storage.objects side, so the old PDF file was never removed
-- from the bucket either.

drop policy if exists submission_attachments_delete on submission_attachments;
create policy submission_attachments_delete on submission_attachments for delete
  using (is_admin_tier());

drop policy if exists submission_attachments_storage_delete on storage.objects;
create policy submission_attachments_storage_delete on storage.objects
  for delete using (bucket_id = 'submission-attachments' and is_admin_tier());
