-- 051_developer_photo.sql
--
-- Allows the "Developed By" credit on the About page to carry a photo,
-- same upload pattern as the system_administrators cards. Reuses the
-- existing public 'system-admins' storage bucket (already scoped to
-- system_admin-only writes) under a dedicated "developer/" prefix.

alter table system_info
  add column if not exists developer_photo_url text;
