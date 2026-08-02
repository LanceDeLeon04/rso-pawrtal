-- ============================================================
-- Migration 004 — Assignments (tasks + deliverables) + a critical
-- org_memberships RLS bugfix.
-- Run this if you already applied schema.sql + earlier migrations.
-- (If setting up fresh, just run schema.sql — it already includes this.)
-- ============================================================

-- ---------- CRITICAL BUGFIX ----------
-- org_memberships had RLS enabled with NO policy at all. Every other
-- policy in this schema that does `org_id in (select org_id from
-- org_memberships where profile_id = auth.uid())` runs that subquery as
-- the calling user — so with no policy on org_memberships, it silently
-- returned zero rows for every non-admin. In effect, RSO officers could
-- never see their own org's events, submissions, or clearances. Run this
-- first.
create policy org_memberships_select on org_memberships for select
  using (profile_id = auth.uid() or is_admin_tier());

-- ---------- ASSIGNMENTS REDESIGN ----------
-- The original assignments table only supported one assignee and no
-- title/description. This drops and recreates it with the richer model
-- (target a user, a cross-org position tag, or a whole org; optional
-- links to a submission and/or event; a real status lifecycle).
-- NOTE: this drops any existing assignment rows. If you have real data in
-- the old table, export it first.
drop table if exists assignments cascade;

create type assignment_status as enum (
  'pending', 'submitted', 'returned', 'approved', 'conditional_approved'
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  submission_id uuid references submissions(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  assigned_to uuid references profiles(id),
  assigned_tag text,
  assigned_org_id uuid references organizations(id),
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

alter table assignments enable row level security;
alter table assignment_deliverables enable row level security;

create policy assignments_select on assignments for select
  using (
    is_admin_tier()
    or assigned_to = auth.uid()
    or assigned_org_id in (select org_id from org_memberships where profile_id = auth.uid())
    or assigned_tag in (select position from org_memberships where profile_id = auth.uid())
  );

create policy assignments_insert_admin on assignments for insert
  with check (is_admin_tier());

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

-- Create the bucket from the Supabase dashboard first:
-- Storage -> New bucket -> name it exactly "assignment-deliverables"
-- (private).
create policy assignment_deliverables_storage_read on storage.objects
  for select using (bucket_id = 'assignment-deliverables' and auth.role() = 'authenticated');

create policy assignment_deliverables_storage_write on storage.objects
  for insert with check (bucket_id = 'assignment-deliverables' and auth.role() = 'authenticated');
