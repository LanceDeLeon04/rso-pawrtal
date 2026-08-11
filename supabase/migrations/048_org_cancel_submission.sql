-- ============================================================
-- 048: Let an org cancel its own submission before it's approved
-- ============================================================
-- Previously the only way out of the approval chain was for a
-- reviewer to return/reject it, or for an admin to delete it outright.
-- Orgs can now withdraw their own Event Application / Merchandise
-- Proposal themselves, as long as the Academic Director hasn't
-- approved it yet (stage isn't already 'approved', and it isn't
-- already 'rejected' or 'cancelled').
--
-- Split into two files (048 / 048a) on purpose: Postgres won't let a
-- freshly-added enum value be *used* (e.g. cast in a policy's `with
-- check`) in the same transaction that added it via `alter type ...
-- add value` (error 55P04, "unsafe use of new value ... must be
-- committed before they can be used"). Since the Supabase CLI runs
-- each migration file as its own transaction, the add-value has to
-- live in a file by itself so it commits before 048a references it.

alter type submission_stage add value if not exists 'cancelled';
