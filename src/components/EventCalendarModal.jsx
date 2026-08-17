import { useEffect, useMemo, useState } from 'react'
import { X, ChevronLeft, ChevronRight, CalendarDays, Clock, MapPin, Loader2, AlertCircle, Filter } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { MONTH_NAMES, WEEKDAY_LABELS, toISODate, buildMonthGrid, formatTime } from '../lib/dateUtils'
import './EventCalendarModal.css'

// Read-only calendar of already-booked activities — lets a faculty
// applicant (no PAWrtal account) sanity-check a venue/date before
// choosing it here. Shows both RSO Event Applications and other
// Curricular Activities so a clash on either side is visible, with
// event titles readable straight from the grid (not just dots) and a
// venue filter to narrow things down.
export default function EventCalendarModal({ onClose }) {
  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [venues, setVenues] = useState([])
  const [venueFilter, setVenueFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all') // all | event | curricular
  const [events, setEvents] = useState([])
  const [curricular, setCurricular] = useState([])
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
      const [{ data: v }, { data: e, error: eErr }, { data: c }] = await Promise.all([
        supabase.from('venues').select('id, name').order('name'),
        supabase
          .from('events')
          .select('id, title, event_date, start_time, end_time, venue_id, venue_ids, venue_detail, venue_details, medium, booking_status')
          .gte('event_date', monthStart)
          .lte('event_date', monthEnd)
          .neq('booking_status', 'cancelled'),
        supabase
          .from('curricular_activities')
          .select('id, title, event_date, start_time, end_time, venue_id, venue_detail, medium, status, faculty_name')
          .gte('event_date', monthStart)
          .lte('event_date', monthEnd)
          .not('status', 'in', '(rejected)'),
      ])
      if (cancelled) return
      if (eErr) setError('Could not load the calendar. Please try again.')
      setVenues(v || [])
      setEvents(e || [])
      setCurricular(c || [])
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

  function curricularVenueLabel(ca) {
    if (!ca.venue_id) return ca.medium === 'online' ? 'Online' : '—'
    return [venueName(ca.venue_id), ca.venue_detail].filter(Boolean).join(' — ')
  }

  // Normalize both sources into one shape so the grid/list logic below
  // doesn't need to branch on kind everywhere.
  const allItems = useMemo(() => {
    const evItems = events.map((ev) => ({
      kind: 'event',
      id: `ev-${ev.id}`,
      title: ev.title,
      event_date: ev.event_date,
      start_time: ev.start_time,
      end_time: ev.end_time,
      venue_ids: ev.venue_ids && ev.venue_ids.length ? ev.venue_ids : (ev.venue_id ? [ev.venue_id] : []),
      venueLabel: eventVenueLabel(ev),
      pencil: ev.booking_status === 'pencil',
      sub: '',
    }))
    const caItems = curricular.map((ca) => ({
      kind: 'curricular',
      id: `ca-${ca.id}`,
      title: ca.title,
      event_date: ca.event_date,
      start_time: ca.start_time,
      end_time: ca.end_time,
      venue_ids: ca.venue_id ? [ca.venue_id] : [],
      venueLabel: curricularVenueLabel(ca),
      pencil: false,
      sub: ca.faculty_name ? `Curricular · ${ca.faculty_name}` : 'Curricular Activity',
    }))
    return [...evItems, ...caItems]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, curricular, venues])

  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      if (typeFilter !== 'all' && item.kind !== typeFilter) return false
      if (venueFilter !== 'all' && !item.venue_ids.includes(venueFilter)) return false
      return true
    })
  }, [allItems, typeFilter, venueFilter])

  const eventsByDate = useMemo(() => {
    const map = {}
    for (const item of filteredItems) {
      if (!map[item.event_date]) map[item.event_date] = []
      map[item.event_date].push(item)
    }
    return map
  }, [filteredItems])

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

        <div className="ecm-filters">
          <div className="ecm-filter">
            <Filter size={12} />
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All types</option>
              <option value="event">RSO Events</option>
              <option value="curricular">Curricular Activities</option>
            </select>
          </div>
          <div className="ecm-filter">
            <MapPin size={12} />
            <select value={venueFilter} onChange={(e) => setVenueFilter(e.target.value)}>
              <option value="all">All venues</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
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
                const shown = dayEvents.slice(0, 2)
                const extra = dayEvents.length - shown.length
                return (
                  <button
                    type="button"
                    key={iso}
                    className={`ecm-cell ${inMonth ? '' : 'ecm-cell--out'} ${isToday ? 'ecm-cell--today' : ''} ${isSelected ? 'ecm-cell--selected' : ''} ${dayEvents.length ? 'ecm-cell--has-events' : ''}`}
                    onClick={() => setSelectedDate(dayEvents.length ? iso : (isSelected ? null : iso))}
                  >
                    <span className="ecm-cell-num">{date.getDate()}</span>
                    {dayEvents.length > 0 && (
                      <span className="ecm-cell-chips">
                        {shown.map((item) => (
                          <span key={item.id} className={`ecm-chip ecm-chip--${item.kind}`}>{item.title}</span>
                        ))}
                        {extra > 0 && <span className="ecm-chip-more">+{extra} more</span>}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="ecm-legend">
              <span><i className="ecm-legend-dot ecm-legend-dot--event" /> RSO Event</span>
              <span><i className="ecm-legend-dot ecm-legend-dot--curricular" /> Curricular Activity</span>
            </div>

            <div className="ecm-details">
              {!selectedDate && <p className="ecm-hint">Tap a date to see what's already booked.</p>}
              {selectedDate && selectedEvents.length === 0 && (
                <p className="ecm-hint">Nothing booked on {selectedDate} — looks open.</p>
              )}
              {selectedDate && selectedEvents.length > 0 && (
                <div className="ecm-event-list">
                  <span className="ecm-event-list__label">{selectedEvents.length} plotted on {selectedDate}</span>
                  {selectedEvents.map((item) => (
                    <div key={item.id} className={`ecm-event-row ecm-event-row--${item.kind}`}>
                      <span className={`ecm-kind-tag ecm-kind-tag--${item.kind}`}>{item.kind === 'event' ? 'RSO Event' : 'Curricular'}</span>
                      <span className="ecm-event-title">{item.title}</span>
                      <span className="ecm-event-meta"><MapPin size={11} /> {item.venueLabel}</span>
                      {(item.start_time || item.end_time) && (
                        <span className="ecm-event-meta">
                          <Clock size={11} /> {formatTime(item.start_time)}{item.end_time ? `–${formatTime(item.end_time)}` : ''}
                        </span>
                      )}
                      {item.sub && <span className="ecm-event-meta">{item.sub}</span>}
                      {item.pencil && <span className="ecm-pencil-badge">Pencil-booked</span>}
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
