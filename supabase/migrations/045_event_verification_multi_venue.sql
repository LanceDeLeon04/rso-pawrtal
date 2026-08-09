-- Extends get_event_verification() (021) to also return `venue_names`
-- (every venue in events.venue_ids) so the public QR verification page
-- can list all venues for events that book more than one.
create or replace function get_event_verification(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events;
  v_org organizations;
  v_venue venues;
  v_approver profiles;
begin
  select * into v_event from events where verification_token = p_token;
  if v_event is null then
    return jsonb_build_object('error', 'invalid');
  end if;

  select * into v_org from organizations where id = v_event.org_id;
  select * into v_venue from venues where id = v_event.venue_id;
  if v_event.approved_by is not null then
    select * into v_approver from profiles where id = v_event.approved_by;
  end if;

  return jsonb_build_object(
    'valid', v_event.approved_at is not null,
    'event', jsonb_build_object(
      'title', v_event.title,
      'venue', coalesce(v_venue.name, '—'),
      'venue_names', (
        select coalesce(jsonb_agg(name order by name), '[]'::jsonb)
        from venues where id = any(coalesce(v_event.venue_ids, array[]::uuid[]))
      ),
      'event_date', v_event.event_date,
      'start_time', v_event.start_time,
      'end_time', v_event.end_time,
      'medium', v_event.medium,
      'booking_status', v_event.booking_status,
      'approved_at', v_event.approved_at,
      'approved_by', coalesce(v_approver.full_name, '—'),
      'organization', coalesce(v_org.name, '—'),
      'organization_acronym', coalesce(v_org.acronym, '')
    )
  );
end;
$$;

grant execute on function get_event_verification(text) to anon, authenticated;
