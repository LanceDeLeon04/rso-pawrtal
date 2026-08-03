-- ============================================================
-- 016: assistant-assigned report submission date for continuing activities
-- ============================================================
-- Year-Round / Term activities don't have a single event date, so the
-- usual "event_date + 7 days" rule can't be used to set the Post-Activity
-- Report / clearance deadline. Instead, the SDAO Assistant must manually
-- assign a report submission date before forwarding a Year-Round or Term
-- application to the Supervisor. That date is then used as the clearance
-- deadline once the application is fully approved.
alter table submissions add column if not exists report_submission_date date;
