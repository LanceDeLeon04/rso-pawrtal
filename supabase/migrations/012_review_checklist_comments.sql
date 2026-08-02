-- ============================================================
-- Migration 012 — Review checklist, comments, and resubmission
-- Adds the reviewer checklist ("Additional Requirements"),
-- paginated review comments (with an optional page-number
-- reference into the attached document), and lets a submitter
-- resubmit + attach extra files after a "returned" verdict.
-- ============================================================

-- ---------- ADDITIONAL REQUIREMENTS CHECKLIST ----------
-- Free-form checklist a reviewer builds per submission, e.g.
-- "ITSO Endorsement", "Dean Endorsement". Independent of the
-- fixed document attachments so reviewers can ask for anything.
create table submission_checklist_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  label text not null,
  is_checked boolean not null default false,
  created_by uuid not null references profiles(id),
  checked_by uuid references profiles(id),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  sort_order int not null default 0
);

create index idx_checklist_items_submission on submission_checklist_items(submission_id);

-- ---------- REVIEW COMMENTS ----------
-- One reviewer can leave several comments on a submission while
-- paging through the attached file, each optionally pinned to a
-- page number in the document being reviewed.
create table submission_comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  page_number text,
  body text not null default '',
  author_id uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_submission_comments_submission on submission_comments(submission_id);

alter table submission_checklist_items enable row level security;
alter table submission_comments enable row level security;

-- Checklist: visible to admins/reviewers and the owning org; only
-- reviewers (admin tier) can create/update/delete items.
create policy submission_checklist_select on submission_checklist_items for select
  using (
    is_admin_tier()
    or exists (
      select 1 from submissions s
      join org_memberships m on m.org_id = s.org_id and m.profile_id = auth.uid()
      where s.id = submission_checklist_items.submission_id
    )
  );

create policy submission_checklist_write on submission_checklist_items for all
  using (is_admin_tier())
  with check (is_admin_tier());

-- Comments: same visibility as checklist; only reviewers can post.
create policy submission_comments_select on submission_comments for select
  using (
    is_admin_tier()
    or exists (
      select 1 from submissions s
      join org_memberships m on m.org_id = s.org_id and m.profile_id = auth.uid()
      where s.id = submission_comments.submission_id
    )
  );

create policy submission_comments_write on submission_comments for insert
  with check (is_admin_tier());

create policy submission_comments_update on submission_comments for update
  using (is_admin_tier() and author_id = auth.uid());

create policy submission_comments_delete on submission_comments for delete
  using (is_admin_tier() and author_id = auth.uid());

-- ---------- RESUBMISSION ----------
-- Allow the owning org to move their own "returned" submission back
-- into the review queue (resubmit) and to attach additional files
-- while doing so. Admin-only update policy from migration 002 still
-- covers every other transition (approve/reject/forward).
create policy submissions_resubmit_owner on submissions for update
  using (
    stage = 'returned'
    and org_id in (select org_id from org_memberships where profile_id = auth.uid())
  )
  with check (
    org_id in (select org_id from org_memberships where profile_id = auth.uid())
  );

-- Additional attachments uploaded post-return already fall under the
-- existing submission_attachments_insert policy (org member OR admin).
