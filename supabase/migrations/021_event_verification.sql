-- ============================================================
-- 021: Event verification (QR code on the approved ACP Form)
-- ============================================================
-- The moment an event application is approved, the ACP Form PDF is
-- regenerated with a QR code baked in. Scanning it opens a public,
-- read-only page confirming the event is on record: Event Name,
-- Venue, Date, Approved on, Approved by. This mirrors the
-- token + security-definer-RPC pattern already used for the
-- Adviser/Dean approval links (see 019_external_approval_links.sql),
-- so the same, already-battle-tested access model is reused rather
-- than exposing the events table to anon reads directly.

alter table events
  add column if not exists approved_by uuid references profiles(id),
  add column if not exists approved_at timestamptz,
  add column if not exists verification_token text unique;

create index if not exists idx_events_verification_token on events(verification_token);

-- ------------------------------------------------------------
-- ensure_event_verification_token(event_id)
-- Called right when a submission is approved. Idempotent — if the
-- event already has a token (e.g. re-approved after being reopened),
-- the existing one is kept so any previously printed/shared QR code
-- keeps working.
-- ------------------------------------------------------------
create or replace function ensure_event_verification_token(p_event_id uuid)
returns events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events;
  v_token text;
begin
  select * into v_event from events where id = p_event_id;
  if v_event is null then
    raise exception 'Event not found';
  end if;

  if not is_admin_tier() then
    raise exception 'Not authorized';
  end if;

  if v_event.verification_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    update events set
      verification_token = v_token,
      approved_by = coalesce(approved_by, auth.uid()),
      approved_at = coalesce(approved_at, now())
    where id = p_event_id
    returning * into v_event;
  else
    update events set
      approved_by = coalesce(approved_by, auth.uid()),
      approved_at = coalesce(approved_at, now())
    where id = p_event_id
    returning * into v_event;
  end if;

  return v_event;
end;
$$;

grant execute on function ensure_event_verification_token(uuid) to authenticated;

-- ------------------------------------------------------------
-- get_event_verification(token)
-- Public (anon) entry point behind the QR code / verification page.
-- Only ever resolves a token into the small set of fields printed on
-- the page — never the full event or submission record.
-- ------------------------------------------------------------
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
