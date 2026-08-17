import { useEffect, useMemo, useState } from 'react'
import { X, ChevronLeft, ChevronRight, CalendarDays, Clock, MapPin, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { MONTH_NAMES, WEEKDAY_LABELS, toISODate, buildMonthGrid, formatTime } from '../lib/dateUtils'
import './EventCalendarModal.css'

// Lightweight, read-only calendar of already-booked activities — lets a
// faculty applicant (no PAWrtal account) sanity-check a venue/date before
// choosing it here. Deliberately simpler than the internal Calendar of
// Activities page: no editing, no admin-only data, just what's plotted
// on which day so a date/venue clash can be spotted up front.
export default function EventCalendarModal({ onClose }) {
  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [venues, setVenues] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDate, setSelectedDate] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      const monthStart = toISODate(new Date(cursor.year, cursor.month, 1))
      const monthEnd = toISODate(new Date(cursor.year, cursor.month + 1, 0))
      const [{ data: v }, { data: e, error: eErr }] = await Promise.all([
        supabase.from('venues').select('id, name').order('name'),
        supabase
          .from('events')
          .select('id, title, event_date, start_time, end_time, venue_id, venue_ids, venue_detail, venue_details, medium, booking_status')
          .gte('event_date', monthStart)
          .lte('event_date', monthEnd)
          .neq('booking_status', 'cancelled'),
      ])
      if (cancelled) return
      if (eErr) setError('Could not load the calendar. Please try again.')
      setVenues(v || [])
      setEvents(e || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [cursor])

  const venueName = (id) => venues.find((v) => v.id === id)?.name || ''

  function eventVenueLabel(ev) {
    const ids = ev.venue_ids && ev.venue_ids.length ? ev.venue_ids : (ev.venue_id ? [ev.venue_id] : [])
    if (!ids.length) return ev.medium === 'online' ? 'Online' : '—'
    return ids.map((id) => {
      const detail = ev.venue_details?.[id] ?? (id === ev.venue_id ? ev.venue_detail : '')
      return [venueName(id), detail].filter(Boolean).join(' — ')
    }).join(', ')
  }

  const eventsByDate = useMemo(() => {
    const map = {}
    for (const ev of events) {
      if (!map[ev.event_date]) map[ev.event_date] = []
      map[ev.event_date].push(ev)
    }
    return map
  }, [events])

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor])
  const todayISO = toISODate(today)
  const selectedEvents = selectedDate ? (eventsByDate[selectedDate] || []) : []

  function goMonth(delta) {
    setSelectedDate(null)
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  return (
    <div className="ecm-overlay" onClick={onClose}>
      <div className="ecm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ecm-header">
          <span className="ecm-title"><CalendarDays size={16} /> Calendar of Activities</span>
          <button className="ecm-close" onClick={onClose} type="button" aria-label="Close calendar"><X size={18} /></button>
        </div>

        <div className="ecm-nav">
          <button type="button" className="ecm-nav-btn" onClick={() => goMonth(-1)}><ChevronLeft size={16} /></button>
          <span className="ecm-nav-label">{MONTH_NAMES[cursor.month]} {cursor.year}</span>
          <button type="button" className="ecm-nav-btn" onClick={() => goMonth(1)}><ChevronRight size={16} /></button>
        </div>

        {error && <div className="ecm-error"><AlertCircle size={14} /> {error}</div>}

        {loading ? (
          <div className="ecm-loading"><Loader2 size={20} className="spin" /></div>
        ) : (
          <>
            <div className="ecm-weekdays">
              {WEEKDAY_LABELS.map((w) => <span key={w}>{w}</span>)}
            </div>
            <div className="ecm-grid">
              {grid.map(({ date, inMonth }) => {
                const iso = toISODate(date)
                const dayEvents = eventsByDate[iso] || []
                const isToday = iso === todayISO
                const isSelected = iso === selectedDate
                return (
                  <button
                    type="button"
                    key={iso}
                    className={`ecm-cell ${inMonth ? '' : 'ecm-cell--out'} ${isToday ? 'ecm-cell--today' : ''} ${isSelected ? 'ecm-cell--selected' : ''}`}
                    onClick={() => setSelectedDate(dayEvents.length ? iso : (isSelected ? null : iso))}
                  >
                    <span className="ecm-cell-num">{date.getDate()}</span>
                    {dayEvents.length > 0 && (
                      <span className="ecm-cell-dots">
                        {dayEvents.slice(0, 3).map((ev) => <span key={ev.id} className="ecm-dot" />)}
                        {dayEvents.length > 3 && <span className="ecm-dot-more">+{dayEvents.length - 3}</span>}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="ecm-details">
              {!selectedDate && <p className="ecm-hint">Tap a date to see what's already booked.</p>}
              {selectedDate && selectedEvents.length === 0 && (
                <p className="ecm-hint">Nothing booked on {selectedDate} — looks open.</p>
              )}
              {selectedDate && selectedEvents.length > 0 && (
                <div className="ecm-event-list">
                  <span className="ecm-event-list__label">{selectedEvents.length} plotted on {selectedDate}</span>
                  {selectedEvents.map((ev) => (
                    <div key={ev.id} className="ecm-event-row">
                      <span className="ecm-event-title">{ev.title}</span>
                      <span className="ecm-event-meta"><MapPin size={11} /> {eventVenueLabel(ev)}</span>
                      {(ev.start_time || ev.end_time) && (
                        <span className="ecm-event-meta">
                          <Clock size={11} /> {formatTime(ev.start_time)}{ev.end_time ? `–${formatTime(ev.end_time)}` : ''}
                        </span>
                      )}
                      {ev.booking_status === 'pencil' && <span className="ecm-pencil-badge">Pencil-booked</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
