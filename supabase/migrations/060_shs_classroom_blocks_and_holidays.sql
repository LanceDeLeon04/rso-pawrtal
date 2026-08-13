-- ============================================================
-- 060: SDAO-SHS date blocking + SHS holidays
-- ============================================================
-- Exam periods already work for SHS (052b: restricted_periods_write_shs,
-- is_shs_reviewer() + kind = 'exam_period' + department = 'shs'). Two
-- gaps remain:
--   1. No way to hard-block a specific SHS classroom+date the way FMO
--      hard-blocks a College venue (venue_blocks, migration 027) — a
--      Faculty Venue Request currently has nothing stopping it from
--      being submitted/approved on a day SDAO-SHS needs the room held
--      (maintenance, an SHS-only event, etc).
--   2. Holidays on restricted_periods are College/university-wide only
--      (restricted_periods_write_fmo_admin, migration 028) — SDAO-SHS
--      has no way to flag an SHS-specific holiday. University-wide
--      holidays (department is null) stay FMO/admin-only, unchanged.

-- ---------- 1. shs_classroom_blocks (hard block, mirrors venue_blocks) ----------

create table shs_classroom_blocks (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references shs_classrooms(id) on delete cascade,
  block_date date not null,
  reason text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (classroom_id, block_date)
);

comment on table shs_classroom_blocks is
  'Hard block on an SHS classroom for a given date (maintenance, SDAO-SHS-held event, etc) — Faculty cannot submit or have approved a Venue Request against a blocked classroom+date. Mirrors venue_blocks (027) but scoped to the SHS sub-system; kept out of venue_blocks itself since shs_classrooms is deliberately a separate table from venue_rooms (055).';

create index idx_shs_classroom_blocks_date on shs_classroom_blocks(classroom_id, block_date);

alter table shs_classroom_blocks enable row level security;

-- Visible only to the SHS-context roles that work inside this
-- sub-system, same narrow visibility rule as approved shs_venue_requests
-- (054) — this must NOT leak onto the College calendar/full-admin view.
create policy shs_classroom_blocks_select
  on shs_classroom_blocks for select
  using (current_role_name() in ('shs_faculty', 'sdao_shs', 'shs_principal') or is_shs_faculty_moderator());

-- Only SDAO-SHS maintains blocks — same ownership split as
-- shs_classrooms itself (055): SHS Principal's role in this sub-system
-- is approval, not room/schedule upkeep.
create policy shs_classroom_blocks_write
  on shs_classroom_blocks for insert
  with check (current_role_name() in ('sdao_shs', 'system_admin'));

create policy shs_classroom_blocks_delete
  on shs_classroom_blocks for delete
  using (current_role_name() in ('sdao_shs', 'system_admin'));

-- ---------- 2. Enforce the block in the Faculty request flow ----------

-- Stop a request from ever being submitted for a blocked classroom+date.
drop policy if exists shs_venue_requests_insert_own on shs_venue_requests;
create policy shs_venue_requests_insert_own
  on shs_venue_requests for insert
  with check (
    (current_role_name() = 'shs_faculty' or is_shs_faculty_moderator())
    and requester_id = auth.uid()
    and status = 'pending_sdao_shs'
    and not exists (
      select 1 from shs_classroom_blocks b
      where b.classroom_id = shs_venue_requests.classroom_id
        and b.block_date = shs_venue_requests.request_date
    )
  );

-- Belt-and-suspenders server-side guard: a block placed AFTER a request
-- was already submitted must still stop it reaching 'approved' (same
-- spirit as the existing double-booking guard in this function).
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
      if exists (
        select 1 from shs_classroom_blocks b
        where b.classroom_id = v_req.classroom_id
          and b.block_date = v_req.request_date
      ) then
        raise exception 'This classroom is blocked by SDAO-SHS on this date.';
      end if;

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

-- ---------- 3. SHS holidays on restricted_periods ----------
-- restricted_periods_write_fmo_admin (028) only covers FMO/admin-tier.
-- SDAO-SHS gets its own additive insert/update/delete policies, same
-- shape as 052b's exam_period ones, just for kind = 'holiday'. This
-- does NOT touch university-wide holidays (department is null) — those
-- stay FMO/admin-only; this only lets SDAO-SHS flag department = 'shs'
-- holidays (e.g. an SHS-only in-service day) alongside its existing
-- exam_period rows.
create policy restricted_periods_write_shs_holiday on restricted_periods for insert
  with check (is_shs_reviewer() and kind = 'holiday' and department = 'shs');

create policy restricted_periods_update_shs_holiday on restricted_periods for update
  using (is_shs_reviewer() and kind = 'holiday' and department = 'shs');

create policy restricted_periods_delete_shs_holiday on restricted_periods for delete
  using (is_shs_reviewer() and kind = 'holiday' and department = 'shs');
