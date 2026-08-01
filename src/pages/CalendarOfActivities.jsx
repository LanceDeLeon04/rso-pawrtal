import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, X, MapPin, Clock,
  User, Building2, Pencil, BadgeCheck, Loader2, AlertCircle, Video,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier } from '../context/AuthContext'
import {
  MONTH_NAMES, WEEKDAY_LABELS, toISODate, buildMonthGrid, formatTime, MEDIUM_LABELS,
} from '../lib/dateUtils'
import './CalendarOfActivities.css'

const EMPTY_FORM = {
  title: '', org_id: '', contact_person: '', contact_number: '',
  description: '', venue_id: '', event_date: '', start_time: '',
  end_time: '', booking_status: 'pencil', medium: 'f2f',
}

export default function CalendarOfActivities() {
  const { profile } = useAuth()
  const admin = isAdminTier(profile?.role)
  const myOrgId = profile?.org_memberships?.[0]?.org_id

  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [venues, setVenues] = useState([])
  const [orgs, setOrgs] = useState([])
  const [venueFilter, setVenueFilter] = useState('all')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selectedEvent, setSelectedEvent] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor])
  const monthLabel = `${MONTH_NAMES[cursor.month]} ${cursor.year}`

  useEffect(() => {
    async function loadStatics() {
      const [{ data: v }, { data: o }] = await Promise.all([
        supabase.from('venues').select('id, name, location').eq('is_active', true).order('name'),
        supabase.from('organizations').select('id, name, acronym').eq('is_active', true).order('acronym'),
      ])
      setVenues(v || [])
      setOrgs(o || [])
    }
    loadStatics()
  }, [])

  useEffect(() => {
    loadEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, venueFilter])

  async function loadEvents() {
    setLoading(true)
    setError('')

    const rangeStart = toISODate(new Date(cursor.year, cursor.month, 1))
    const rangeEnd = toISODate(new Date(cursor.year, cursor.month + 1, 0))

    let query = supabase
      .from('events')
      .select(`
        id, title, org_id, contact_person, contact_number, description,
        venue_id, event_date, start_time, end_time, booking_status, medium,
        organizations ( name, acronym ),
        venues ( name, location )
      `)
      .gte('event_date', rangeStart)
      .lte('event_date', rangeEnd)
      .order('start_time', { ascending: true })

    if (venueFilter !== 'all') query = query.eq('venue_id', venueFilter)

    const { data, error: err } = await query

    if (err) {
      setError('Could not load activities. Please try again.')
      setEvents([])
    } else {
      setEvents(data || [])
    }
    setLoading(false)
  }

  function eventsForDay(date) {
    const iso = toISODate(date)
    return events.filter((e) => e.event_date === iso)
  }

  function changeMonth(delta) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  function goToday() {
    setCursor({ year: today.getFullYear(), month: today.getMonth() })
  }

  function openAddModal(prefillDate) {
    setForm({
      ...EMPTY_FORM,
      org_id: admin ? '' : myOrgId || '',
      event_date: prefillDate ? toISODate(prefillDate) : '',
    })
    setFormError('')
    setShowAddModal(true)
  }

  async function handleCreateEvent(e) {
    e.preventDefault()
    setFormError('')

    if (!form.title || !form.org_id || !form.contact_person || !form.event_date) {
      setFormError('Please fill in event name, organization, contact person, and date.')
      return
    }

    setSaving(true)
    const { error: err } = await supabase.from('events').insert({
      title: form.title,
      org_id: form.org_id,
      contact_person: form.contact_person,
      contact_number: form.contact_number || null,
      description: form.description || null,
      venue_id: form.venue_id || null,
      event_date: form.event_date,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      booking_status: form.booking_status,
      medium: form.medium,
      created_by: profile.id,
    })
    setSaving(false)

    if (err) {
      setFormError('Could not save this booking. Please try again.')
      return
    }

    setShowAddModal(false)
    loadEvents()
  }

  async function updateBookingStatus(eventId, status) {
    await supabase.from('events').update({ booking_status: status }).eq('id', eventId)
    setSelectedEvent(null)
    loadEvents()
  }

  return (
    <div className="cal-page">
      <div className="cal-toolbar">
        <div className="cal-toolbar__nav">
          <button className="cal-icon-btn" onClick={() => changeMonth(-1)} aria-label="Previous month">
            <ChevronLeft size={17} />
          </button>
          <span className="cal-toolbar__month">
            <CalendarDays size={16} /> {monthLabel}
          </span>
          <button className="cal-icon-btn" onClick={() => changeMonth(1)} aria-label="Next month">
            <ChevronRight size={17} />
          </button>
          <button className="cal-today-btn" onClick={goToday}>Today</button>
        </div>

        <div className="cal-toolbar__actions">
          <select
            className="cal-select"
            value={venueFilter}
            onChange={(e) => setVenueFilter(e.target.value)}
          >
            <option value="all">All venues</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>

          <button className="cal-add-btn" onClick={() => openAddModal(null)}>
            <Plus size={16} /> Book Activity
          </button>
        </div>
      </div>

      <div className="cal-legend">
        <span className="cal-legend__item"><i className="cal-dot cal-dot--pencil" /> Pencil booked (tentative)</span>
        <span className="cal-legend__item"><i className="cal-dot cal-dot--reserved" /> Reserved / confirmed</span>
        <span className="cal-legend__item"><i className="cal-dot cal-dot--cancelled" /> Cancelled</span>
      </div>

      {error && (
        <div className="cal-error"><AlertCircle size={15} /> {error}</div>
      )}

      <div className="cal-grid-wrap">
        {loading && (
          <div className="cal-loading"><Loader2 size={22} className="spin" /></div>
        )}

        <div className="cal-weekdays">
          {WEEKDAY_LABELS.map((w) => <div key={w} className="cal-weekday">{w}</div>)}
        </div>

        <div className="cal-grid">
          {grid.map(({ date, inMonth }) => {
            const dayEvents = eventsForDay(date)
            const isToday = toISODate(date) === toISODate(today)
            return (
              <div
                key={date.toISOString()}
                className={`cal-cell ${inMonth ? '' : 'cal-cell--dim'} ${isToday ? 'cal-cell--today' : ''}`}
                onDoubleClick={() => inMonth && openAddModal(date)}
              >
                <div className="cal-cell__head">
                  <span className="cal-cell__num">{date.getDate()}</span>
                </div>
                <div className="cal-cell__events">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <button
                      key={ev.id}
                      className={`cal-chip cal-chip--${ev.booking_status}`}
                      onClick={() => setSelectedEvent(ev)}
                      title={ev.title}
                    >
                      {ev.title}
                      {ev.organizations?.acronym && (
                        <span className="cal-chip__org"> · {ev.organizations.acronym}</span>
                      )}
                    </button>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="cal-chip__more">+{dayEvents.length - 3} more</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {selectedEvent && (
        <div className="cal-modal-backdrop" onClick={() => setSelectedEvent(null)}>
          <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
            <button className="cal-modal__close" onClick={() => setSelectedEvent(null)}>
              <X size={18} />
            </button>

            <span className={`cal-status-badge cal-status-badge--${selectedEvent.booking_status}`}>
              {selectedEvent.booking_status === 'pencil' && <Pencil size={12} />}
              {selectedEvent.booking_status === 'reserved' && <BadgeCheck size={12} />}
              {selectedEvent.booking_status.charAt(0).toUpperCase() + selectedEvent.booking_status.slice(1)}
            </span>

            <h3 className="cal-modal__title">{selectedEvent.title}</h3>
            <p className="cal-modal__org">
              <Building2 size={14} /> {selectedEvent.organizations?.acronym || '—'} — {selectedEvent.organizations?.name}
            </p>

            {admin ? (
              <div className="cal-modal__details">
                <div className="cal-modal__row"><CalendarDays size={14} /> {selectedEvent.event_date}</div>
                {(selectedEvent.start_time || selectedEvent.end_time) && (
                  <div className="cal-modal__row">
                    <Clock size={14} />
                    {formatTime(selectedEvent.start_time)}{selectedEvent.end_time && ` – ${formatTime(selectedEvent.end_time)}`}
                  </div>
                )}
                {selectedEvent.venues?.name && (
                  <div className="cal-modal__row"><MapPin size={14} /> {selectedEvent.venues.name}</div>
                )}
                {selectedEvent.medium && (
                  <div className="cal-modal__row"><Video size={14} /> {MEDIUM_LABELS[selectedEvent.medium]}</div>
                )}
                <div className="cal-modal__row"><User size={14} /> {selectedEvent.contact_person}
                  {selectedEvent.contact_number && ` · ${selectedEvent.contact_number}`}
                </div>
                {selectedEvent.description && (
                  <p className="cal-modal__desc">{selectedEvent.description}</p>
                )}

                <div className="cal-modal__actions">
                  {selectedEvent.booking_status !== 'reserved' && (
                    <button
                      className="cal-btn cal-btn--gold"
                      onClick={() => updateBookingStatus(selectedEvent.id, 'reserved')}
                    >
                      Confirm Reservation
                    </button>
                  )}
                  {selectedEvent.booking_status !== 'cancelled' && (
                    <button
                      className="cal-btn cal-btn--outline"
                      onClick={() => updateBookingStatus(selectedEvent.id, 'cancelled')}
                    >
                      Cancel Booking
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="cal-modal__limited">
                <CalendarDays size={14} /> {selectedEvent.event_date} — full details are visible to SDAO admins only.
              </p>
            )}
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="cal-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <form className="cal-modal cal-modal--form" onClick={(e) => e.stopPropagation()} onSubmit={handleCreateEvent}>
            <button type="button" className="cal-modal__close" onClick={() => setShowAddModal(false)}>
              <X size={18} />
            </button>
            <h3 className="cal-modal__title">Book an Activity</h3>

            {formError && <div className="cal-form-error"><AlertCircle size={14} /> {formError}</div>}

            <label className="cal-field">
              Event Name
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </label>

            {admin ? (
              <label className="cal-field">
                Organization
                <select value={form.org_id} onChange={(e) => setForm({ ...form, org_id: e.target.value })} required>
                  <option value="">Select organization</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.acronym} — {o.name}</option>)}
                </select>
              </label>
            ) : (
              <label className="cal-field">
                Organization
                <input value={orgs.find((o) => o.id === myOrgId)?.acronym || ''} disabled />
              </label>
            )}

            <div className="cal-field-row">
              <label className="cal-field">
                Contact Person
                <input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} required />
              </label>
              <label className="cal-field">
                Contact Number
                <input value={form.contact_number} onChange={(e) => setForm({ ...form, contact_number: e.target.value })} />
              </label>
            </div>

            <div className="cal-field-row">
              <label className="cal-field">
                Date
                <input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} required />
              </label>
              <label className="cal-field">
                Venue
                <select value={form.venue_id} onChange={(e) => setForm({ ...form, venue_id: e.target.value })}>
                  <option value="">Select venue</option>
                  {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
            </div>

            <div className="cal-field-row">
              <label className="cal-field">
                Start Time
                <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
              </label>
              <label className="cal-field">
                End Time
                <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
              </label>
            </div>

            <div className="cal-field-row">
              <label className="cal-field">
                Medium
                <select value={form.medium} onChange={(e) => setForm({ ...form, medium: e.target.value })}>
                  <option value="f2f">Face-to-Face</option>
                  <option value="online">Online</option>
                  <option value="off_campus">Off-Campus</option>
                </select>
              </label>
              <label className="cal-field">
                Booking Type
                <select value={form.booking_status} onChange={(e) => setForm({ ...form, booking_status: e.target.value })}>
                  <option value="pencil">Pencil book (tentative)</option>
                  <option value="reserved">Reserve / confirm</option>
                </select>
              </label>
            </div>

            <label className="cal-field">
              Description
              <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>

            <button type="submit" className="cal-btn cal-btn--gold cal-btn--full" disabled={saving}>
              {saving ? <Loader2 size={15} className="spin" /> : 'Save Booking'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
