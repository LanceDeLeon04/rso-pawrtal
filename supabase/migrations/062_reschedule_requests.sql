-- ============================================================
-- 062: Reschedule requests for already-approved activities
-- ============================================================
-- Once a submission has cleared the full ACP chain (Assistant ->
-- Supervisor -> Director) and its `events` row is booked, the org may
-- need to move the date/time/venue(s). This adds a SEPARATE approval
-- chain (same three roles, its own routing) that does NOT touch the
-- original submission's stage/history.
--
-- Multi-date/multi-venue events (see 042/043) can request a reschedule
-- for only some of their dates — each date being moved is its own row
-- in reschedule_request_items, so e.g. a 3-day event can move day 2
-- only and leave days 1 and 3 untouched.
--
-- Calendar semantics while pending:
--   Pencil Book New, Booked Old  -> a new `events` row is created per
--   moved date, booking_status = 'pencil', so the calendar shows the
--   requested new slot as tentatively held while the original booking
--   stays exactly as it was (booking_status untouched).
--
-- Calendar semantics once fully approved (Director):
--   Booked New, Adjust Deadline of Report, Cancel Old -> each new
--   pencil row flips to booking_status = 'reserved'; the original
--   event is either cancelled outright (single-day, or every date of a
--   multi-day event was moved) or has just the moved date(s) stripped
--   out of its event_dates array (partial reschedule); and the linked
--   submission's report_submission_date / clearance deadline is pushed
--   to the new (latest) date + 7 days.

-- ---------- ENUM ----------
create type reschedule_stage as enum (
  'pending_assistant',
  'pending_supervisor',
  'pending_director',
  'approved',
  'returned',   -- kicked back to the org for revision, can be resubmitted
  'rejected',
  'cancelled'   -- withdrawn by the org before a decision
);

-- ---------- REQUESTS ----------
create table reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  reason text not null,
  stage reschedule_stage not null default 'pending_assistant',
  requested_by uuid not null references profiles(id),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  updated_at timestamptz not null default now()
);

create index idx_reschedule_requests_submission on reschedule_requests(submission_id);
create index idx_reschedule_requests_event on reschedule_requests(event_id);
create index idx_reschedule_requests_org on reschedule_requests(org_id);
create index idx_reschedule_requests_stage on reschedule_requests(stage);

-- One request can only be actively in flight at a time per event —
-- prevents an org from stacking a second reschedule on top of a
-- still-pending one.
create unique index idx_reschedule_requests_one_active_per_event
  on reschedule_requests(event_id)
  where stage in ('pending_assistant', 'pending_supervisor', 'pending_director');

-- ---------- PER-DATE ITEMS ----------
-- `original_event_date` is null when the event is single-day (there's
-- only one date to move, already identified by event_id). For
-- multi-day events it identifies which entry in the original event's
-- event_dates array is being moved.
create table reschedule_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references reschedule_requests(id) on delete cascade,
  original_event_date date,
  new_event_date date not null,
  new_start_time time,
  new_end_time time,
  new_venue_ids uuid[] not null default '{}',
  new_venue_details jsonb not null default '{}'::jsonb,
  -- The tentative/booked calendar row created for this specific move.
  -- Null until the request's insert trigger (see below) creates it.
  pencil_event_id uuid references events(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_reschedule_items_request on reschedule_request_items(request_id);

-- ---------- HISTORY (mirrors submission_status_history) ----------
create table reschedule_request_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references reschedule_requests(id) on delete cascade,
  stage reschedule_stage not null,
  action text not null, -- 'submitted','checked','endorsed','approved','returned','rejected','cancelled'
  actor_id uuid not null references profiles(id),
  comment text,
  created_at timestamptz not null default now()
);

create index idx_reschedule_history_request on reschedule_request_history(request_id);

-- ---------- LINK NEW PENCIL BOOKINGS BACK TO THE REQUEST ----------
alter table events
  add column if not exists reschedule_request_id uuid references reschedule_requests(id) on delete set null,
  add column if not exists supersedes_event_id uuid references events(id) on delete set null;

comment on column events.reschedule_request_id is
  'Set on the NEW tentative/booked row created by a reschedule request. Null for ordinary bookings.';
comment on column events.supersedes_event_id is
  'For a reschedule''s new row, the original event it is replacing (whole event or one of its dates).';

-- ============================================================
-- create_reschedule_request(p_event_id, p_reason, p_items)
-- Called by the org (rso_officer) that owns the event. p_items is a
-- jsonb array of
--   { original_event_date, new_event_date, new_start_time,
--     new_end_time, new_venue_ids, new_venue_details }
-- Creates the request + item rows, and one 'pencil' events row per
-- item so the calendar immediately shows the tentative new slot(s).
-- ============================================================
create or replace function create_reschedule_request(
  p_event_id uuid,
  p_reason text,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events;
  v_request_id uuid;
  v_item jsonb;
  v_pencil_id uuid;
begin
  select * into v_event from events where id = p_event_id;
  if v_event is null then
    raise exception 'event not found';
  end if;

  if v_event.org_id not in (select org_id from org_memberships where profile_id = auth.uid())
     and not is_admin_tier() then
    raise exception 'not authorized for this event';
  end if;

  if v_event.booking_status = 'cancelled' then
    raise exception 'cannot reschedule a cancelled booking';
  end if;

  insert into reschedule_requests (submission_id, event_id, org_id, reason, requested_by)
  values (v_event.submission_id, p_event_id, v_event.org_id, p_reason, auth.uid())
  returning id into v_request_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into events (
      title, org_id, contact_person, contact_number, description,
      venue_id, venue_ids, venue_details,
      event_date, start_time, end_time, medium,
      booking_status, submission_id, created_by,
      reschedule_request_id, supersedes_event_id
    ) values (
      v_event.title, v_event.org_id, v_event.contact_person, v_event.contact_number, v_event.description,
      (select (v_item->'new_venue_ids'->>0)::uuid),
      coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(v_item->'new_venue_ids') x), '{}'),
      coalesce(v_item->'new_venue_details', '{}'::jsonb),
      (v_item->>'new_event_date')::date,
      nullif(v_item->>'new_start_time','')::time,
      nullif(v_item->>'new_end_time','')::time,
      v_event.medium,
      'pencil',
      v_event.submission_id,
      auth.uid(),
      v_request_id,
      p_event_id
    ) returning id into v_pencil_id;

    insert into reschedule_request_items (
      request_id, original_event_date, new_event_date, new_start_time, new_end_time,
      new_venue_ids, new_venue_details, pencil_event_id
    ) values (
      v_request_id,
      nullif(v_item->>'original_event_date','')::date,
      (v_item->>'new_event_date')::date,
      nullif(v_item->>'new_start_time','')::time,
      nullif(v_item->>'new_end_time','')::time,
      coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(v_item->'new_venue_ids') x), '{}'),
      coalesce(v_item->'new_venue_details', '{}'::jsonb),
      v_pencil_id
    );
  end loop;

  insert into reschedule_request_history (request_id, stage, action, actor_id, comment)
  values (v_request_id, 'pending_assistant', 'submitted', auth.uid(), p_reason);

  return v_request_id;
end;
$$;

-- ============================================================
-- decide_reschedule_request(p_request_id, p_action, p_comment)
-- p_action: 'advance' (check/endorse/approve — moves to next stage,
-- or finalizes on the Director step), 'return', or 'reject'.
-- Enforces that only the role matching the CURRENT stage can act.
-- ============================================================
create or replace function decide_reschedule_request(
  p_request_id uuid,
  p_action text,
  p_comment text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req reschedule_requests;
  v_role text := current_role_name();
  v_next reschedule_stage;
  v_history_action text;
  v_orig_event events;
  v_item reschedule_request_items;
  v_max_new_date date;
begin
  select * into v_req from reschedule_requests where id = p_request_id for update;
  if v_req is null then
    raise exception 'reschedule request not found';
  end if;

  if v_req.stage = 'pending_assistant' and v_role <> 'sdao_assistant' and not is_admin_tier() then
    raise exception 'awaiting SDAO Assistant';
  elsif v_req.stage = 'pending_supervisor' and v_role <> 'sdao_supervisor' and not is_admin_tier() then
    raise exception 'awaiting SDAO Supervisor';
  elsif v_req.stage = 'pending_director' and v_role <> 'academic_director' and not is_admin_tier() then
    raise exception 'awaiting Academic Director';
  elsif v_req.stage not in ('pending_assistant','pending_supervisor','pending_director') then
    raise exception 'request already decided';
  end if;

  if p_action = 'return' then
    v_next := 'returned';
    v_history_action := 'returned';
  elsif p_action = 'reject' then
    v_next := 'rejected';
    v_history_action := 'rejected';
  elsif p_action = 'advance' then
    if v_req.stage = 'pending_assistant' then
      v_next := 'pending_supervisor';
      v_history_action := 'checked';
    elsif v_req.stage = 'pending_supervisor' then
      v_next := 'pending_director';
      v_history_action := 'endorsed';
    else
      v_next := 'approved';
      v_history_action := 'approved';
    end if;
  else
    raise exception 'unknown action %', p_action;
  end if;

  update reschedule_requests
    set stage = v_next,
        updated_at = now(),
        decided_at = case when v_next in ('approved','returned','rejected') then now() else decided_at end
    where id = p_request_id;

  insert into reschedule_request_history (request_id, stage, action, actor_id, comment)
  values (p_request_id, v_next, v_history_action, auth.uid(), p_comment);

  -- Not the final approval: leave the new rows as 'pencil' and the
  -- original booking untouched — nothing else to do.
  if v_next <> 'approved' then
    -- Returned/rejected: drop the tentative pencil rows, original stays as-is.
    if v_next in ('returned', 'rejected') then
      delete from events where reschedule_request_id = p_request_id;
    end if;
    return;
  end if;

  -- ---- Final approval: Booked New, Adjust Deadline, Cancel Old ----
  select * into v_orig_event from events where id = v_req.event_id;

  update events set booking_status = 'reserved'
    where reschedule_request_id = p_request_id;

  select max(new_event_date) into v_max_new_date
    from reschedule_request_items where request_id = p_request_id;

  -- Whole-event reschedule (single-day, or every date was moved): cancel the old row outright.
  if v_orig_event.is_multi_day is not true
     or not exists (
       select 1 from jsonb_array_elements(coalesce(v_orig_event.event_dates, '[]'::jsonb)) d
       where not exists (
         select 1 from reschedule_request_items i
         where i.request_id = p_request_id
           and i.original_event_date = (d->>'event_date')::date
       )
     ) then
    update events set booking_status = 'cancelled' where id = v_req.event_id;
  else
    -- Partial multi-day reschedule: strip only the moved dates out of
    -- the original event's event_dates array; keep it 'reserved' for
    -- whatever dates remain.
    update events
      set event_dates = (
        select coalesce(jsonb_agg(d), '[]'::jsonb)
        from jsonb_array_elements(event_dates) d
        where not exists (
          select 1 from reschedule_request_items i
          where i.request_id = p_request_id
            and i.original_event_date = (d->>'event_date')::date
        )
      )
      where id = v_req.event_id;
  end if;

  -- Adjust report deadline to (latest new date) + 7 days, same rule as
  -- the original event_date + 7 convention (see 016).
  update submissions
    set report_submission_date = v_max_new_date + 7,
        due_date = v_max_new_date + 7,
        updated_at = now()
    where id = v_req.submission_id;

  update clearances
    set deadline = v_max_new_date + 7
    where event_id = v_req.event_id;
end;
$$;

-- ---------- RLS ----------
alter table reschedule_requests enable row level security;
alter table reschedule_request_items enable row level security;
alter table reschedule_request_history enable row level security;

create policy reschedule_requests_select on reschedule_requests for select
  using (
    is_admin_tier()
    or org_id in (select org_id from org_memberships where profile_id = auth.uid())
  );

-- Inserts/decisions go exclusively through the two security-definer
-- functions above, so no direct insert/update policy is granted here
-- beyond what admins already get from is_admin_tier() elsewhere.
create policy reschedule_requests_update_admin on reschedule_requests for update
  using (is_admin_tier());

create policy reschedule_request_items_select on reschedule_request_items for select
  using (
    is_admin_tier()
    or exists (
      select 1 from reschedule_requests r
      join org_memberships m on m.org_id = r.org_id and m.profile_id = auth.uid()
      where r.id = reschedule_request_items.request_id
    )
  );

create policy reschedule_request_history_select on reschedule_request_history for select
  using (
    is_admin_tier()
    or exists (
      select 1 from reschedule_requests r
      join org_memberships m on m.org_id = r.org_id and m.profile_id = auth.uid()
      where r.id = reschedule_request_history.request_id
    )
  );

-- Allow the org to withdraw its own still-pending request.
create or replace function cancel_reschedule_request(p_request_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req reschedule_requests;
begin
  select * into v_req from reschedule_requests where id = p_request_id for update;
  if v_req is null then
    raise exception 'not found';
  end if;
  if v_req.stage not in ('pending_assistant','pending_supervisor','pending_director') then
    raise exception 'request already decided';
  end if;
  if v_req.org_id not in (select org_id from org_memberships where profile_id = auth.uid())
     and not is_admin_tier() then
    raise exception 'not authorized';
  end if;

  update reschedule_requests set stage = 'cancelled', updated_at = now(), decided_at = now()
    where id = p_request_id;
  delete from events where reschedule_request_id = p_request_id;

  insert into reschedule_request_history (request_id, stage, action, actor_id)
  values (p_request_id, 'cancelled', 'cancelled', auth.uid());
end;
$$;
