-- ============================================================
-- RSO PAWrtal — Supabase Schema
-- NU Laguna SDAO — RSO Management Portal
-- ============================================================

-- ---------- ENUMS ----------
create type user_role as enum (
  'rso_officer',
  'sdao_assistant',
  'crso_chairperson',
  'qmo',
  'sdao_supervisor',
  'academic_director',
  'system_admin'
);

create type booking_status as enum ('pencil', 'reserved', 'cancelled');

create type submission_type as enum ('event_application', 'report');

create type submission_stage as enum (
  'draft',
  'submitted',          -- with RSO officer -> sent
  'assistant_review',   -- SDAO Assistant checking
  'supervisor_endorsement', -- SDAO Supervisor endorsing
  'director_approval',  -- Academic Director approving
  'approved',
  'returned',           -- kicked back for revision
  'rejected'
);

create type clearance_status as enum ('pending', 'cleared', 'overdue', 'extended');

create type activity_medium as enum ('f2f', 'online', 'off_campus');

-- ---------- ORGANIZATIONS ----------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  acronym text not null unique,
  category text, -- e.g. Academic, Special Interest, Fraternal
  adviser_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- PROFILES (extends auth.users) ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role user_role not null,
  photo_url text,
  must_change_password boolean not null default true,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Admin viewer-scope: which admin roles can see which slices.
-- e.g. CRSO Chairperson -> viewer on events; QMO -> viewer on calendar only.
create table admin_viewer_scopes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  scope text not null, -- 'events' | 'calendar' | 'submissions' | 'clearance' | 'all'
  unique (profile_id, scope)
);

-- ---------- ORG MEMBERSHIP + CROSS-ORG TAGGING ----------
-- An RSO officer belongs to an org with a position (President, Treasurer, etc).
-- Position doubles as the cross-org tag: "all Treasurers across all orgs"
-- is just `select * from org_memberships where position = 'Treasurer'`.
create table org_memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  position text not null, -- e.g. 'President', 'Treasurer', 'Secretary'
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  unique (profile_id, org_id, position)
);

create index idx_org_memberships_position on org_memberships(position);
create index idx_org_memberships_org on org_memberships(org_id);

-- Free-form additional tags beyond position (optional escape hatch),
-- e.g. "New Officer", "Batch 2026", used for filtering/broadcast.
create table profile_tags (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  tag text not null,
  unique (profile_id, tag)
);

-- ---------- VENUES ----------
create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  location text,
  capacity int,
  is_active boolean not null default true
);

-- ---------- EVENTS / CALENDAR ----------
create table events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  org_id uuid not null references organizations(id),
  contact_person text not null,
  contact_number text,
  description text,
  venue_id uuid references venues(id),
  event_date date not null,
  start_time time,
  end_time time,
  medium activity_medium,
  booking_status booking_status not null default 'pencil',
  submission_id uuid, -- linked once formal application is submitted
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create index idx_events_date on events(event_date);
create index idx_events_venue on events(venue_id);
create index idx_events_org on events(org_id);

-- ---------- TEMPLATES ----------
create table templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,               -- e.g. 'ACP Form', 'PARF Template', 'Liquidation Report'
  category text not null,           -- 'event_application' | 'report'
  file_url text not null,
  version text,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

-- ---------- SUBMISSIONS (Submission Bin) ----------
create table submissions (
  id uuid primary key default gen_random_uuid(),
  type submission_type not null,
  org_id uuid not null references organizations(id),
  event_id uuid references events(id), -- required for event_application; reports link to the event they close out
  title text not null,
  contact_person text,
  contact_number text,
  -- Event-application specifics (filled when type = 'event_application';
  -- this is what materializes into a real `events` row once approved).
  venue_id uuid references venues(id),
  event_date date,
  start_time time,
  end_time time,
  medium activity_medium,
  description text,
  stage submission_stage not null default 'submitted',
  submitted_by uuid not null references profiles(id),
  submitted_at timestamptz not null default now(),
  due_date date, -- admin-extendable deadline (used for reports/clearance)
  updated_at timestamptz not null default now()
);

create index idx_submissions_org on submissions(org_id);
create index idx_submissions_stage on submissions(stage);

create table submission_attachments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  document_type text not null, -- 'ACP Form','Attachments Template','PARF Template','Liquidation Report','Narrative Report','Evaluation Report'
  file_url text not null,
  uploaded_at timestamptz not null default now()
);

-- Full audit trail of the approval chain: Assistant check -> Supervisor endorse -> Director approve
create table submission_status_history (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  stage submission_stage not null,
  action text not null, -- 'checked','endorsed','approved','returned','rejected','deadline_extended'
  actor_id uuid not null references profiles(id),
  comment text,
  created_at timestamptz not null default now()
);

-- ---------- ASSIGNMENTS ----------
-- Admins assign specific submissions to specific reviewers (mirrors the
-- assignment-based access pattern from the SCS Evaluation System).
create table assignments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  assigned_to uuid not null references profiles(id),
  assigned_by uuid not null references profiles(id),
  due_date date,
  status text not null default 'pending', -- 'pending','in_progress','done'
  created_at timestamptz not null default now()
);

-- ---------- CLEARANCE ----------
-- One row per (org, event): report obligations after an event.
-- No clearance -> org is blocked from submitting new event applications.
create table clearances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  event_id uuid not null references events(id),
  status clearance_status not null default 'pending',
  report_submission_id uuid references submissions(id),
  deadline date not null,
  extended_deadline date,
  cleared_by uuid references profiles(id),
  cleared_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, event_id)
);

create index idx_clearances_org_status on clearances(org_id, status);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table profiles enable row level security;
alter table organizations enable row level security;
alter table org_memberships enable row level security;
alter table events enable row level security;
alter table submissions enable row level security;
alter table submission_attachments enable row level security;
alter table submission_status_history enable row level security;
alter table clearances enable row level security;
alter table assignments enable row level security;
alter table templates enable row level security;

-- Helper: current user's role
create or replace function current_role_name() returns user_role as $$
  select role from profiles where id = auth.uid();
$$ language sql stable security definer;

create or replace function is_admin_tier() returns boolean as $$
  select current_role_name() in (
    'sdao_assistant','crso_chairperson','qmo',
    'sdao_supervisor','academic_director','system_admin'
  );
$$ language sql stable security definer;

-- Everyone can read their own profile; admins can read all.
create policy profiles_select on profiles for select
  using (id = auth.uid() or is_admin_tier());

create policy profiles_update_self on profiles for update
  using (id = auth.uid());

-- Only admin-tier + system_admin can insert new accounts (per spec: only
-- admins/superadmin create accounts).
create policy profiles_insert_admin on profiles for insert
  with check (is_admin_tier());

-- Events: admins see everything; RSO officers see title + org only
-- (enforced at the query/select-column level in the app layer, since RLS
-- can't easily mask individual columns — the API layer should request a
-- restricted column set for non-admin roles).
create policy events_select_all on events for select
  using (true);

create policy events_write_admin_or_owner on events for insert
  with check (
    is_admin_tier()
    or org_id in (select org_id from org_memberships where profile_id = auth.uid())
  );

-- Needed for pencil<->reserved<->cancelled updates on the Calendar page,
-- and for auto-scheduling an events row when a submission is approved.
create policy events_update_admin_or_owner on events for update
  using (
    is_admin_tier()
    or org_id in (select org_id from org_memberships where profile_id = auth.uid())
  );

-- Submissions: org members see their own org's submissions; admins see all.
create policy submissions_select on submissions for select
  using (
    is_admin_tier()
    or org_id in (select org_id from org_memberships where profile_id = auth.uid())
  );

create policy submissions_insert on submissions for insert
  with check (
    org_id in (select org_id from org_memberships where profile_id = auth.uid())
    and (
      -- clearance gate only blocks new event applications, never the
      -- report submission that would resolve the clearance itself
      type = 'report'
      or not exists (
        select 1 from clearances
        where org_id = submissions.org_id and status in ('pending', 'overdue')
      )
    )
  );

-- Needed so the approval chain (assistant -> supervisor -> director) can
-- advance `stage`, and so approving an event application can link it to
-- the auto-created `events` row via event_id.
create policy submissions_update_admin on submissions for update
  using (is_admin_tier());

create policy submission_attachments_select on submission_attachments for select
  using (
    is_admin_tier()
    or exists (
      select 1 from submissions s
      join org_memberships m on m.org_id = s.org_id and m.profile_id = auth.uid()
      where s.id = submission_attachments.submission_id
    )
  );

create policy submission_attachments_insert on submission_attachments for insert
  with check (
    is_admin_tier()
    or exists (
      select 1 from submissions s
      join org_memberships m on m.org_id = s.org_id and m.profile_id = auth.uid()
      where s.id = submission_attachments.submission_id
    )
  );

create policy submission_status_history_select on submission_status_history for select
  using (
    is_admin_tier()
    or exists (
      select 1 from submissions s
      join org_memberships m on m.org_id = s.org_id and m.profile_id = auth.uid()
      where s.id = submission_status_history.submission_id
    )
  );

create policy submission_status_history_insert on submission_status_history for insert
  with check (is_admin_tier());

create policy clearances_select on clearances for select
  using (
    is_admin_tier()
    or org_id in (select org_id from org_memberships where profile_id = auth.uid())
  );

-- Needed to auto-create the clearance obligation once an event
-- application is approved.
create policy clearances_insert_admin on clearances for insert
  with check (is_admin_tier());

create policy clearances_admin_write on clearances for update
  using (is_admin_tier());

-- Templates: readable by everyone (logged in), writable by admins.
create policy templates_select on templates for select using (true);
create policy templates_write on templates for all using (is_admin_tier());

-- Assignments: assignee + admins.
create policy assignments_select on assignments for select
  using (assigned_to = auth.uid() or is_admin_tier());

create policy assignments_write on assignments for all
  using (is_admin_tier());

-- ============================================================
-- STORAGE — submission attachments
-- Create the bucket from the Supabase dashboard first:
-- Storage -> New bucket -> name it exactly "submission-attachments"
-- (private). These policies then govern access to it.
-- ============================================================
create policy submission_attachments_storage_read on storage.objects
  for select using (bucket_id = 'submission-attachments' and auth.role() = 'authenticated');

create policy submission_attachments_storage_write on storage.objects
  for insert with check (bucket_id = 'submission-attachments' and auth.role() = 'authenticated');

-- Storage bucket for admin-uploaded templates (ACP Form, PARF, etc).
-- Create the bucket from the Supabase dashboard first:
-- Storage -> New bucket -> name it exactly "templates" (public is fine,
-- since every logged-in role is allowed to download these).
create policy templates_storage_read on storage.objects
  for select using (bucket_id = 'templates');

create policy templates_storage_write on storage.objects
  for all using (bucket_id = 'templates' and is_admin_tier())
  with check (bucket_id = 'templates' and is_admin_tier());
