-- ============================================================
-- Migration 011 — Actually create the "assignment-deliverables"
-- storage bucket.
--
-- Every earlier migration (003, 004, 005, 007) added RLS policies for
-- a bucket but left *creating* the bucket itself as a manual "do this
-- in the dashboard" step. It's easy to apply the SQL migrations and
-- forget that step, which is exactly why uploads/downloads for
-- Post-Activity Report deliverables on the Assignments page were
-- failing with:
--   {"statusCode":"404","error":"Bucket not found","message":"Bucket
--   not found","code":"NoSuchBucket"}
--
-- Buckets are just rows in storage.buckets, so we can create them
-- here instead of relying on a manual dashboard click. This is safe
-- to run even if the bucket already exists (ON CONFLICT DO NOTHING),
-- and also backfills the other buckets used across the app in case
-- any of those were skipped too.
-- ============================================================

insert into storage.buckets (id, name, public)
values
  ('assignment-deliverables', 'assignment-deliverables', false),
  ('submission-attachments', 'submission-attachments', false),
  ('templates', 'templates', true),
  ('avatars', 'avatars', true),
  ('org-logos', 'org-logos', true)
on conflict (id) do nothing;
