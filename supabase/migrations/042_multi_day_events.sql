-- Adds Multi-Day Event support to submissions and events.
--
-- A multi-day event keeps `event_date` / `start_time` / `end_time` pointed
-- at its EARLIEST date (so existing sorting, calendar, and clearance-deadline
-- logic that reads a single event_date keeps working unchanged), and stores
-- the full list of dates/times in `event_dates` (jsonb array of
-- { event_date, start_time, end_time }) plus an `is_multi_day` flag used to
-- decide how the Date field is rendered on the generated ACP Form.

alter table submissions
  add column if not exists is_multi_day boolean not null default false,
  add column if not exists event_dates jsonb;

alter table events
  add column if not exists is_multi_day boolean not null default false,
  add column if not exists event_dates jsonb;

comment on column submissions.event_dates is
  'Array of {event_date, start_time, end_time} entries for multi-day events. Null/empty for single-day and continuing/year-round activities.';
comment on column events.event_dates is
  'Array of {event_date, start_time, end_time} entries for multi-day events. Null/empty for single-day and continuing/year-round activities.';
