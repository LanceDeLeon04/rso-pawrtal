-- ============================================================
-- 031: Room / Laboratory cascading picklists
-- ============================================================
-- When Venue = 'Room' on the event application form, the applicant
-- now picks Building -> Floor -> Room (each dropdown filtered by the
-- one before it) instead of typing a free-text room number.
-- When Venue = 'Laboratory', the applicant picks from a fixed list of
-- labs, and the "care of" office + location are auto-filled from the
-- selected lab (read-only, not typed).
--
-- SDAO, Facilities (FMO) and Admin can add, edit, or delete rooms and
-- labs from Settings — same role set already used for venue_blocks /
-- restricted_periods.

create table venue_rooms (
  id uuid primary key default gen_random_uuid(),
  building text not null,
  floor text not null,
  room_number text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (building, floor, room_number)
);

create table venue_labs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  care_of text not null,
  location text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table venue_rooms enable row level security;
alter table venue_labs enable row level security;

-- Everyone signed in can see the list (needed to populate the
-- dropdowns on the application form for every role).
create policy "venue_rooms_select_all"
  on venue_rooms for select
  using (auth.role() = 'authenticated');

create policy "venue_labs_select_all"
  on venue_labs for select
  using (auth.role() = 'authenticated');

-- Only SDAO / Facilities (FMO) / Admin-tier roles can maintain the
-- lists — same role set as venue_blocks and restricted_periods.
create policy "venue_rooms_write_fmo_admin"
  on venue_rooms for insert
  with check (current_role_name() in ('fmo', 'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor', 'academic_director', 'system_admin'));
create policy "venue_rooms_update_fmo_admin"
  on venue_rooms for update
  using (current_role_name() in ('fmo', 'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor', 'academic_director', 'system_admin'));
create policy "venue_rooms_delete_fmo_admin"
  on venue_rooms for delete
  using (current_role_name() in ('fmo', 'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor', 'academic_director', 'system_admin'));

create policy "venue_labs_write_fmo_admin"
  on venue_labs for insert
  with check (current_role_name() in ('fmo', 'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor', 'academic_director', 'system_admin'));
create policy "venue_labs_update_fmo_admin"
  on venue_labs for update
  using (current_role_name() in ('fmo', 'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor', 'academic_director', 'system_admin'));
create policy "venue_labs_delete_fmo_admin"
  on venue_labs for delete
  using (current_role_name() in ('fmo', 'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor', 'academic_director', 'system_admin'));

-- ---------- Seed: rooms ----------
insert into venue_rooms (building, floor, room_number, sort_order) values
  ('Henry Sy Sr. (Educ)', '2nd', '203', 1),
  ('Henry Sy Sr. (Educ)', '2nd', '204', 2),
  ('Henry Sy Sr. (Educ)', '3rd', '301', 1),
  ('Henry Sy Sr. (Educ)', '3rd', '302', 2),
  ('Henry Sy Sr. (Educ)', '3rd', '303', 3),
  ('Henry Sy Sr. (Educ)', '3rd', '304', 4),
  ('Henry Sy Sr. (Educ)', '3rd', '305', 5),
  ('Henry Sy Sr. (Educ)', '3rd', '306', 6),
  ('Henry Sy Sr. (Educ)', '3rd', '307', 7),
  ('Henry Sy Sr. (Educ)', '3rd', '308', 8),
  ('Henry Sy Sr. (Educ)', '3rd', '309', 9),
  ('Henry Sy Sr. (Educ)', '3rd', '310', 10),
  ('Henry Sy Sr. (Educ)', '3rd', '311', 11),
  ('Henry Sy Sr. (Educ)', '3rd', '312', 12),
  ('Henry Sy Sr. (Educ)', '3rd', '313', 13),
  ('Henry Sy Sr. (Educ)', '4th', '401', 1),
  ('Henry Sy Sr. (Educ)', '4th', '402', 2),
  ('Henry Sy Sr. (Educ)', '4th', '403', 3),
  ('Henry Sy Sr. (Educ)', '4th', '404', 4),
  ('Henry Sy Sr. (Educ)', '4th', '405', 5),
  ('Henry Sy Sr. (Educ)', '4th', '406', 6),
  ('Henry Sy Sr. (Educ)', '4th', '407', 7),
  ('Henry Sy Sr. (Educ)', '4th', '408', 8),
  ('Henry Sy Sr. (Educ)', '4th', '409', 9),
  ('Henry Sy Sr. (Educ)', '4th', '410', 10),
  ('Henry Sy Sr. (Educ)', '4th', '411', 11),
  ('Henry Sy Sr. (Educ)', '4th', '412', 12),
  ('Henry Sy Sr. (Educ)', '4th', '413', 13),
  ('INSPIRE', '2.1', 'Dynamic 1', 1),
  ('INSPIRE', '2.1', 'Dynamic 2', 2),
  ('INSPIRE', '2.1', 'Dynamic 3', 3),
  ('INSPIRE', '2.1', 'Dynamic 4', 4),
  ('INSPIRE', '2.1', 'Dynamic 5', 5),
  ('INSPIRE', '2.2', 'Mezz 1', 1),
  ('INSPIRE', '2.2', 'Mezz 2', 2),
  ('INSPIRE', '2.2', 'Mezz 3', 3),
  ('INSPIRE', '2.2', 'Mezz 4', 4),
  ('INSPIRE', '2.2', 'Mezz 5', 5),
  ('INSPIRE', '2.2', 'Mezz 6', 6);

-- ---------- Seed: labs ----------
insert into venue_labs (name, care_of, location, sort_order) values
  ('Hydraulics Lab', 'School of Engineering and Architecture', '5th Flr, HSSH', 1),
  ('Computer Laboratory 1', 'Information Technology Services Office', '2nd Flr, HSSH', 2),
  ('Computer Laboratory 2', 'Information Technology Services Office', '2nd Flr, HSSH', 3),
  ('Computer Laboratory 3', 'Information Technology Services Office', '2nd Flr, HSSH', 4),
  ('Computer Laboratory 4', 'Information Technology Services Office', '2nd Flr, HSSH', 5),
  ('Computer Laboratory 5', 'Information Technology Services Office', '2nd Flr, HSSH', 6),
  ('Computer Laboratory 6', 'Information Technology Services Office', '2nd Flr, HSSH', 7),
  ('AcadArena Laboratory', 'Information Technology Services Office', '2nd Flr, HSSH', 8),
  ('Physics Laboratory 1', 'School of Arts and Sciences', '2nd Flr, HSSH', 9),
  ('Physics Laboratory 2', 'School of Arts and Sciences', '2nd Flr, HSSH', 10),
  ('Psychology Laboratory', 'Program Chair of BS Psychology', '2nd Flr, HSSH', 11),
  ('Criminology Laboratory 1', 'Program Chair of BS Criminology', '5th Flr, HSSH', 12),
  ('Criminology Laboratory 2', 'Program Chair of BS Criminology', '5th Flr, HSSH', 13),
  ('Chemistry Laboratory 1', 'School of Arts and Sciences', '5th Flr, HSSH', 14),
  ('Chemistry Laboratory 2', 'School of Arts and Sciences', '5th Flr, HSSH', 15),
  ('ESS Laboratory', 'Program Chair of BSESS', '2nd Flr, HSSH', 16),
  ('Geotech / Surveying Laboratory', 'School of Engineering and Architecture', '5th Flr, HSSH', 17),
  ('Electrical / Electronic Laboratory', 'School of Engineering and Architecture', '5th Flr, HSSH', 18),
  ('Photography Studio', 'Program Chair of BMMA', '5th Flr, HSSH', 19),
  ('Recording Studio', 'Program Chair of BMMA', '5th Flr, HSSH', 20),
  ('Tourism Lab / Travel Agency', 'Program Chair of BSTM', '5th Flr, HSSH', 21);
