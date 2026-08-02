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

create type accreditation_status as enum ('accredited', 'probationary', 'pending');

-- ---------- ORGANIZATIONS ----------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  acronym text not null unique,
  category text, -- e.g. Academic, Special Interest, Fraternal
  adviser_name text,
  logo_url text,
  accreditation_status accreditation_status not null default 'pending',
  contact_email text,
  contact_number text,
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
  unique (profile_id, org_id, position),
  -- RSO accounts are position-based (one login per org+position, not per
  -- person) — see migration 008.
  unique (org_id, position)
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

insert into venues (name) values
  ('Auditorium'), ('Multi-Sports Center'), ('INSPIRE Lounge'), ('Hoops Center'),
  ('Wellness Center'), ('High Performance Gym'), ('AGETAC Pool'), ('Driveway'),
  ('Football Pitch'), ('Room'), ('Laboratory'), ('LRC'), ('Others');

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
  -- Venue booking confirmation (see migration 009) — free-text detail for
  -- Room/Laboratory/Others, the auto-derived office tag, whether it's
  -- been pencil-booked, and (Laboratory only) lab-owner endorsement.
  venue_detail text,
  venue_tag text,
  pencil_booked boolean,
  lab_endorsed boolean,
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
-- Tasks + deliverables. A reviewer creates a task targeting a specific
-- user, a cross-org position tag (e.g. "Treasurer"), or a whole org.
-- Optionally linked to a submission (task blocks that submission's SDAO
-- Assistant review step until it's approved or conditionally waived) and/or
-- an event (informational tag, doesn't block anything). Post-activity
-- report obligations are auto-generated here too (auto_generated = true) —
-- clicking one routes the assignee straight into Submission Bin's report
-- form, and submitting that report auto-completes the assignment.
create type assignment_status as enum (
  'pending', 'submitted', 'returned', 'approved', 'conditional_approved'
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  submission_id uuid references submissions(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  assigned_to uuid references profiles(id),        -- specific user
  assigned_tag text,                                -- cross-org position tag
  assigned_org_id uuid references organizations(id),-- whole org
  assigned_by uuid not null references profiles(id),
  due_date date,
  status assignment_status not null default 'pending',
  review_comment text,
  auto_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignments_has_target check (
    assigned_to is not null or assigned_tag is not null or assigned_org_id is not null
  )
);

create index idx_assignments_submission on assignments(submission_id);
create index idx_assignments_event on assignments(event_id);

create table assignment_deliverables (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  file_url text not null,
  note text,
  uploaded_by uuid not null references profiles(id),
  uploaded_at timestamptz not null default now()
);

-- ---------- CLEARANCE ----------
-- One row per (org, event): report obligations after an event.
-- No clearance -> org is blocked from submitting new event applications.
-- A clearance issue can *also* come from a non-event assignment that
-- went past its due_date (see migration 010) — in that case event_id is
-- null, assignment_id points at the offending task, and `reason`
-- explains it in the Clearance UI.
create table clearances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  event_id uuid references events(id),
  assignment_id uuid references assignments(id) on delete cascade,
  reason text,
  status clearance_status not null default 'pending',
  report_submission_id uuid references submissions(id),
  deadline date not null,
  extended_deadline date,
  cleared_by uuid references profiles(id),
  cleared_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, event_id),
  constraint clearances_target_check check (event_id is not null or assignment_id is not null)
);

create index idx_clearances_org_status on clearances(org_id, status);
create index idx_clearances_assignment on clearances(assignment_id);
create unique index clearances_org_assignment_unique
  on clearances (org_id, assignment_id) where assignment_id is not null;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table profiles enable row level security;
alter table organizations enable row level security;
alter table org_memberships enable row level security;
alter table admin_viewer_scopes enable row level security;
alter table profile_tags enable row level security;
alter table venues enable row level security;
alter table events enable row level security;
alter table submissions enable row level security;
alter table submission_attachments enable row level security;
alter table submission_status_history enable row level security;
alter table clearances enable row level security;
alter table assignments enable row level security;
alter table assignment_deliverables enable row level security;
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

-- BUG FIX: org_memberships had RLS enabled with no policy at all, which
-- means the subquery `org_id in (select org_id from org_memberships ...)`
-- used throughout this file's other policies silently returned zero rows
-- for every non-admin user — breaking org-scoped visibility everywhere.
create policy org_memberships_select on org_memberships for select
  using (profile_id = auth.uid() or is_admin_tier());

-- Needed so admins can assign RSO officers to an org + position from
-- Accounts (this doubles as the cross-org tagging mechanism, e.g. "all
-- Treasurers" = every org_membership row with position = 'Treasurer').
create policy org_memberships_write_admin on org_memberships for all
  using (is_admin_tier())
  with check (is_admin_tier());

-- BUG FIX: organizations had RLS enabled with NO policy at all — every
-- org dropdown across Calendar, Submission Bin, Assignments, and the
-- Dashboard's active-org count has been silently returning zero rows for
-- every role, admins included, since organizations select was never
-- explicitly granted.
create policy organizations_select on organizations for select using (true);

create policy organizations_write_admin on organizations for all
  using (is_admin_tier())
  with check (is_admin_tier());

-- BUG FIX: venues never had RLS enabled at all, which meant it was wide
-- open — any authenticated user could insert/update/delete venue rows,
-- not just read them.
create policy venues_select on venues for select using (true);

create policy venues_write_admin on venues for all
  using (is_admin_tier())
  with check (is_admin_tier());

-- BUG FIX: admin_viewer_scopes never had RLS enabled at all (wide open).
create policy admin_viewer_scopes_select on admin_viewer_scopes for select
  using (profile_id = auth.uid() or is_admin_tier());

create policy admin_viewer_scopes_write_admin on admin_viewer_scopes for all
  using (is_admin_tier())
  with check (is_admin_tier());

-- BUG FIX: profile_tags never had RLS enabled at all (wide open). Not yet
-- surfaced in the UI, but locked down defensively so it isn't an open door.
create policy profile_tags_select on profile_tags for select
  using (profile_id = auth.uid() or is_admin_tier());

create policy profile_tags_write_admin on profile_tags for all
  using (is_admin_tier())
  with check (is_admin_tier());

-- Everyone can read their own profile; admins can read all.
create policy profiles_select on profiles for select
  using (id = auth.uid() or is_admin_tier());

create policy profiles_update_self on profiles for update
  using (id = auth.uid());

-- Needed so admins can edit any user's display name from Settings.
create policy profiles_update_admin on profiles for update
  using (is_admin_tier());

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

-- Assignments: the assignee (by user, tag, or org) can see and update
-- their own; admins can see/manage all.
create policy assignments_select on assignments for select
  using (
    is_admin_tier()
    or assigned_to = auth.uid()
    or assigned_org_id in (select org_id from org_memberships where profile_id = auth.uid())
    or assigned_tag in (select position from org_memberships where profile_id = auth.uid())
  );

create policy assignments_insert_admin on assignments for insert
  with check (is_admin_tier());

-- Admins manage the full lifecycle; assignees may only update their own
-- (used to submit a deliverable, i.e. flip status to 'submitted').
create policy assignments_update_admin on assignments for update
  using (is_admin_tier());

create policy assignments_update_assignee on assignments for update
  using (
    assigned_to = auth.uid()
    or assigned_org_id in (select org_id from org_memberships where profile_id = auth.uid())
    or assigned_tag in (select position from org_memberships where profile_id = auth.uid())
  );

create policy assignment_deliverables_select on assignment_deliverables for select
  using (
    is_admin_tier()
    or exists (
      select 1 from assignments a
      where a.id = assignment_deliverables.assignment_id
      and (
        a.assigned_to = auth.uid()
        or a.assigned_org_id in (select org_id from org_memberships where profile_id = auth.uid())
        or a.assigned_tag in (select position from org_memberships where profile_id = auth.uid())
      )
    )
  );

create policy assignment_deliverables_insert on assignment_deliverables for insert
  with check (
    is_admin_tier()
    or exists (
      select 1 from assignments a
      where a.id = assignment_deliverables.assignment_id
      and (
        a.assigned_to = auth.uid()
        or a.assigned_org_id in (select org_id from org_memberships where profile_id = auth.uid())
        or a.assigned_tag in (select position from org_memberships where profile_id = auth.uid())
      )
    )
  );

-- ============================================================
-- STORAGE — buckets
-- Buckets are just rows in storage.buckets, so create them here
-- instead of relying on a manual dashboard step (skipping that step
-- is what causes the app to fail with "Bucket not found" / NoSuchBucket
-- the first time someone tries to upload or download a file).
-- ============================================================
insert into storage.buckets (id, name, public)
values
  ('assignment-deliverables', 'assignment-deliverables', false),
  ('submission-attachments', 'submission-attachments', false),
  ('templates', 'templates', true),
  ('avatars', 'avatars', true),
  ('org-logos', 'org-logos', true)
on conflict (id) do nothing;

-- ============================================================
-- STORAGE — submission attachments
-- These policies govern access to the "submission-attachments" bucket
-- created above (private).
-- ============================================================
create policy submission_attachments_storage_read on storage.objects
  for select using (bucket_id = 'submission-attachments' and auth.role() = 'authenticated');

create policy submission_attachments_storage_write on storage.objects
  for insert with check (bucket_id = 'submission-attachments' and auth.role() = 'authenticated');

-- Storage bucket for admin-uploaded templates (ACP Form, PARF, etc),
-- created above (public, since every logged-in role can download these).
create policy templates_storage_read on storage.objects
  for select using (bucket_id = 'templates');

create policy templates_storage_write on storage.objects
  for all using (bucket_id = 'templates' and is_admin_tier())
  with check (bucket_id = 'templates' and is_admin_tier());

-- Storage bucket for assignment deliverables, created above (private).
create policy assignment_deliverables_storage_read on storage.objects
  for select using (bucket_id = 'assignment-deliverables' and auth.role() = 'authenticated');

create policy assignment_deliverables_storage_write on storage.objects
  for insert with check (bucket_id = 'assignment-deliverables' and auth.role() = 'authenticated');

-- Storage bucket for profile photos, created above (public — these
-- render in the topbar for everyone).
create policy avatars_storage_read on storage.objects
  for select using (bucket_id = 'avatars');

create policy avatars_storage_write on storage.objects
  for insert with check (bucket_id = 'avatars' and auth.role() = 'authenticated');

create policy avatars_storage_update on storage.objects
  for update using (bucket_id = 'avatars' and auth.role() = 'authenticated');

-- org-logos bucket, created above (public — logos render in Accounts
-- and org-facing pages for everyone).
create policy org_logos_storage_read on storage.objects
  for select using (bucket_id = 'org-logos');

create policy org_logos_storage_write on storage.objects
  for insert with check (bucket_id = 'org-logos' and is_admin_tier());

create policy org_logos_storage_update on storage.objects
  for update using (bucket_id = 'org-logos' and is_admin_tier());
