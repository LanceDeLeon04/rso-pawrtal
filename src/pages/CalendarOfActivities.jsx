import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays, ChevronLeft, ChevronRight, X, MapPin, Clock,
  User, Building2, Pencil, BadgeCheck, Loader2, AlertCircle, Video, Trash2,
  Ban, Move,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier, isFMO } from '../context/AuthContext'
import {
  MONTH_NAMES, WEEKDAY_LABELS, toISODate, buildMonthGrid, formatTime, MEDIUM_LABELS,
} from '../lib/dateUtils'
import './CalendarOfActivities.css'

export default function CalendarOfActivities() {
  const { profile } = useAuth()
  const admin = isAdminTier(profile?.role)
  const fmo = isFMO(profile?.role)
  const canManageVenues = admin || fmo // block dates + reschedule bookings

  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [venues, setVenues] = useState([])
  const [venueFilter, setVenueFilter] = useState('all')
  const [events, setEvents] = useState([])
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selectedEvent, setSelectedEvent] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [moving, setMoving] = useState(false)
  const [moveForm, setMoveForm] = useState(null)
  const [savingMove, setSavingMove] = useState(false)

  const [showBlockModal, setShowBlockModal] = useState(false)
  const [blockForm, setBlockForm] = useState({ venue_id: '', block_date: '', reason: '' })
  const [savingBlock, setSavingBlock] = useState(false)
  const [selectedBlock, setSelectedBlock] = useState(null)

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
    loadBlocks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, venueFilter])

  async function loadBlocks() {
    const rangeStart = toISODate(new Date(cursor.year, cursor.month, 1))
    const rangeEnd = toISODate(new Date(cursor.year, cursor.month + 1, 0))

    let query = supabase
      .from('venue_blocks')
      .select('id, venue_id, block_date, reason, venues ( name, location )')
      .gte('block_date', rangeStart)
      .lte('block_date', rangeEnd)

    if (venueFilter !== 'all') query = query.eq('venue_id', venueFilter)

    const { data } = await query
    setBlocks(data || [])
  }

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

  function blocksForDay(date) {
    const iso = toISODate(date)
    return blocks.filter((b) => b.block_date === iso)
  }

  async function handleBlockDate(e) {
    e.preventDefault()
    if (!blockForm.venue_id || !blockForm.block_date) return
    setSavingBlock(true)
    const { error: err } = await supabase.from('venue_blocks').insert({
      venue_id: blockForm.venue_id,
      block_date: blockForm.block_date,
      reason: blockForm.reason.trim() || null,
      created_by: profile?.id,
    })
    setSavingBlock(false)
    if (err) {
      setError(err.code === '23505' ? 'That venue is already blocked on this date.' : 'Could not block this date. Please try again.')
      return
    }
    setShowBlockModal(false)
    setBlockForm({ venue_id: '', block_date: '', reason: '' })
    loadBlocks()
  }

  async function handleUnblockDate(blockId) {
    await supabase.from('venue_blocks').delete().eq('id', blockId)
    setSelectedBlock(null)
    loadBlocks()
  }

  function startMove(ev) {
    setMoveForm({
      event_date: ev.event_date,
      start_time: ev.start_time || '',
      end_time: ev.end_time || '',
      venue_id: ev.venue_id || '',
    })
    setMoving(true)
  }

  async function handleSaveMove(e) {
    e.preventDefault()
    setSavingMove(true)
    const { error: err } = await supabase
      .from('events')
      .update({
        event_date: moveForm.event_date,
        start_time: moveForm.start_time || null,
        end_time: moveForm.end_time || null,
        venue_id: moveForm.venue_id || null,
      })
      .eq('id', selectedEvent.id)
    setSavingMove(false)
    if (err) {
      setError('Could not move this booking. Please try again.')
      return
    }
    setMoving(false)
    setSelectedEvent(null)
    loadEvents()
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
          {canManageVenues && (
            <button
              className="cal-btn cal-btn--outline"
              onClick={() => { setBlockForm({ venue_id: '', block_date: '', reason: '' }); setShowBlockModal(true) }}
            >
              <Ban size={14} /> Block Date
            </button>
          )}
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
            const dayBlocks = blocksForDay(date)
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
                  {dayBlocks.map((b) => (
                    <button
                      key={b.id}
                      className="cal-chip cal-chip--blocked"
                      onClick={() => setSelectedBlock(b)}
                      title={`${b.venues?.name || 'Venue'} blocked`}
                    >
                      <Ban size={11} /> {b.venues?.name || 'Venue'} blocked
                    </button>
                  ))}
                  {dayEvents.slice(0, 3).map((ev) => (
                    <button
                      key={ev.id}
                      className={`cal-chip cal-chip--${ev.booking_status}`}
                      onClick={() => { setSelectedEvent(ev); setConfirmDelete(false); setMoving(false) }}
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

            {(admin || fmo) ? (
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

                {canManageVenues && !moving && (
                  <div className="cal-modal__actions">
                    <button className="cal-btn cal-btn--outline" onClick={() => startMove(selectedEvent)}>
                      <Move size={14} /> Move Schedule
                    </button>
                  </div>
                )}

                {moving && (
                  <form className="cal-move-form" onSubmit={handleSaveMove}>
                    <label className="cal-move-form__field">
                      Date
                      <input type="date" value={moveForm.event_date}
                        onChange={(e) => setMoveForm({ ...moveForm, event_date: e.target.value })} required />
                    </label>
                    <div className="cal-move-form__row">
                      <label className="cal-move-form__field">
                        Start
                        <input type="time" value={moveForm.start_time}
                          onChange={(e) => setMoveForm({ ...moveForm, start_time: e.target.value })} />
                      </label>
                      <label className="cal-move-form__field">
                        End
                        <input type="time" value={moveForm.end_time}
                          onChange={(e) => setMoveForm({ ...moveForm, end_time: e.target.value })} />
                      </label>
                    </div>
                    <label className="cal-move-form__field">
                      Venue
                      <select value={moveForm.venue_id}
                        onChange={(e) => setMoveForm({ ...moveForm, venue_id: e.target.value })}>
                        <option value="">— No venue —</option>
                        {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </label>
                    <div className="cal-modal__actions">
                      <button className="cal-btn cal-btn--gold" type="submit" disabled={savingMove}>
                        {savingMove ? <Loader2 size={14} className="spin" /> : 'Save Move'}
                      </button>
                      <button className="cal-btn cal-btn--outline" type="button" onClick={() => setMoving(false)} disabled={savingMove}>
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {admin && (
                  <>
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
                  </>
                )}
              </div>
            ) : (
              <p className="cal-modal__limited">
                <CalendarDays size={14} /> {selectedEvent.event_date} — full details are visible to SDAO admins only.
              </p>
            )}
          </div>
        </div>
      )}

      {selectedBlock && (
        <div className="cal-modal-backdrop" onClick={() => setSelectedBlock(null)}>
          <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
            <button className="cal-modal__close" onClick={() => setSelectedBlock(null)}>
              <X size={18} />
            </button>
            <span className="cal-status-badge cal-status-badge--blocked"><Ban size={12} /> Blocked</span>
            <h3 className="cal-modal__title">{selectedBlock.venues?.name || 'Venue'}</h3>
            <div className="cal-modal__details">
              <div className="cal-modal__row"><CalendarDays size={14} /> {selectedBlock.block_date}</div>
              {selectedBlock.reason && <p className="cal-modal__desc">{selectedBlock.reason}</p>}
              {canManageVenues && (
                <div className="cal-modal__actions">
                  <button className="cal-btn cal-btn--danger-outline" onClick={() => handleUnblockDate(selectedBlock.id)}>
                    <Trash2 size={14} /> Unblock This Date
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showBlockModal && (
        <div className="cal-modal-backdrop" onClick={() => setShowBlockModal(false)}>
          <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
            <button className="cal-modal__close" onClick={() => setShowBlockModal(false)}>
              <X size={18} />
            </button>
            <h3 className="cal-modal__title"><Ban size={16} /> Block a Venue Date</h3>
            <form className="cal-move-form" onSubmit={handleBlockDate}>
              <label className="cal-move-form__field">
                Venue
                <select value={blockForm.venue_id}
                  onChange={(e) => setBlockForm({ ...blockForm, venue_id: e.target.value })} required>
                  <option value="">— Select venue —</option>
                  {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
              <label className="cal-move-form__field">
                Date
                <input type="date" value={blockForm.block_date}
                  onChange={(e) => setBlockForm({ ...blockForm, block_date: e.target.value })} required />
              </label>
              <label className="cal-move-form__field">
                Reason <span className="acc-optional">(optional)</span>
                <input type="text" value={blockForm.reason}
                  onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })}
                  placeholder="e.g. Maintenance, Holiday" />
              </label>
              <div className="cal-modal__actions">
                <button className="cal-btn cal-btn--gold" type="submit" disabled={savingBlock}>
                  {savingBlock ? <Loader2 size={14} className="spin" /> : 'Block Date'}
                </button>
                <button className="cal-btn cal-btn--outline" type="button" onClick={() => setShowBlockModal(false)} disabled={savingBlock}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
