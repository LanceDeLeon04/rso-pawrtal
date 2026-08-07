-- ============================================================
-- 027: FMO calendar powers — venue blocks + reschedule access
-- ============================================================
-- Kept as its own migration since it references the 'fmo' enum value
-- added in 026 (can't be used in the same transaction it's added in).

-- ---------- VENUE BLOCKS ----------
-- A blocked date for a specific venue. Shown on the Calendar of
-- Activities like a booking, but isn't tied to an event/submission —
-- it just marks the venue unavailable (e.g. maintenance, holiday).
create table venue_blocks (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  block_date date not null,
  reason text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (venue_id, block_date)
);

alter table venue_blocks enable row level security;

-- Everyone signed in can see blocked dates (needed so the calendar
-- renders them for all roles, same as events).
create policy "venue_blocks_select_all"
  on venue_blocks for select
  using (auth.role() = 'authenticated');

-- Only FMO and admin-tier roles can block/unblock dates.
create policy "venue_blocks_write_fmo_admin"
  on venue_blocks for insert
  with check (current_role_name() in ('fmo', 'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor', 'academic_director', 'system_admin'));

create policy "venue_blocks_delete_fmo_admin"
  on venue_blocks for delete
  using (current_role_name() in ('fmo', 'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor', 'academic_director', 'system_admin'));

-- ---------- RESCHEDULE (MOVE) EXISTING BOOKINGS ----------
-- FMO needs to move an event's date/time/venue directly from the
-- calendar. Admin-tier roles already have broader update policies
-- elsewhere; this adds the same update ability scoped to FMO.
create policy "events_update_fmo_reschedule"
  on events for update
  using (current_role_name() = 'fmo')
  with check (current_role_name() = 'fmo');
