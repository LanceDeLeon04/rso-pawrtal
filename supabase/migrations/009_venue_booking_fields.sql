-- ============================================================
-- Migration 009 — Venue list + pencil-booking confirmation
-- Seeds the official campus venue list and adds the fields needed to
-- capture: which office the venue is tagged to (Facilities Office vs
-- INSPIRE Office), whether it's already been pencil-booked with that
-- office, the free-text detail for Room/Laboratory/Others, and — for
-- Laboratory specifically — whether the lab owner has endorsed it.
-- ============================================================

insert into venues (name, is_active) values
  ('Auditorium', true),
  ('Multi-Sports Center', true),
  ('INSPIRE Lounge', true),
  ('Hoops Center', true),
  ('Wellness Center', true),
  ('High Performance Gym', true),
  ('AGETAC Pool', true),
  ('Driveway', true),
  ('Football Pitch', true),
  ('Room', true),
  ('Laboratory', true),
  ('LRC', true),
  ('Others', true)
on conflict (name) do nothing;

alter table submissions
  -- Free-text specifics for Room ("identify room number"), Laboratory
  -- ("identify which lab"), and Others ("specify").
  add column venue_detail text,
  -- Auto-derived from the selected venue, shown to the submitter and
  -- stored for reporting: 'Facilities Office' | 'INSPIRE Office' | null.
  add column venue_tag text,
  -- "Ensure you have pencil booked this with INSPIRE or Facilities
  -- Office before submitting" — the submitter's Y/N answer.
  add column pencil_booked boolean,
  -- Laboratory only: "Endorsed by Laboratory Owner e.g. ComLab (ITSO)?"
  add column lab_endorsed boolean;
