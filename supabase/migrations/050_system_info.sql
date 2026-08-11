-- 050_system_info.sql
--
-- "About the System" page: a public-within-the-portal (any authenticated
-- role) info page describing what RSO PAWrtal is and does, crediting the
-- developer, and listing the system administrators with photos. Content
-- is editable only by 'system_admin', same pattern as org-logos/avatars.

-- ============================================================
-- system_info — singleton row (id always 1)
-- ============================================================
create table if not exists system_info (
  id int primary key default 1,
  description text not null default '',
  functions jsonb not null default '[]'::jsonb,
  developer_name text not null default '',
  developer_title text not null default '',
  developer_note text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  constraint system_info_singleton check (id = 1)
);

insert into system_info (id, description, functions, developer_name, developer_title, developer_note)
values (
  1,
  'RSO PAWrtal is the digital home for NU Laguna''s Recognized Student '
  || 'Organizations — one portal that carries an activity from proposal to '
  || 'approval to post-event clearance, replacing the scattered paperwork '
  || 'and email threads that used to stand between a good idea and a '
  || 'successful event.',
  '[
    "Activity Clearance Proposal (ACP) and Financial Request Form (FRF) submission, review, and e-signing",
    "Multi-step approval routing across advisers, deans, SDAO, QMO, and other reviewers, with external approval links for off-portal signers",
    "Calendar of Activities with venue booking, conflict checks, and FMO venue blocking",
    "QR-code event verification for approved, printed forms",
    "Task assignments and deliverable tracking between SDAO and RSOs",
    "Post-event clearance and requirement reconciliation",
    "Organization accounts, membership, and accreditation status management",
    "Real-time analytics dashboard across submissions, events, and organizations",
    "Automatic email notifications on every status change",
    "Reusable form templates maintained by SDAO"
  ]'::jsonb,
  'Lance Win Alexandrei B. De Leon',
  'President & CEO, NexGov Technologies',
  'RSO PAWrtal is a passion project — built to give NU Laguna''s student '
  || 'organizations a system as organized and driven as the students who '
  || 'run them.'
)
on conflict (id) do nothing;

alter table system_info enable row level security;

create policy system_info_select on system_info
  for select using (auth.role() = 'authenticated');

create policy system_info_update on system_info
  for update using (current_role_name() = 'system_admin')
  with check (current_role_name() = 'system_admin');

-- ============================================================
-- system_administrators — the people listed on the About page
-- ============================================================
create table if not exists system_administrators (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  title text not null,
  photo_url text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into system_administrators (full_name, title, sort_order) values
  ('Engr. Elcy C. Lacambra', 'Executive/Administration Director', 10),
  ('Neilson A. Silva, Ed.D', 'Academic Director', 20),
  ('Aira Leigh Dela Cruz', 'System Consultant', 30),
  ('Marco Paulo Burgos', 'System Consultant', 40),
  ('Richmond Dela Vina', 'SDAO Supervisor', 50),
  ('Fatima Robles', 'SDAO Coordinator', 60),
  ('Karen Grace Mote', 'SDAO Assistant', 70),
  ('Gil Mallen, Jr', 'QMO Supervisor', 80);

alter table system_administrators enable row level security;

create policy system_administrators_select on system_administrators
  for select using (auth.role() = 'authenticated');

create policy system_administrators_write on system_administrators
  for all using (current_role_name() = 'system_admin')
  with check (current_role_name() = 'system_admin');

-- ============================================================
-- STORAGE — system-admins bucket, for administrator photos
-- Public read (renders for every role on the About page); writes
-- restricted to system_admin, same pattern as org-logos/avatars.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('system-admins', 'system-admins', true)
on conflict (id) do nothing;

create policy system_admins_storage_read on storage.objects
  for select using (bucket_id = 'system-admins');

create policy system_admins_storage_write on storage.objects
  for insert with check (bucket_id = 'system-admins' and current_role_name() = 'system_admin');

create policy system_admins_storage_update on storage.objects
  for update using (bucket_id = 'system-admins' and current_role_name() = 'system_admin');

create policy system_admins_storage_delete on storage.objects
  for delete using (bucket_id = 'system-admins' and current_role_name() = 'system_admin');
