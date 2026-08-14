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

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!eventId) { setError('Select which activity you want to move.'); return }
    if (!reason.trim()) { setError('Tell us why you need to reschedule.'); return }
    for (const it of items) {
      if (!it.new_event_date) { setError('Every date entry needs a new date.'); return }
      if (!it.new_venue_ids.length) { setError('Select at least one venue for each date entry.'); return }
    }

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
                  {venues.map((v) => (
                    <label key={v.id} className="rr-venue-check">
                      <input type="checkbox" checked={it.new_venue_ids.includes(v.id)} onChange={() => toggleVenue(i, v.id)} />
                      {v.name}
                    </label>
                  ))}
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
          <button className="rr-btn rr-btn--gold" type="submit" disabled={saving}>
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
