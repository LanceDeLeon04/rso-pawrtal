-- ============================================================
-- Migration 003 — Templates
-- Run this if you already applied schema.sql + migration 002.
-- (If setting up fresh, just run schema.sql — it already includes this.)
-- ============================================================

-- Create the bucket from the Supabase dashboard first:
-- Storage -> New bucket -> name it exactly "templates" (public is fine,
-- since every logged-in role is allowed to download these).

create policy templates_storage_read on storage.objects
  for select using (bucket_id = 'templates');

create policy templates_storage_write on storage.objects
  for all using (bucket_id = 'templates' and is_admin_tier())
  with check (bucket_id = 'templates' and is_admin_tier());
