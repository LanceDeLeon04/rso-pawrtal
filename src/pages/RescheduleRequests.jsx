import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CalendarClock, Plus, Loader2, AlertCircle, X, Clock,
  Calendar as CalendarIcon, MapPin, User, MessageSquare, Check, Ban,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { formatTime } from '../lib/dateUtils'
import './RescheduleRequests.css'

const STATUS_META = {
  pending_assistant: { label: 'Pending SDAO Assistant', tone: 'warn' },
  pending_supervisor: { label: 'Pending SDAO Supervisor', tone: 'blue' },
  pending_director: { label: 'Pending Academic Director', tone: 'blue' },
  approved: { label: 'Approved', tone: 'ok' },
  returned: { label: 'Returned', tone: 'warn' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
}

const REVIEW_STAGE_BY_ROLE = {
  sdao_assistant: 'pending_assistant',
  sdao_supervisor: 'pending_supervisor',
  academic_director: 'pending_director',
}

export default function RescheduleRequests() {
  const { profile } = useAuth()
  const role = profile?.role
  const isOrg = role === 'rso_officer'
  const reviewStage = REVIEW_STAGE_BY_ROLE[role] || null
  const isReviewer = !!reviewStage || role === 'system_admin'
  const myOrgId = profile?.org_memberships?.[0]?.org_id

  const [params] = useSearchParams()
  const preselectEventId = params.get('event') || ''

  const [venues, setVenues] = useState([])
  const [myEvents, setMyEvents] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState(isReviewer ? 'queue' : 'mine')
  const [formOpen, setFormOpen] = useState(!!preselectEventId)

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadAll() {
    setLoading(true)
    setError('')
    const [{ data: v }, { data: ev, error: evErr }, { data: r, error: rErr }] = await Promise.all([
      supabase.from('venues').select('id, name'),
      isOrg && myOrgId
        ? supabase.from('events').select('id, title, event_date, start_time, end_time, is_multi_day, event_dates, booking_status, venue_ids, venue_details')
            .eq('org_id', myOrgId).eq('booking_status', 'reserved').order('event_date', { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.from('reschedule_requests').select(`
        id, event_id, org_id, reason, stage, requested_at, decided_at,
        events!reschedule_requests_event_id_fkey ( title, event_date ),
        organizations ( name, acronym ),
        reschedule_request_items ( id, original_event_date, new_event_date, new_start_time, new_end_time, new_venue_ids, new_venue_details ),
        reschedule_request_history ( stage, action, comment, created_at, profiles ( full_name ) )
      `).order('requested_at', { ascending: false }),
    ])
    if (evErr || rErr) setError('Could not load reschedule requests. Please try again.')
    setVenues(v || [])
    setMyEvents(ev || [])
    setRequests(r || [])
    setLoading(false)
  }

  const myRequests = useMemo(
    () => requests.filter((r) => r.org_id === myOrgId),
    [requests, myOrgId]
  )
  const queueRequests = useMemo(
    () => requests.filter((r) => r.stage === reviewStage),
    [requests, reviewStage]
  )

  return (
    <div className="rr-page">
      <div className="rr-header">
        <h2 className="rr-header__title"><CalendarClock size={17} color="var(--nu-blue-700)" /> Reschedule Requests</h2>
        <p className="rr-header__sub">
          {isOrg
            ? 'Move the date, time, or venue of an approved activity. Approval chain: SDAO Assistant → SDAO Supervisor → Academic Director.'
            : 'Reschedule requests for already-approved activities. Approval chain: SDAO Assistant → SDAO Supervisor → Academic Director.'}
        </p>
      </div>

      {error && <div className="rr-error"><AlertCircle size={14} /> {error}</div>}

      {isOrg && (
        formOpen
          ? <NewRequestForm events={myEvents} venues={venues} preselectEventId={preselectEventId}
              onDone={() => { setFormOpen(false); loadAll() }} onCancel={() => setFormOpen(false)} />
          : <button className="rr-btn rr-btn--gold" onClick={() => setFormOpen(true)}>
              <Plus size={14} /> Request Reschedule
            </button>
      )}

      {isReviewer && (
        <div className="rr-tabs">
          <button className={`rr-tab ${tab === 'queue' ? 'rr-tab--active' : ''}`} onClick={() => setTab('queue')}>
            Awaiting My Review {queueRequests.length > 0 && <span className="rr-tab__count">{queueRequests.length}</span>}
          </button>
          <button className={`rr-tab ${tab === 'all' ? 'rr-tab--active' : ''}`} onClick={() => setTab('all')}>
            All Requests
          </button>
        </div>
      )}

      {loading ? (
        <div className="rr-loading"><Loader2 size={20} className="spin" /></div>
      ) : (
        <RequestsList
          requests={isOrg && !isReviewer ? myRequests : (tab === 'queue' ? queueRequests : requests)}
          venues={venues}
          isOrg={isOrg}
          isReviewer={isReviewer}
          reviewStage={reviewStage}
          onChanged={loadAll}
        />
      )}
    </div>
  )
}

// --- Venue availability checking, mirroring the same policy used on the
// original Event Application in SubmissionBin.jsx: a venue is unavailable
// on a date if another activity holds a 'pencil' or 'reserved' booking
// there, or admin/FMO has 'blocked' the date via venue_blocks. Bookings on
// the same venue + date may coexist if their times (plus a 2-hour
// ingress/egress buffer, capped to 6:00 AM–9:00 PM gate hours) don't
// overlap. The event being rescheduled is excluded from the check so it
// doesn't conflict with itself.
const INGRESS_EGRESS_BUFFER_MIN = 2 * 60
const GATE_OPEN_MIN = 6 * 60
const GATE_CLOSE_MIN = 21 * 60

function toMinutes(t) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
function coreWindow(startTime, endTime) {
  const start = toMinutes(startTime)
  const end = toMinutes(endTime)
  if (start == null || end == null) return null
  return [start, end]
}
function bufferedWindow(startTime, endTime) {
  const core = coreWindow(startTime, endTime)
  if (!core) return null
  const [start, end] = core
  return [Math.max(GATE_OPEN_MIN, start - INGRESS_EGRESS_BUFFER_MIN), Math.min(GATE_CLOSE_MIN, end + INGRESS_EGRESS_BUFFER_MIN)]
}
function windowsOverlap(a, b) {
  return a[0] < b[1] && b[0] < a[1]
}

// Returns null when clear, or { blocking, message }.
async function checkVenueAvailability(venueId, date, startTime, endTime, excludeEventId) {
  if (!venueId || !date) return null

  // venue_ids is an array column — match rows where it contains venueId.
  let eventsQuery = supabase
    .from('events')
    .select('id, booking_status, start_time, end_time, venue_ids, organizations ( acronym )')
    .eq('event_date', date)
    .in('booking_status', ['pencil', 'reserved'])
    .contains('venue_ids', [venueId])
  if (excludeEventId) eventsQuery = eventsQuery.neq('id', excludeEventId)

  const [{ data: existingEvents }, { data: existingBlocks }] = await Promise.all([
    eventsQuery,
    supabase.from('venue_blocks').select('id, reason').eq('venue_id', venueId).eq('block_date', date),
  ])

  if (existingBlocks && existingBlocks.length > 0) {
    const reason = existingBlocks[0].reason
    return { blocking: true, message: `Blocked on this date${reason ? ` (${reason})` : ''}.` }
  }

  if (existingEvents && existingEvents.length > 0) {
    const newCore = coreWindow(startTime, endTime)
    const newBuffered = bufferedWindow(startTime, endTime)
    if (!newCore || !newBuffered) {
      const status = existingEvents[0].booking_status
      return { blocking: true, message: `Already ${status === 'reserved' ? 'reserved' : 'pencil booked'} on this date by another activity.` }
    }
    for (const ev of existingEvents) {
      const evCore = coreWindow(ev.start_time, ev.end_time)
      const evBuffered = bufferedWindow(ev.start_time, ev.end_time)
      const orgLabel = ev.organizations?.acronym || 'another activity'
      if (!evCore || !evBuffered) {
        const status = ev.booking_status
        return { blocking: true, message: `Already ${status === 'reserved' ? 'reserved' : 'pencil booked'} on this date by ${orgLabel}.` }
      }
      if (windowsOverlap(newCore, evBuffered) || windowsOverlap(evCore, newBuffered)) {
        const status = ev.booking_status
        return { blocking: true, message: `Already ${status === 'reserved' ? 'reserved' : 'pencil booked'} during an overlapping time (incl. ingress/egress buffers) by ${orgLabel}.` }
      }
    }
  }
  return null
}

function venueLine(ids, details, venues) {
  if (!ids || !ids.length) return '—'
  return ids.map((id) => {
    const v = venues.find((x) => x.id === id)
    const detail = details?.[id]
    if (!v) return detail || '—'
    return [v.name, detail].filter(Boolean).join(' — ')
  }).join(', ')
}

function NewRequestForm({ events, venues, preselectEventId, onDone, onCancel }) {
  const [eventId, setEventId] = useState(preselectEventId)
  const [reason, setReason] = useState('')
  const [items, setItems] = useState([{ original_event_date: '', new_event_date: '', new_start_time: '', new_end_time: '', new_venue_ids: [] }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [availability, setAvailability] = useState({}) // key: `${itemIdx}:${venueId}` -> { blocking, message } | 'checking'

  const selectedEvent = events.find((e) => e.id === eventId)
  const originalDates = useMemo(() => {
    if (!selectedEvent) return []
    if (selectedEvent.is_multi_day && Array.isArray(selectedEvent.event_dates)) {
      return selectedEvent.event_dates.map((d) => d.event_date)
    }
    return selectedEvent.event_date ? [selectedEvent.event_date] : []
  }, [selectedEvent])

  function updateItem(i, patch) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  }
  function addItem() {
    setItems((prev) => [...prev, { original_event_date: '', new_event_date: '', new_start_time: '', new_end_time: '', new_venue_ids: [] }])
  }
  function removeItem(i) {
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }
  function toggleVenue(i, venueId) {
    setItems((prev) => prev.map((it, idx) => {
      if (idx !== i) return it
      const has = it.new_venue_ids.includes(venueId)
      return { ...it, new_venue_ids: has ? it.new_venue_ids.filter((v) => v !== venueId) : [...it.new_venue_ids, venueId] }
    }))
  }

  // Re-run venue/date/time conflict checks — same policy as the original
  // Event Application — whenever a date entry's date, time, or venue
  // selection changes. The activity being rescheduled is excluded so its
  // own current booking never shows up as a conflict with itself.
  useEffect(() => {
    let cancelled = false
    async function run() {
      const pending = {}
      items.forEach((it, i) => {
        it.new_venue_ids.forEach((venueId) => { pending[`${i}:${venueId}`] = 'checking' })
      })
      setAvailability(pending)
      const results = {}
      await Promise.all(
        items.flatMap((it, i) => it.new_venue_ids.map(async (venueId) => {
          if (!it.new_event_date) { results[`${i}:${venueId}`] = null; return }
          const res = await checkVenueAvailability(venueId, it.new_event_date, it.new_start_time, it.new_end_time, eventId)
          results[`${i}:${venueId}`] = res
        }))
      )
      if (!cancelled) setAvailability(results)
    }
    if (items.some((it) => it.new_event_date && it.new_venue_ids.length)) run()
    else setAvailability({})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, JSON.stringify(items.map((it) => [it.new_event_date, it.new_start_time, it.new_end_time, it.new_venue_ids]))])

  const hasBlockingConflict = Object.values(availability).some((v) => v && v.blocking)
  const stillChecking = Object.values(availability).some((v) => v === 'checking')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!eventId) { setError('Select which activity you want to move.'); return }
    if (!reason.trim()) { setError('Tell us why you need to reschedule.'); return }
    for (const it of items) {
      if (!it.new_event_date) { setError('Every date entry needs a new date.'); return }
      if (!it.new_venue_ids.length) { setError('Select at least one venue for each date entry.'); return }
    }
    if (stillChecking) { setError('Still checking venue availability, please wait a moment.'); return }
    if (hasBlockingConflict) { setError('One or more of your selected venues has a scheduling conflict on the new date/time. Please resolve the conflicts (shown below) before submitting.'); return }

    setSaving(true)
    const { error: err } = await supabase.rpc('create_reschedule_request', {
      p_event_id: eventId,
      p_reason: reason.trim(),
      p_items: items.map((it) => ({
        original_event_date: it.original_event_date || null,
        new_event_date: it.new_event_date,
        new_start_time: it.new_start_time || null,
        new_end_time: it.new_end_time || null,
        new_venue_ids: it.new_venue_ids,
        new_venue_details: {},
      })),
    })
    setSaving(false)
    if (err) {
      setError(err.message || 'Could not submit the reschedule request. Please try again.')
      return
    }
    onDone()
  }

  return (
    <div className="rr-card">
      <span className="rr-card__label"><Plus size={13} /> Request Reschedule</span>
      {error && <div className="rr-form-error"><AlertCircle size={13} /> {error}</div>}
      <form className="rr-form" onSubmit={handleSubmit}>
        <label className="rr-field">
          Activity
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} required>
            <option value="">Select an approved activity…</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.title} — {ev.event_date}</option>
            ))}
          </select>
        </label>

        <label className="rr-field">
          Reason for Reschedule
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Venue became unavailable due to a facility conflict" required />
        </label>

        <div className="rr-items">
          <span className="rr-items__label">Date(s) to Move</span>
          {items.map((it, i) => (
            <div key={i} className="rr-item">
              <div className="rr-field-row">
                <label className="rr-field">
                  Original Date (if multi-day, which one)
                  <select value={it.original_event_date} onChange={(e) => updateItem(i, { original_event_date: e.target.value })}>
                    <option value="">{originalDates.length > 1 ? 'Select…' : 'Whole activity'}</option>
                    {originalDates.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
                <label className="rr-field">
                  New Date
                  <input type="date" value={it.new_event_date} onChange={(e) => updateItem(i, { new_event_date: e.target.value })} required />
                </label>
              </div>
              <div className="rr-field-row">
                <label className="rr-field">
                  New Start Time
                  <input type="time" value={it.new_start_time} onChange={(e) => updateItem(i, { new_start_time: e.target.value })} />
                </label>
                <label className="rr-field">
                  New End Time
                  <input type="time" value={it.new_end_time} onChange={(e) => updateItem(i, { new_end_time: e.target.value })} />
                </label>
              </div>
              <div className="rr-field">
                New Venue(s)
                <div className="rr-venue-checks">
                  {venues.map((v) => {
                    const status = availability[`${i}:${v.id}`]
                    return (
                      <label key={v.id} className="rr-venue-check">
                        <input type="checkbox" checked={it.new_venue_ids.includes(v.id)} onChange={() => toggleVenue(i, v.id)} />
                        {v.name}
                        {it.new_venue_ids.includes(v.id) && status === 'checking' && (
                          <Loader2 size={11} className="spin" />
                        )}
                        {it.new_venue_ids.includes(v.id) && status && status !== 'checking' && (
                          <span className={`rr-venue-status rr-venue-status--${status.blocking ? 'blocked' : 'warn'}`}>
                            <AlertCircle size={11} /> {status.message}
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>
              </div>
              {items.length > 1 && (
                <button type="button" className="rr-btn rr-btn--ghost rr-btn--small" onClick={() => removeItem(i)}>
                  <X size={12} /> Remove This Date
                </button>
              )}
            </div>
          ))}
          {originalDates.length > 1 && items.length < originalDates.length && (
            <button type="button" className="rr-btn rr-btn--outline rr-btn--small" onClick={addItem}>
              <Plus size={12} /> Add Another Date
            </button>
          )}
        </div>

        <div className="rr-form-actions">
          <button type="button" className="rr-btn rr-btn--ghost" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="rr-btn rr-btn--gold" type="submit" disabled={saving || stillChecking || hasBlockingConflict}
            title={hasBlockingConflict ? 'Resolve venue conflicts before submitting' : undefined}>
            {saving ? <Loader2 size={14} className="spin" /> : 'Submit Request'}
          </button>
        </div>
      </form>
    </div>
  )
}

function RequestsList({ requests, venues, isOrg, isReviewer, reviewStage, onChanged }) {
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [commentDraft, setCommentDraft] = useState({})

  async function handleDecision(id, action) {
    setError('')
    setBusyId(id)
    const { error: err } = await supabase.rpc('decide_reschedule_request', {
      p_request_id: id,
      p_action: action,
      p_comment: commentDraft[id] || null,
    })
    setBusyId(null)
    if (err) {
      setError(err.message || 'Could not record that decision. Please try again.')
      return
    }
    onChanged()
  }

  async function handleCancel(id) {
    setError('')
    setBusyId(id)
    const { error: err } = await supabase.rpc('cancel_reschedule_request', { p_request_id: id })
    setBusyId(null)
    if (err) {
      setError(err.message || 'Could not cancel that request. Please try again.')
      return
    }
    onChanged()
  }

  if (requests.length === 0) {
    return <div className="rr-empty">No reschedule requests here yet.</div>
  }

  return (
    <div className="rr-list">
      {error && <div className="rr-error"><AlertCircle size={14} /> {error}</div>}
      {requests.map((r) => {
        const meta = STATUS_META[r.stage] || { label: r.stage, tone: 'muted' }
        const canDecide = isReviewer && r.stage === reviewStage
        const canCancel = ['pending_assistant', 'pending_supervisor', 'pending_director'].includes(r.stage)
          && (isOrg || isReviewer)
        return (
          <div key={r.id} className="rr-row">
            <div className="rr-row__main">
              <div className="rr-row__top">
                <span className="rr-row__title">{r.events?.title || 'Activity'}</span>
                <span className={`rr-badge rr-badge--${meta.tone}`}>{meta.label}</span>
              </div>
              {!isOrg && (
                <div className="rr-row__meta">
                  <span><User size={12} /> {r.organizations?.acronym || r.organizations?.name}</span>
                </div>
              )}
              <p className="rr-row__reason"><MessageSquare size={11} /> {r.reason}</p>
              <div className="rr-row__items">
                {r.reschedule_request_items?.map((it) => (
                  <div key={it.id} className="rr-row__item">
                    <span className="rr-row__item-from">
                      {it.original_event_date || r.events?.event_date}
                    </span>
                    <span className="rr-row__item-arrow">→</span>
                    <span className="rr-row__item-to">
                      <CalendarIcon size={11} /> {it.new_event_date}
                      {(it.new_start_time || it.new_end_time) && (
                        <> <Clock size={11} /> {formatTime(it.new_start_time)}–{formatTime(it.new_end_time)}</>
                      )}
                      <MapPin size={11} /> {venueLine(it.new_venue_ids, it.new_venue_details, venues)}
                    </span>
                  </div>
                ))}
              </div>
              {r.reschedule_request_history?.length > 0 && (
                <div className="rr-row__history">
                  {r.reschedule_request_history
                    .filter((h) => h.comment)
                    .map((h, i) => (
                      <p key={i}><MessageSquare size={11} /> {h.profiles?.full_name || h.action}: {h.comment}</p>
                    ))}
                </div>
              )}
            </div>

            <div className="rr-row__actions">
              {canDecide && (
                <>
                  <input
                    className="rr-comment-input"
                    placeholder="Comment (optional)"
                    value={commentDraft[r.id] || ''}
                    onChange={(e) => setCommentDraft({ ...commentDraft, [r.id]: e.target.value })}
                  />
                  <button className="rr-icon-btn rr-icon-btn--ok" disabled={busyId === r.id}
                    onClick={() => handleDecision(r.id, 'advance')} title="Approve / Advance">
                    {busyId === r.id ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                  </button>
                  <button className="rr-icon-btn" disabled={busyId === r.id}
                    onClick={() => handleDecision(r.id, 'return')} title="Return for revision">
                    <X size={13} />
                  </button>
                  <button className="rr-icon-btn rr-icon-btn--danger" disabled={busyId === r.id}
                    onClick={() => handleDecision(r.id, 'reject')} title="Reject">
                    <Ban size={13} />
                  </button>
                </>
              )}
              {canCancel && !canDecide && (
                <button className="rr-icon-btn" disabled={busyId === r.id}
                  onClick={() => handleCancel(r.id)} title="Cancel request">
                  {busyId === r.id ? <Loader2 size={13} className="spin" /> : <Ban size={13} />}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
