-- ============================================================
-- 053: Separate Templates by department (College vs SHS)
-- ============================================================
-- Templates previously had no department at all — one shared list for
-- everyone. SDAO-SHS and SHS Principal need their own SHS-only set of
-- templates (upload/replace/delete), while College admins keep the
-- existing College set. SDAO Supervisor and SDAO Assistant (and every
-- other full admin-tier role) need to see BOTH, tagged, via a tab in
-- the UI — see Templates.jsx.
--
-- Existing rows (uploaded before this migration) are College's, since
-- SHS didn't exist as a concept for Templates until now.
-- ============================================================

alter table templates
  add column if not exists department text not null default 'college'
  check (department in ('college', 'shs'));

comment on column templates.department is
  'Which sub-system this template belongs to. SDAO-SHS/SHS Principal are scoped to shs only (see templates_write_shs); full admin-tier roles (is_admin_tier()) can still see + manage both, tagged in the UI by a College/SHS tab.';

create index if not exists idx_templates_department on templates(department);

-- templates_select already uses (true) — everyone can already see every
-- template regardless of department; Templates.jsx does the filtering
-- for department-scoped roles. No change needed there.

-- templates_write (is_admin_tier()) already covers full admins for
-- BOTH departments — untouched, so nothing here restricts them.

-- SDAO-SHS / SHS Principal get their own narrower, additive policy,
-- scoped to department = 'shs' only, mirroring is_shs_reviewer() used
-- everywhere else in the SHS sub-system (migration 052b).
create policy templates_write_shs on templates for all
  using (is_shs_reviewer() and department = 'shs')
  with check (is_shs_reviewer() and department = 'shs');

-- Storage: SDAO-SHS/SHS Principal need to be able to upload/replace/
-- delete objects in the shared "templates" bucket too. The existing
-- templates_storage_write policy only allows is_admin_tier(); this adds
-- an additive policy for the SHS reviewer tier, matching the pattern of
-- the DB-level policy above (no path/department distinction is
-- enforced in storage itself — Templates.jsx always writes SHS uploads
-- under `${category}/...` with the `department` set correctly on the
-- `templates` row, which is what actually gates visibility/editing).
create policy templates_storage_write_shs on storage.objects
  for all using (bucket_id = 'templates' and is_shs_reviewer())
  with check (bucket_id = 'templates' and is_shs_reviewer());
