import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays, ChevronLeft, ChevronRight, X, MapPin, Clock,
  User, Building2, Pencil, BadgeCheck, Loader2, AlertCircle, Video, Trash2,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier } from '../context/AuthContext'
import {
  MONTH_NAMES, WEEKDAY_LABELS, toISODate, buildMonthGrid, formatTime, MEDIUM_LABELS,
} from '../lib/dateUtils'
import './CalendarOfActivities.css'

export default function CalendarOfActivities() {
  const { profile } = useAuth()
  const admin = isAdminTier(profile?.role)

  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [venues, setVenues] = useState([])
  const [venueFilter, setVenueFilter] = useState('all')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selectedEvent, setSelectedEvent] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor])
  const monthLabel = `${MONTH_NAMES[cursor.month]} ${cursor.year}`

  useEffect(() => {
    async function loadStatics() {
      const [{ data: v }] = await Promise.all([
        supabase.from('venues').select('id, name, location').eq('is_active', true).order('name'),
      ])
      setVenues(v || [])
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

  async function updateBookingStatus(eventId, status) {
    await supabase.from('events').update({ booking_status: status }).eq('id', eventId)
    setSelectedEvent(null)
    loadEvents()
  }

  // Deletes the booking outright — the event row (and, via cascade,
  // anything tied to it: its submission/application, assignments,
  // clearance) is removed for good, so it can never linger on the
  // calendar the way a merely "cancelled" booking still can.
  async function handleDeleteEvent(eventId) {
    setDeleting(true)
    const { error: err } = await supabase.from('events').delete().eq('id', eventId)
    setDeleting(false)

    if (err) {
      setError('Could not delete this booking. Please try again.')
      return
    }

    setConfirmDelete(false)
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
        </div>
      </div>

      <div className="cal-legend">
        <span className="cal-legend__item"><i className="cal-dot cal-dot--pencil" /> Pencil booked (tentative)</span>
        <span className="cal-legend__item"><i className="cal-dot cal-dot--reserved" /> Reserved / confirmed</span>
        <span className="cal-legend__item"><i className="cal-dot cal-dot--returned" /> Returned (pencil booked, needs revision)</span>
        <span className="cal-legend__item"><i className="cal-dot cal-dot--cancelled" /> Cancelled</span>
      </div>
      <p className="cal-empty-note">
        Activities are booked automatically from Event Applications in the Submission Bin — there's no direct booking from the calendar.
      </p>

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
              >
                <div className="cal-cell__head">
                  <span className="cal-cell__num">{date.getDate()}</span>
                </div>
                <div className="cal-cell__events">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <button
                      key={ev.id}
                      className={`cal-chip cal-chip--${ev.booking_status}`}
                      onClick={() => { setSelectedEvent(ev); setConfirmDelete(false) }}
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
            <button className="cal-modal__close" onClick={() => { setSelectedEvent(null); setConfirmDelete(false) }}>
              <X size={18} />
            </button>

            <span className={`cal-status-badge cal-status-badge--${selectedEvent.booking_status}`}>
              {selectedEvent.booking_status === 'pencil' && <Pencil size={12} />}
              {selectedEvent.booking_status === 'returned' && <Pencil size={12} />}
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

                <div className="cal-modal__actions">
                  {confirmDelete ? (
                    <>
                      <span className="cal-modal__delete-warn">
                        <AlertCircle size={13} /> Delete this booking for good? This also removes its linked application/report.
                      </span>
                      <button
                        className="cal-btn cal-btn--danger"
                        onClick={() => handleDeleteEvent(selectedEvent.id)}
                        disabled={deleting}
                      >
                        {deleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} Yes, delete
                      </button>
                      <button
                        className="cal-btn cal-btn--outline"
                        onClick={() => setConfirmDelete(false)}
                        disabled={deleting}
                      >
                        Keep booking
                      </button>
                    </>
                  ) : (
                    <button
                      className="cal-btn cal-btn--danger-outline"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 size={14} /> Delete from Calendar
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
    </div>
  )
}
