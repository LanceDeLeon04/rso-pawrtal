-- ============================================================
-- 037: Add 'merchandise' submission type + 'marketing_rep' role
-- ============================================================
-- Org Merchandise Proposals reuse the exact same Submission Bin /
-- approval-chain machinery as Event Applications (Adviser -> Dean ->
-- <external rep> -> SDAO Assistant -> SDAO Supervisor -> Academic
-- Director) — the only differences are: no SDG section (replaced by
-- a Types of Merchandise checklist) and the last external link is a
-- Marketing reviewer instead of an SDG Representative.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction as
-- statements that reference the new value, so this is kept as its
-- own migration file (038 adds the columns/functions that use it).
alter type submission_type add value if not exists 'merchandise';
alter type approval_link_role add value if not exists 'marketing_rep';
