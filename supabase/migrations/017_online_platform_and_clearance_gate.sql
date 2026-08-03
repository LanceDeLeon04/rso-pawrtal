-- ============================================================
-- 017: online medium platform field + relax clearance gate
-- ============================================================

-- (a) "Medium" is now picked before "Venue" on the Event Application
-- form. When medium = 'online', the org picks a platform (MS Teams,
-- Facebook, Others) instead of a physical venue, so venue_id is no
-- longer required for online activities. online_platform stores the
-- picked platform; venue_detail continues to double as the free-text
-- "specify" box (e.g. when platform = 'others').
alter table submissions add column if not exists online_platform text; -- 'ms_teams' | 'facebook' | 'others'

-- (b) Clearance gate previously blocked a new Event Application
-- submission whenever the org had ANY open clearance — including one
-- that was merely 'pending' (i.e. still on-going, year-round or
-- per-term, with its deadline not yet passed). That's too strict:
-- an org should only be blocked once a clearance is actually
-- 'overdue' (its deadline has passed). Recreate the insert policy so
-- only 'overdue' clearances gate new event applications.
drop policy if exists submissions_insert on submissions;

create policy submissions_insert on submissions for insert
  with check (
    org_id in (select org_id from org_memberships where profile_id = auth.uid())
    and (
      -- clearance gate only blocks new event applications, never the
      -- report submission that would resolve the clearance itself
      type = 'report'
      or not exists (
        select 1 from clearances
        where org_id = submissions.org_id and status = 'overdue'
      )
    )
  );
