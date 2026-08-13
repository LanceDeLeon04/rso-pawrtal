-- ============================================================
-- 055: SHS Faculty / Venue Requests (continued) — run AFTER 054 has
-- been COMMITTED, same reason as 052a/052b: 'shs_faculty' cannot be
-- referenced in the same transaction it was added in.
-- ============================================================

-- ---------- 2. SHS classrooms (Faculty's ONLY bookable venue list) ----------
-- Deliberately a separate table from venue_rooms (migration 031),
-- which is the College's Building -> Floor -> Room picklist used on
-- the full event-application form. Faculty venue requests are a
-- different, much simpler flow, scoped to a flat list of SHS
-- classrooms that SDAO-SHS maintains. If a Faculty member needs a
-- College department room, they are directed (in the UI copy) to
-- request it personally from Facilities Management Office — that
-- request never goes through PAWrtal.

create table shs_classrooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table shs_classrooms is
  'Flat, SDAO-SHS-managed list of SHS classrooms Faculty may Venue Request. NOT the College Building/Floor/Room picklist (venue_rooms) — Faculty needing a College department room must request it personally to Facilities Management Office, outside PAWrtal.';

alter table shs_classrooms enable row level security;

-- Everyone signed in can see the list (needed to populate the Venue
-- Request dropdown, and to label bookings on the calendar).
create policy shs_classrooms_select_all
  on shs_classrooms for select
  using (auth.role() = 'authenticated');

-- Only SDAO-SHS may add/edit/remove SHS classrooms (per spec — NOT
-- SHS Principal, whose role here is approval, not room upkeep).
-- system_admin kept as a maintenance escape hatch, same convention
-- used for venue_rooms/venue_labs (fmo/admin-tier can maintain those).
create policy shs_classrooms_write_sdao_shs
  on shs_classrooms for insert
  with check (current_role_name() in ('sdao_shs', 'system_admin'));

create policy shs_classrooms_update_sdao_shs
  on shs_classrooms for update
  using (current_role_name() in ('sdao_shs', 'system_admin'));

create policy shs_classrooms_delete_sdao_shs
  on shs_classrooms for delete
  using (current_role_name() in ('sdao_shs', 'system_admin'));

insert into shs_classrooms (name, sort_order) values
  ('101', 1),
  ('102', 2),
  ('103', 3),
  ('104', 4),
  ('105', 5),
  ('106', 6),
  ('107', 7),
  ('108', 8),
  ('Advising Room 1', 9),
  ('Advising Room 2', 10);

-- ---------- 3. shs_venue_requests ----------

create table shs_venue_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  classroom_id uuid not null references shs_classrooms(id),
  purpose text not null,
  request_date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'pending_sdao_shs'
    check (status in ('pending_sdao_shs', 'pending_principal', 'approved', 'rejected', 'cancelled')),
  sdao_shs_reviewer_id uuid references profiles(id),
  sdao_shs_decided_at timestamptz,
  sdao_shs_comment text,
  principal_reviewer_id uuid references profiles(id),
  principal_decided_at timestamptz,
  principal_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shs_venue_requests_time_order check (end_time > start_time)
);

create index idx_shs_venue_requests_requester on shs_venue_requests(requester_id);
create index idx_shs_venue_requests_classroom_date on shs_venue_requests(classroom_id, request_date) where status = 'approved';
create index idx_shs_venue_requests_status on shs_venue_requests(status);

comment on table shs_venue_requests is
  'Faculty -> SDAO-SHS -> SHS Principal room-booking chain. All status transitions go through decide_shs_venue_request()/cancel_shs_venue_request() (security definer) rather than direct UPDATE — see the lack of UPDATE policies below.';

alter table shs_venue_requests enable row level security;

-- Faculty sees their own requests (any status) so they can track them.
create policy shs_venue_requests_select_own
  on shs_venue_requests for select
  using (requester_id = auth.uid());

-- Any Faculty account can additionally see APPROVED requests generally
-- (not just their own) — needed so the Calendar/booking form can show
-- which classroom+date+time slots are already taken before they submit.
create policy shs_venue_requests_select_faculty_approved
  on shs_venue_requests for select
  using (current_role_name() = 'shs_faculty' and status = 'approved');

-- SDAO-SHS and SHS Principal see every SHS venue request, any status —
-- that's the approval queue.
create policy shs_venue_requests_select_reviewer
  on shs_venue_requests for select
  using (is_shs_reviewer());

-- Faculty may only create a request for themselves, and it always
-- starts at the first stage.
create policy shs_venue_requests_insert_own
  on shs_venue_requests for insert
  with check (
    current_role_name() = 'shs_faculty'
    and requester_id = auth.uid()
    and status = 'pending_sdao_shs'
  );

-- No UPDATE/DELETE policies on purpose — every status transition
-- (SDAO-SHS decision, Principal decision, cancellation) goes through
-- the security-definer functions below, which run the real
-- role/stage/conflict checks in one place instead of trying to express
-- "who can flip which status to which other status" in RLS alone.

-- ---------- 4. Approval chain: decide_shs_venue_request ----------

create or replace function decide_shs_venue_request(p_request_id uuid, p_decision text, p_comment text default null)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_role text := current_role_name();
  v_req shs_venue_requests%rowtype;
begin
  if v_role not in ('sdao_shs', 'shs_principal') then
    raise exception 'Only SDAO-SHS or the SHS Principal can decide on venue requests';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision';
  end if;

  select * into v_req from shs_venue_requests where id = p_request_id for update;
  if v_req is null then
    raise exception 'Venue request not found';
  end if;

  if v_role = 'sdao_shs' then
    if v_req.status <> 'pending_sdao_shs' then
      raise exception 'This request is not awaiting SDAO-SHS review';
    end if;
    update shs_venue_requests set
      status = case when p_decision = 'approved' then 'pending_principal' else 'rejected' end,
      sdao_shs_reviewer_id = auth.uid(),
      sdao_shs_decided_at = now(),
      sdao_shs_comment = p_comment,
      updated_at = now()
    where id = p_request_id;

  else -- shs_principal
    if v_req.status <> 'pending_principal' then
      raise exception 'This request is not awaiting Principal review';
    end if;

    if p_decision = 'approved' then
      -- Hard server-side double-booking guard: no two APPROVED requests
      -- may hold the same classroom on the same date with overlapping
      -- times. (SDAO-SHS's earlier sign-off doesn't block the room yet —
      -- only a Principal-approved request does, per spec.)
      if exists (
        select 1 from shs_venue_requests r
        where r.classroom_id = v_req.classroom_id
          and r.request_date = v_req.request_date
          and r.status = 'approved'
          and r.id <> v_req.id
          and r.start_time < v_req.end_time
          and r.end_time > v_req.start_time
      ) then
        raise exception 'This classroom already has an approved booking that overlaps this date and time.';
      end if;
    end if;

    update shs_venue_requests set
      status = case when p_decision = 'approved' then 'approved' else 'rejected' end,
      principal_reviewer_id = auth.uid(),
      principal_decided_at = now(),
      principal_comment = p_comment,
      updated_at = now()
    where id = p_request_id;
  end if;

  return jsonb_build_object('ok', true, 'status', (select status from shs_venue_requests where id = p_request_id));
end;
$$;

grant execute on function decide_shs_venue_request(uuid, text, text) to authenticated;

-- ---------- 5. cancel_shs_venue_request ----------
-- Faculty can withdraw their own request at any still-open or already
-- approved stage (freeing the room). SDAO-SHS/Principal can also
-- cancel on a Faculty member's behalf (e.g. a phoned-in change).

create or replace function cancel_shs_venue_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_role text := current_role_name();
  v_req shs_venue_requests%rowtype;
begin
  select * into v_req from shs_venue_requests where id = p_request_id for update;
  if v_req is null then
    raise exception 'Venue request not found';
  end if;

  if v_role = 'shs_faculty' then
    if v_req.requester_id <> auth.uid() then
      raise exception 'You can only cancel your own venue requests';
    end if;
  elsif v_role not in ('sdao_shs', 'shs_principal') then
    raise exception 'Not permitted';
  end if;

  if v_req.status in ('rejected', 'cancelled') then
    raise exception 'This request is already closed';
  end if;

  update shs_venue_requests set status = 'cancelled', updated_at = now() where id = p_request_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function cancel_shs_venue_request(uuid) to authenticated;
