-- ============================================================
-- Migration 007 — Organization profile fields
-- Adds logo, accreditation status, and contact details to
-- organizations. Run after 006_accounts.sql.
-- ============================================================

create type accreditation_status as enum ('accredited', 'probationary', 'pending');

alter table organizations
  add column logo_url text,
  add column accreditation_status accreditation_status not null default 'pending',
  add column contact_email text,
  add column contact_number text;

-- Create the bucket from the Supabase dashboard first:
-- Storage -> New bucket -> name it exactly "org-logos" (public is fine —
-- logos render in Accounts and org-facing pages for everyone).
create policy org_logos_storage_read on storage.objects
  for select using (bucket_id = 'org-logos');

create policy org_logos_storage_write on storage.objects
  for insert with check (bucket_id = 'org-logos' and is_admin_tier());

create policy org_logos_storage_update on storage.objects
  for update using (bucket_id = 'org-logos' and is_admin_tier());
