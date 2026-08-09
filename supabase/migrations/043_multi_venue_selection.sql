-- Adds multi-venue selection support to submissions and events.
--
-- Previously each event/day could only book a single venue (`venue_id`).
-- Applicants can now check off multiple venues for the same day (e.g. an
-- event that spans the Auditorium AND the Multi-Sports Center on the same
-- date). `venue_id` is kept and still points at the FIRST selected venue,
-- so all existing joins, conflict checks, calendar filters, and PDF/report
-- logic that read a single venue_id keep working unchanged. The full set
-- of selected venues now lives in `venue_ids`.
--
-- `venue_details` mirrors this as a per-venue map of the free-text detail
-- (which specific room, which lab, or the "Others" description) since a
-- single `venue_detail` text column can no longer hold more than one
-- venue's worth of detail.
--
-- For multi-day events, each entry inside `event_dates` (jsonb) now carries
-- its own `venue_ids` (array) and `venue_details` (object) instead of a
-- single `venue_id`/`venue_detail` pair. Existing single-venue rows remain
-- readable — the UI/app layer treats a legacy `venue_id` entry as a
-- one-item `venue_ids` array.

alter table submissions
  add column if not exists venue_ids uuid[] not null default '{}',
  add column if not exists venue_details jsonb not null default '{}'::jsonb;

alter table events
  add column if not exists venue_ids uuid[] not null default '{}',
  add column if not exists venue_details jsonb not null default '{}'::jsonb;

comment on column submissions.venue_ids is
  'All venues selected for this submission (single-day) or its first/primary day. venue_id mirrors venue_ids[1] for backward compatibility.';
comment on column submissions.venue_details is
  'Map of venue_id -> free-text detail (room, lab, or "Others" description) for each entry in venue_ids.';
comment on column events.venue_ids is
  'All venues booked for this event (single-day) or its first/primary day. venue_id mirrors venue_ids[1] for backward compatibility.';
comment on column events.venue_details is
  'Map of venue_id -> free-text detail (room, lab, or "Others" description) for each entry in venue_ids.';

create index if not exists idx_submissions_venue_ids on submissions using gin (venue_ids);
create index if not exists idx_events_venue_ids on events using gin (venue_ids);
