-- ============================================================
-- 075: Hybrid medium
-- ============================================================
-- Curricular Activity applications can now be marked "Hybrid" (both
-- face-to-face and online) instead of forcing a single medium. Adds
-- the enum value only — venue_id/venue_detail (f2f) and
-- online_platform (online) already coexist fine on one row, so no
-- other schema change is needed. The UI simply shows both the venue
-- fields and the online-platform field when medium = 'hybrid'.
--
-- ALTER TYPE ... ADD VALUE cannot be used inside the same transaction
-- as a statement that reads the new value, but that's not a problem
-- here since submit_curricular_activity() only casts to it in later
-- (separate) transactions/sessions.
-- ============================================================

alter type activity_medium add value if not exists 'hybrid';
