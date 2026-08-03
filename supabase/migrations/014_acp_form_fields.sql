-- ============================================================
-- 014: ACP form fields on submissions (no more manual ACP upload)
-- ============================================================
-- The Activity Concept Paper's fields now live directly on the event
-- application form in-app (everything except the Signatories section,
-- which doesn't make sense for a digital submission). On submit, the
-- app renders these back into a filled ACP Form PDF and attaches it
-- automatically — no manual upload needed.
alter table submissions add column if not exists position text;
alter table submissions add column if not exists email text;
alter table submissions add column if not exists activity_type text;
alter table submissions add column if not exists activity_type_other text;
alter table submissions add column if not exists target_audience text;
alter table submissions add column if not exists target_participants integer;
alter table submissions add column if not exists projected_budget numeric(12,2);
alter table submissions add column if not exists budget_source text;
alter table submissions add column if not exists sdgs text[] not null default '{}';
alter table submissions add column if not exists sdg_representative text;
alter table submissions add column if not exists learning_goals text[] not null default '{}';
