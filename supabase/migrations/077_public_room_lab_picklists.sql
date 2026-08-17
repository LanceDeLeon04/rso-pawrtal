-- ============================================================
-- 077: Public room/lab picklists on the Curricular Activity apply
-- form. The apply form (src/pages/CurricularApply.jsx) is a public,
-- unauthenticated page reached via a shareable token link — same as
-- venues/venue_blocks/events, venue_rooms and venue_labs need to be
-- readable by anon too so faculty can pick Building/Floor/Room or
-- Laboratory the same way RSO officers do on the Event Application.
-- Nothing sensitive here (just facility names/locations), and write
-- access is unchanged — still SDAO/FMO/Admin-tier only.
-- ============================================================

drop policy if exists "venue_rooms_select_all" on venue_rooms;
create policy "venue_rooms_select_all"
  on venue_rooms for select
  using (true);

drop policy if exists "venue_labs_select_all" on venue_labs;
create policy "venue_labs_select_all"
  on venue_labs for select
  using (true);
