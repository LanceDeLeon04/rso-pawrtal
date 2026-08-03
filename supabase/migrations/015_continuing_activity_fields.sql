-- ============================================================
-- 015: continuing/year-round/term activity flag for the ACP form
-- ============================================================
-- Some activities aren't a single-date event (ongoing programs, weekly
-- practices, term-long initiatives). This lets the ACP Form print
-- "Year-Round" or "Term <label>" in the Date field instead of a literal
-- date, while the actual event_date on the submission/event stays as
-- the effective start date used for calendar scheduling and clearance
-- deadlines.
alter table submissions add column if not exists is_continuing boolean not null default false;
alter table submissions add column if not exists continuing_type text; -- 'year_round' | 'term'
alter table submissions add column if not exists term_label text;
