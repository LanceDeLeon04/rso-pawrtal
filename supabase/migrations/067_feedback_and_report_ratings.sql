-- ============================================================
-- 067: General feedback mechanism (Settings -> Feedback tab) and a
-- mandatory 5-star rating captured right after an Activity Report is
-- submitted (Submission Bin).
-- ============================================================

-- ------------------------------------------------------------
-- feedback — general, free-form feedback any logged-in user can
-- submit from Settings. Submitters can see their own entries;
-- only admin-tier roles (is_admin_tier()) can see everyone's.
-- ------------------------------------------------------------
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  org_id uuid references organizations(id) on delete set null,
  message text not null,
  page_context text,
  status text not null default 'new' check (status in ('new', 'reviewed')),
  created_at timestamptz not null default now()
);

create index if not exists feedback_profile_id_idx on feedback(profile_id);
create index if not exists feedback_created_at_idx on feedback(created_at desc);

alter table feedback enable row level security;

create policy feedback_insert on feedback
  for insert with check (profile_id = auth.uid());

create policy feedback_select on feedback
  for select using (profile_id = auth.uid() or is_admin_tier());

-- Admins can mark feedback as reviewed.
create policy feedback_update_admin on feedback
  for update using (is_admin_tier())
  with check (is_admin_tier());

-- ------------------------------------------------------------
-- report_ratings — one 5-star rating per submitted Activity Report,
-- captured right after submission. One rating per submission.
-- ------------------------------------------------------------
create table if not exists report_ratings (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (submission_id)
);

create index if not exists report_ratings_org_id_idx on report_ratings(org_id);

alter table report_ratings enable row level security;

-- The submitting org can rate its own just-submitted report. We check
-- against org_memberships rather than submitted_by so any officer in
-- the org (not just the original submitter) could complete the rating
-- if the flow is interrupted/reopened.
create policy report_ratings_insert on report_ratings
  for insert with check (
    profile_id = auth.uid()
    and org_id in (select org_id from org_memberships where profile_id = auth.uid())
  );

create policy report_ratings_select on report_ratings
  for select using (
    org_id in (select org_id from org_memberships where profile_id = auth.uid())
    or is_admin_tier()
  );
