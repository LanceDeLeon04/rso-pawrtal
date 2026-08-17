// Shared venue-availability logic — originally lived only inside
// SubmissionBin.jsx (RSO Event Application). Extracted so the public
// Curricular Activity apply form (CurricularApply.jsx) can show the
// exact same blocked-venue / already-booked / heads-up notices instead
// of only finding out at review time.
//
// A venue is unavailable for a date if it's already 'pencil' booked or
// 'reserved' by another activity's events row, or admin/FMO has marked
// that date 'blocked' for maintenance/holidays via venue_blocks.
// 'cancelled' and 'returned' bookings don't hold the slot.
// Bookings on the same venue + date are allowed to coexist as long as
// their times don't overlap. Every booking automatically gets a 2-hour
// ingress buffer before its start and a 2-hour egress buffer after its
// end (setup/teardown) — but the venue itself can only be entered from
// 6:00 AM and must be cleared by 9:00 PM, so that buffer is capped at
// the gate hours (an event starting before 8:00 AM or ending after
// 7:00 PM won't get the full 2 hours on that side by default).
// Applicants can request additional ingress/egress time beyond that
// cap; if it goes past the gate hours, a Security Office letter is
// required.
//
// Buffers only matter against the OTHER booking's actual event time —
// i.e. a conflict is when one activity's real (unbuffered) event time
// falls inside another's buffered window. It's fine for two buffers to
// overlap each other with no real time inside either — that just means
// one activity will still be egressing while the other is ingressing —
// allowed, just flagged as a heads-up rather than blocked. Requested
// *additional* time is held to a stricter standard (see below).

export const INGRESS_EGRESS_BUFFER_MIN = 2 * 60
export const GATE_OPEN_MIN = 6 * 60   // 6:00 AM — venue can't be entered earlier
export const GATE_CLOSE_MIN = 21 * 60 // 9:00 PM — venue must be cleared by then

export function toMinutes(t) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// The event's real, unbuffered time — used to tell "another activity is
// actually happening then" apart from "another activity is merely
// setting up or tearing down then".
export function coreWindow(startTime, endTime) {
  const start = toMinutes(startTime)
  const end = toMinutes(endTime)
  if (start == null || end == null) return null
  return [start, end]
}

// Returns the [start, end] window (in minutes-from-midnight) a booking
// actually occupies: 2hr ingress/egress buffers, capped to gate hours
// (6 AM–9 PM) unless additional ingress/egress time was requested for
// that side, in which case the requested time is used instead of the
// cap. Clamped to a single day since events don't span dates.
export function bufferedWindow(startTime, endTime, additionalIngressTime, additionalEgressTime) {
  const core = coreWindow(startTime, endTime)
  if (!core) return null
  const [start, end] = core
  const normalIngress = Math.max(GATE_OPEN_MIN, start - INGRESS_EGRESS_BUFFER_MIN)
  const normalEgress = Math.min(GATE_CLOSE_MIN, end + INGRESS_EGRESS_BUFFER_MIN)
  const wantIngress = toMinutes(additionalIngressTime)
  const wantEgress = toMinutes(additionalEgressTime)
  const ingressStart = wantIngress != null ? Math.min(wantIngress, normalIngress) : normalIngress
  const egressEnd = wantEgress != null ? Math.max(wantEgress, normalEgress) : normalEgress
  return [Math.max(0, ingressStart), Math.min(24 * 60, egressEnd)]
}

export function windowsOverlap(a, b) {
  return a[0] < b[1] && b[0] < a[1]
}

// Returns null when the venue/time is clear, or
// { blocking: true, message } for a real conflict that must block
// submission, or { blocking: false, message } for a heads-up (buffer
// zones overlap, but neither activity's real time is affected).
// additionalIngressTime / additionalEgressTime are the requested
// additional-time values (if any) for the booking being checked.
export async function checkVenueAvailability(
  supabase, venueId, date, startTime, endTime, additionalIngressTime, additionalEgressTime,
) {
  if (!venueId || !date) return null

  const [{ data: existingEvents }, { data: existingBlocks }] = await Promise.all([
    supabase
      .from('events')
      .select('id, booking_status, start_time, end_time, additional_ingress_time, additional_egress_time, organizations ( acronym )')
      .eq('venue_id', venueId)
      .eq('event_date', date)
      .in('booking_status', ['pencil', 'reserved']),
    supabase
      .from('venue_blocks')
      .select('id, reason')
      .eq('venue_id', venueId)
      .eq('block_date', date),
  ])

  if (existingBlocks && existingBlocks.length > 0) {
    const reason = existingBlocks[0].reason
    return { blocking: true, message: `This venue is blocked on this date${reason ? ` (${reason})` : ''}. Please pick another date or venue.` }
  }

  if (existingEvents && existingEvents.length > 0) {
    const newCore = coreWindow(startTime, endTime)
    const newBuffered = bufferedWindow(startTime, endTime, additionalIngressTime, additionalEgressTime)
    const normalIngress = newCore ? Math.max(GATE_OPEN_MIN, newCore[0] - INGRESS_EGRESS_BUFFER_MIN) : null
    const normalEgress = newCore ? Math.min(GATE_CLOSE_MIN, newCore[1] + INGRESS_EGRESS_BUFFER_MIN) : null

    // If we don't have a concrete time range for the new booking, we
    // can't safely prove there's no overlap, so fall back to the old
    // "whole day" block.
    if (!newCore || !newBuffered) {
      const status = existingEvents[0].booking_status
      return { blocking: true, message: `This venue is already ${status === 'reserved' ? 'reserved' : 'pencil booked'} on this date by another activity. Please pick another date or venue.` }
    }

    let advisory = null
    for (const ev of existingEvents) {
      const evCore = coreWindow(ev.start_time, ev.end_time)
      const evBuffered = bufferedWindow(ev.start_time, ev.end_time, ev.additional_ingress_time, ev.additional_egress_time)
      const orgLabel = ev.organizations?.acronym || 'another activity'

      // No concrete time range for the existing booking either — can't
      // prove no overlap, fall back to a whole-day block.
      if (!evCore || !evBuffered) {
        const status = ev.booking_status
        return { blocking: true, message: `This venue is already ${status === 'reserved' ? 'reserved' : 'pencil booked'} on this date by another activity. Please pick another date or venue.` }
      }

      // Real conflict: one activity's actual event time falls inside
      // the other's buffered (ingress/egress-padded, incl. any granted
      // additional time) window.
      if (windowsOverlap(newCore, evBuffered) || windowsOverlap(evCore, newBuffered)) {
        const status = ev.booking_status
        return { blocking: true, message: `This venue is already ${status === 'reserved' ? 'reserved' : 'pencil booked'} on this date during an overlapping time (including ingress/egress buffers). Please pick another time, date, or venue.` }
      }

      // Requested *additional* time is held to a stricter standard: the
      // extra sliver beyond the normal (gate-capped) buffer can't
      // overlap another activity's core time or its egress buffer —
      // only overlapping that activity's ingress buffer is allowed.
      const evBlockingForAdditional = [evCore[0], Math.min(GATE_CLOSE_MIN, evCore[1] + INGRESS_EGRESS_BUFFER_MIN)]
      const wantIngress = toMinutes(additionalIngressTime)
      const wantEgress = toMinutes(additionalEgressTime)
      if (wantIngress != null && wantIngress < normalIngress) {
        const extraSliver = [Math.max(0, wantIngress), normalIngress]
        if (windowsOverlap(extraSliver, evBlockingForAdditional)) {
          return { blocking: true, message: `Your requested additional ingress time overlaps ${orgLabel}'s schedule at this venue. Please pick another time.` }
        }
      }
      if (wantEgress != null && wantEgress > normalEgress) {
        const extraSliver = [normalEgress, Math.min(24 * 60, wantEgress)]
        if (windowsOverlap(extraSliver, evBlockingForAdditional)) {
          return { blocking: true, message: `Your requested additional egress time overlaps ${orgLabel}'s schedule at this venue. Please pick another time.` }
        }
      }

      // Buffer-only overlap — neither activity's real time is affected,
      // just their setup/teardown windows brushing against each other.
      if (windowsOverlap(newBuffered, evBuffered)) {
        advisory = newCore[0] >= evCore[1]
          ? `Heads up: you'll be ingressing while ${orgLabel} is still egressing from this venue beforehand. This is fine — just coordinate with them on the day.`
          : `Heads up: ${orgLabel} will be ingressing while you're still egressing from this venue afterward. This is fine — just coordinate with them on the day.`
      }
    }
    if (advisory) return { blocking: false, message: advisory }
  }
  return null
}
