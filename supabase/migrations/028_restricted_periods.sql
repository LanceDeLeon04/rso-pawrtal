-- ============================================================
-- 028: Restricted periods (holidays / exam week) — advisory,
-- not a hard block like venue_blocks.
-- ============================================================
-- Admin-tier roles, QMO, and FMO can flag date ranges (holidays,
-- exam week + the week immediately before it) as periods where
-- booking a new activity is discouraged. Unlike venue_blocks, this
-- is calendar-wide (not tied to a specific venue) and does NOT
-- prevent submission — it's shown as a notice on the Calendar and
-- on the Event Application form, and the applicant has to
-- acknowledge it (extraordinary-circumstances) before submitting.

create table restricted_periods (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('holiday', 'exam_period')),
  label text not null,
  start_date date not null,
  end_date date not null,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint restricted_periods_date_check check (end_date >= start_date)
);

create index idx_restricted_periods_range on restricted_periods(start_date, end_date);

alter table restricted_periods enable row level security;

-- Everyone signed in can see restricted periods (needed so the
-- calendar and the application form can both surface the notice).
create policy "restricted_periods_select_all"
  on restricted_periods for select
  using (auth.role() = 'authenticated');

-- Only admin-tier roles (includes SDAO, QMO) and FMO can schedule or
-- remove a restricted period — same role set as venue_blocks.
create policy "restricted_periods_write_fmo_admin"
  on restricted_periods for insert
  with check (current_role_name() in ('fmo', 'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor', 'academic_director', 'system_admin'));

create policy "restricted_periods_delete_fmo_admin"
  on restricted_periods for delete
  using (current_role_name() in ('fmo', 'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor', 'academic_director', 'system_admin'));

create policy "restricted_periods_update_fmo_admin"
  on restricted_periods for update
  using (current_role_name() in ('fmo', 'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor', 'academic_director', 'system_admin'));

-- ---------- Applicant acknowledgment ----------
-- Recorded on the submission when the chosen event_date fell inside a
-- restricted period, so reviewers can see the applicant knowingly
-- proceeded and why (extraordinary-circumstances justification).
alter table submissions add column if not exists restricted_period_ack boolean not null default false;
alter table submissions add column if not exists restricted_period_justification text;
