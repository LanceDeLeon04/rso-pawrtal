-- ============================================================
-- 019: External approver links (Adviser / Dean)
-- ============================================================
-- Event applications now need sign-off from people who never get a
-- Pawrtal account:
--   School Council / Academic orgs : Adviser -> Dean -> SDAO Assistant -> ...
--   Special Interest orgs          : Adviser -> SDAO Assistant -> ...
-- Each is handled via a unique, 7-day "magic link" (one per role per
-- submission) that resolves to a public review page: view the filled
-- ACP + attachments, leave comments, then approve (with a drawn
-- signature) or reject. A Dean can never act before the Adviser has
-- approved. On approval the submission auto-advances to the next
-- step; on rejection it's kicked to 'rejected' immediately.

-- Token generation below uses gen_random_uuid(), the same function
-- already used throughout schema.sql, so no extra extension is needed.

create type approval_link_role as enum ('adviser', 'dean');
create type approval_link_status as enum ('pending', 'approved', 'rejected', 'expired');

create table approval_links (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  role approval_link_role not null,
  token text not null unique,
  person_name text not null,
  person_email text,
  status approval_link_status not null default 'pending',
  comment text,
  signature_data text, -- data:image/png;base64,... captured at approval time
  decided_at timestamptz,
  expires_at timestamptz not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  unique (submission_id, role) -- one active link per role per submission
);

create index idx_approval_links_submission on approval_links(submission_id);
create index idx_approval_links_token on approval_links(token);

-- Free-form back-and-forth between the reviewing org and the external
-- adviser/dean while a link is open. Kept separate from
-- submission_comments (which requires an author_id profile) since
-- advisers/deans have none.
create table approval_link_messages (
  id uuid primary key default gen_random_uuid(),
  approval_link_id uuid not null references approval_links(id) on delete cascade,
  author text not null check (author in ('reviewer', 'sdao')), -- 'reviewer' = adviser/dean, 'sdao' = org/staff side
  body text not null,
  created_at timestamptz not null default now()
);

create index idx_approval_link_messages_link on approval_link_messages(approval_link_id);

alter table approval_links enable row level security;
alter table approval_link_messages enable row level security;

-- Normal authenticated access (showing link status/history inside
-- Submission Bin) is scoped exactly like the submission itself.
-- The external adviser/dean opening their link never touches these
-- tables directly — that only ever goes through the security-definer
-- RPCs below, each of which validates the token on its own.
create policy approval_links_select on approval_links for select
  using (
    is_admin_tier()
    or exists (
      select 1 from submissions s
      join org_memberships m on m.org_id = s.org_id and m.profile_id = auth.uid()
      where s.id = approval_links.submission_id
    )
  );

create policy approval_links_write on approval_links for all
  using (
    is_admin_tier()
    or exists (
      select 1 from submissions s
      join org_memberships m on m.org_id = s.org_id and m.profile_id = auth.uid()
      where s.id = approval_links.submission_id
    )
  )
  with check (
    is_admin_tier()
    or exists (
      select 1 from submissions s
      join org_memberships m on m.org_id = s.org_id and m.profile_id = auth.uid()
      where s.id = approval_links.submission_id
    )
  );

create policy approval_link_messages_select on approval_link_messages for select
  using (
    is_admin_tier()
    or exists (
      select 1 from approval_links al
      join submissions s on s.id = al.submission_id
      join org_memberships m on m.org_id = s.org_id and m.profile_id = auth.uid()
      where al.id = approval_link_messages.approval_link_id
    )
  );

create policy approval_link_messages_write on approval_link_messages for insert
  with check (
    is_admin_tier()
    or exists (
      select 1 from approval_links al
      join submissions s on s.id = al.submission_id
      join org_memberships m on m.org_id = s.org_id and m.profile_id = auth.uid()
      where al.id = approval_link_messages.approval_link_id
    )
  );

-- The approval-chain audit trail previously required a profile-owning
-- actor. Widen it so external approvals can be recorded there too.
alter table submission_status_history alter column actor_id drop not null;
alter table submission_status_history add column if not exists actor_name text;

-- ------------------------------------------------------------
-- generate_approval_link(submission, role, name, email)
-- Called by the submitting org (or admin/reviewer) to issue or
-- reissue a 7-day link for a role. Reissuing replaces the previous
-- link for that role and resets it to pending.
-- ------------------------------------------------------------
create or replace function generate_approval_link(
  p_submission_id uuid,
  p_role approval_link_role,
  p_person_name text,
  p_person_email text default null
) returns approval_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission submissions;
  v_org organizations;
  v_token text;
  v_row approval_links;
begin
  select * into v_submission from submissions where id = p_submission_id;
  if v_submission is null then
    raise exception 'Submission not found';
  end if;

  if not (
    is_admin_tier()
    or exists (
      select 1 from org_memberships
      where org_id = v_submission.org_id and profile_id = auth.uid()
    )
  ) then
    raise exception 'Not authorized to generate a link for this submission';
  end if;

  select * into v_org from organizations where id = v_submission.org_id;

  if p_role = 'dean' and coalesce(v_org.category, '') = 'Special Interest' then
    raise exception 'Special Interest organizations do not require a Dean link';
  end if;

  if trim(coalesce(p_person_name, '')) = '' then
    raise exception 'Person name is required';
  end if;

  -- Built from gen_random_uuid() rather than pgcrypto's gen_random_bytes()
  -- — the latter lives in the `extensions` schema on Supabase and isn't
  -- visible under this function's `search_path = public`.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into approval_links (
    submission_id, role, token, person_name, person_email,
    status, expires_at, created_by
  ) values (
    p_submission_id, p_role, v_token, trim(p_person_name),
    nullif(trim(coalesce(p_person_email, '')), ''),
    'pending', now() + interval '7 days', auth.uid()
  )
  on conflict (submission_id, role) do update set
    token = excluded.token,
    person_name = excluded.person_name,
    person_email = excluded.person_email,
    status = 'pending',
    comment = null,
    signature_data = null,
    decided_at = null,
    expires_at = excluded.expires_at,
    created_by = excluded.created_by,
    created_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function generate_approval_link(uuid, approval_link_role, text, text) to authenticated;

-- ------------------------------------------------------------
-- get_approval_link(token)
-- Public (anon) entry point behind the review page. Resolves a token
-- into everything needed to render it; never accepts a raw submission
-- id and never exposes anything beyond that one submission's data.
-- ------------------------------------------------------------
create or replace function get_approval_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link approval_links;
  v_submission submissions;
  v_org organizations;
  v_adviser approval_links;
begin
  select * into v_link from approval_links where token = p_token;
  if v_link is null then
    return jsonb_build_object('error', 'invalid');
  end if;

  if v_link.status = 'pending' and v_link.expires_at < now() then
    update approval_links set status = 'expired' where id = v_link.id;
    v_link.status := 'expired';
  end if;

  select * into v_submission from submissions where id = v_link.submission_id;
  select * into v_org from organizations where id = v_submission.org_id;

  if v_link.role = 'dean' then
    select * into v_adviser from approval_links
      where submission_id = v_link.submission_id and role = 'adviser';
  end if;

  return jsonb_build_object(
    'link', jsonb_build_object(
      'role', v_link.role,
      'status', v_link.status,
      'person_name', v_link.person_name,
      'expires_at', v_link.expires_at,
      'decided_at', v_link.decided_at,
      'comment', v_link.comment
    ),
    'submission', jsonb_build_object(
      'id', v_submission.id,
      'title', v_submission.title,
      'contact_person', v_submission.contact_person,
      'contact_number', v_submission.contact_number,
      'event_date', v_submission.event_date,
      'start_time', v_submission.start_time,
      'end_time', v_submission.end_time,
      'medium', v_submission.medium,
      'venue', (select name from venues where id = v_submission.venue_id),
      'venue_detail', v_submission.venue_detail,
      'online_platform', v_submission.online_platform,
      'description', v_submission.description,
      'activity_type', v_submission.activity_type,
      'target_audience', v_submission.target_audience,
      'target_participants', v_submission.target_participants,
      'projected_budget', v_submission.projected_budget,
      'budget_source', v_submission.budget_source,
      'is_continuing', v_submission.is_continuing,
      'continuing_type', v_submission.continuing_type,
      'term_label', v_submission.term_label,
      'stage', v_submission.stage
    ),
    'organization', jsonb_build_object(
      'name', v_org.name, 'acronym', v_org.acronym, 'category', v_org.category
    ),
    'attachments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'document_type', document_type, 'file_url', file_url
      ) order by uploaded_at), '[]'::jsonb)
      from submission_attachments where submission_id = v_submission.id
    ),
    'adviser_status', case when v_link.role = 'dean'
      then coalesce(v_adviser.status::text, 'not_generated') else null end,
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'author', author, 'body', body, 'created_at', created_at
      ) order by created_at), '[]'::jsonb)
      from approval_link_messages where approval_link_id = v_link.id
    )
  );
end;
$$;

grant execute on function get_approval_link(text) to anon, authenticated;

-- ------------------------------------------------------------
-- add_approval_comment(token, body)
-- Lets the external reviewer post a comment onto their own link.
-- ------------------------------------------------------------
create or replace function add_approval_comment(p_token text, p_body text)
returns approval_link_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link approval_links;
  v_row approval_link_messages;
begin
  select * into v_link from approval_links where token = p_token;
  if v_link is null then
    raise exception 'Invalid link';
  end if;
  if v_link.status = 'pending' and v_link.expires_at < now() then
    raise exception 'This link has expired';
  end if;
  if trim(coalesce(p_body, '')) = '' then
    raise exception 'Comment cannot be empty';
  end if;

  insert into approval_link_messages (approval_link_id, author, body)
  values (v_link.id, 'reviewer', p_body)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function add_approval_comment(text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- submit_approval_decision(token, decision, comment, signature)
-- The actual approve/reject action from the public review page.
-- A signature (data URL) is required to approve. Deans are blocked
-- from deciding until the Adviser's link on the same submission has
-- been approved. Approving advances the submission (to the Dean step
-- if the org needs one and this was the Adviser, otherwise straight
-- to 'assistant_review'); rejecting kicks the submission to 'rejected'.
-- ------------------------------------------------------------
create or replace function submit_approval_decision(
  p_token text,
  p_decision approval_link_status,
  p_comment text default null,
  p_signature text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link approval_links;
  v_submission submissions;
  v_org organizations;
  v_adviser approval_links;
  v_needs_dean boolean;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision';
  end if;

  select * into v_link from approval_links where token = p_token;
  if v_link is null then
    raise exception 'Invalid link';
  end if;
  if v_link.status <> 'pending' then
    raise exception 'This link has already been used';
  end if;
  if v_link.expires_at < now() then
    update approval_links set status = 'expired' where id = v_link.id;
    raise exception 'This link has expired';
  end if;
  if p_decision = 'approved' and trim(coalesce(p_signature, '')) = '' then
    raise exception 'A signature is required to approve';
  end if;

  select * into v_submission from submissions where id = v_link.submission_id;
  select * into v_org from organizations where id = v_submission.org_id;

  if v_link.role = 'dean' then
    select * into v_adviser from approval_links
      where submission_id = v_link.submission_id and role = 'adviser';
    if v_adviser is null or v_adviser.status <> 'approved' then
      raise exception 'The Adviser has not approved this application yet';
    end if;
  end if;

  update approval_links set
    status = p_decision,
    comment = p_comment,
    signature_data = p_signature,
    decided_at = now()
  where id = v_link.id;

  insert into submission_status_history (submission_id, stage, action, actor_name, comment)
  values (
    v_link.submission_id,
    v_submission.stage,
    p_decision::text,
    v_link.person_name || ' (' || initcap(v_link.role::text) || ')',
    p_comment
  );

  if p_decision = 'rejected' then
    update submissions set stage = 'rejected', updated_at = now() where id = v_link.submission_id;
  else
    v_needs_dean := coalesce(v_org.category, '') in ('School Council', 'Academic');
    if v_link.role = 'dean' or (v_link.role = 'adviser' and not v_needs_dean) then
      update submissions set stage = 'assistant_review', updated_at = now() where id = v_link.submission_id;
    end if;
    -- Adviser approved but org still needs a Dean: leave stage as-is,
    -- waiting on the Dean's own link.
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision);
end;
$$;

grant execute on function submit_approval_decision(text, approval_link_status, text, text) to anon, authenticated;
