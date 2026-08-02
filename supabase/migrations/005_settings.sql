-- ============================================================
-- Migration 005 — Settings
-- Run this if you already applied schema.sql + earlier migrations.
-- (If setting up fresh, just run schema.sql — it already includes this.)
-- ============================================================

-- Needed so admins can edit any user's display name from Settings.
create policy profiles_update_admin on profiles for update
  using (is_admin_tier());

-- Create the bucket from the Supabase dashboard first:
-- Storage -> New bucket -> name it exactly "avatars" (public is fine —
-- these render in the topbar for everyone).
create policy avatars_storage_read on storage.objects
  for select using (bucket_id = 'avatars');

create policy avatars_storage_write on storage.objects
  for insert with check (bucket_id = 'avatars' and auth.role() = 'authenticated');

create policy avatars_storage_update on storage.objects
  for update using (bucket_id = 'avatars' and auth.role() = 'authenticated');
