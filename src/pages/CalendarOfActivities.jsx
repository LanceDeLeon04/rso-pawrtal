import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays, ChevronLeft, ChevronRight, X, MapPin, Clock,
  User, Building2, Pencil, BadgeCheck, Loader2, AlertCircle, Video, Trash2,
  Ban, Move, PartyPopper, GraduationCap,
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
  const [venueRooms, setVenueRooms] = useState([])
  const [venueLabs, setVenueLabs] = useState([])
  const [venueFilter, setVenueFilter] = useState('all')
  // Sub-filter for Room / Laboratory venues, same cascading picker used
  // on the Submission Bin's event application form — narrows the
  // calendar down to one specific room or lab instead of every booking
  // tagged under the general "Room"/"Laboratory" venue.
  const [locationFilter, setLocationFilter] = useState({ room_building: '', room_floor: '', room_number: '', lab_id: '' })
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

  const [restrictedPeriods, setRestrictedPeriods] = useState([])
  const [showPeriodModal, setShowPeriodModal] = useState(false)
  const [periodForm, setPeriodForm] = useState({ kind: 'holiday', label: '', start_date: '', end_date: '', note: '' })
  const [savingPeriod, setSavingPeriod] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState(null)
  const [periodError, setPeriodError] = useState('')

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor])
  const monthLabel = `${MONTH_NAMES[cursor.month]} ${cursor.year}`

  useEffect(() => {
    async function loadStatics() {
      const [{ data: v }, { data: rooms }, { data: labs }] = await Promise.all([
        supabase.from('venues').select('id, name, location').eq('is_active', true).order('name'),
        supabase.from('venue_rooms').select('id, building, floor, room_number').order('building').order('floor').order('sort_order'),
        supabase.from('venue_labs').select('id, name, care_of, location').order('sort_order'),
      ])
      setVenues(v || [])
      setVenueRooms(rooms || [])
      setVenueLabs(labs || [])
    }
    loadStatics()
  }, [])

  useEffect(() => {
    loadEvents()
    loadBlocks()
    loadRestrictedPeriods()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, venueFilter])

  async function loadRestrictedPeriods() {
    const rangeStart = toISODate(new Date(cursor.year, cursor.month, 1))
    const rangeEnd = toISODate(new Date(cursor.year, cursor.month + 1, 0))

    // Overlap: a period is visible this month if it starts on/before
    // the month's last day AND ends on/after the month's first day.
    const { data } = await supabase
      .from('restricted_periods')
      .select('id, kind, label, start_date, end_date, note')
      .lte('start_date', rangeEnd)
      .gte('end_date', rangeStart)
      .order('start_date', { ascending: true })
    setRestrictedPeriods(data || [])
  }

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
        venue_id, venue_detail, event_date, start_time, end_time, booking_status, medium,
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

  // Mirrors how the Submission Bin's application form builds venue_detail
  // for a picked Room or Laboratory, so the calendar can filter/compare
  // against the same free-text value stored on events.venue_detail.
  function roomDetailFor(building, floor, roomNumber) {
    return `${building}, ${floor} Flr — ${roomNumber}`
  }
  function labDetailFor(lab) {
    return `${lab.name} c/o ${lab.care_of}, ${lab.location}`
  }

  const filteredVenueName = venues.find((v) => v.id === venueFilter)?.name
  const roomBuildingOptions = [...new Set(venueRooms.map((r) => r.building))]
  const roomFloorOptions = [...new Set(venueRooms.filter((r) => r.building === locationFilter.room_building).map((r) => r.floor))]
  const roomNumberOptions = venueRooms.filter((r) => r.building === locationFilter.room_building && r.floor === locationFilter.room_floor)

  // Narrows `events` down to the specific room/lab picked in the
  // sub-filter, on top of the venue-level filter already applied by the
  // Supabase query in loadEvents().
  const visibleEvents = useMemo(() => {
    if (filteredVenueName === 'Room' && locationFilter.room_building) {
      let prefix = locationFilter.room_building
      if (locationFilter.room_floor) prefix = roomDetailFor(locationFilter.room_building, locationFilter.room_floor, '')
      if (locationFilter.room_number) {
        const full = roomDetailFor(locationFilter.room_building, locationFilter.room_floor, locationFilter.room_number)
        return events.filter((e) => e.venue_detail === full)
      }
      return events.filter((e) => (e.venue_detail || '').startsWith(prefix))
    }
    if (filteredVenueName === 'Laboratory' && locationFilter.lab_id) {
      const lab = venueLabs.find((l) => l.id === locationFilter.lab_id)
      if (!lab) return events
      return events.filter((e) => e.venue_detail === labDetailFor(lab))
    }
    return events
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, filteredVenueName, locationFilter, venueLabs])

  function eventsForDay(date) {
    const iso = toISODate(date)
    return visibleEvents.filter((e) => e.event_date === iso)
  }

  function blocksForDay(date) {
    const iso = toISODate(date)
    return blocks.filter((b) => b.block_date === iso)
  }

  function periodsForDay(date) {
    const iso = toISODate(date)
    return restrictedPeriods.filter((p) => p.start_date <= iso && p.end_date >= iso)
  }

  async function handleSchedulePeriod(e) {
    e.preventDefault()
    setPeriodError('')
    if (!periodForm.label.trim() || !periodForm.start_date || !periodForm.end_date) return
    if (periodForm.end_date < periodForm.start_date) {
      setPeriodError('End date can\'t be before the start date.')
      return
    }
    setSavingPeriod(true)
    const { error: err } = await supabase.from('restricted_periods').insert({
      kind: periodForm.kind,
      label: periodForm.label.trim(),
      start_date: periodForm.start_date,
      end_date: periodForm.end_date,
      note: periodForm.note.trim() || null,
      created_by: profile?.id,
    })
    setSavingPeriod(false)
    if (err) {
      setPeriodError('Could not schedule this period. Please try again.')
      return
    }
    setShowPeriodModal(false)
    setPeriodForm({ kind: 'holiday', label: '', start_date: '', end_date: '', note: '' })
    loadRestrictedPeriods()
  }

  async function handleUnschedulePeriod(periodId) {
    await supabase.from('restricted_periods').delete().eq('id', periodId)
    setSelectedPeriod(null)
    loadRestrictedPeriods()
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
    const venueName = venues.find((v) => v.id === ev.venue_id)?.name
    // Best-effort pre-fill of the room/lab sub-fields from the existing
    // free-text venue_detail, so re-opening Move Schedule doesn't force
    // re-picking a room/lab that's already correct.
    let room_building = '', room_floor = '', room_number = '', lab_id = ''
    if (venueName === 'Room' && ev.venue_detail) {
      const match = ev.venue_detail.match(/^(.*), (.*) Flr — (.*)$/)
      if (match) [, room_building, room_floor, room_number] = match
    } else if (venueName === 'Laboratory' && ev.venue_detail) {
      const match = ev.venue_detail.match(/^(.*) c\/o /)
      const lab = match ? venueLabs.find((l) => l.name === match[1]) : null
      if (lab) lab_id = lab.id
    }
    setMoveForm({
      event_date: ev.event_date,
      start_time: ev.start_time || '',
      end_time: ev.end_time || '',
      venue_id: ev.venue_id || '',
      venue_detail: ev.venue_detail || '',
      room_building, room_floor, room_number, lab_id,
    })
    setMoving(true)
  }

  async function handleSaveMove(e) {
    e.preventDefault()

    const moveVenueName = venues.find((v) => v.id === moveForm.venue_id)?.name
    if (moveVenueName === 'Room' && !moveForm.venue_detail) {
      setError('Please select the building, floor, and room.')
      return
    }
    if (moveVenueName === 'Laboratory' && !moveForm.venue_detail) {
      setError('Please select the laboratory.')
      return
    }
    setError('')

    setSavingMove(true)
    const { error: err } = await supabase
      .from('events')
      .update({
        event_date: moveForm.event_date,
        start_time: moveForm.start_time || null,
        end_time: moveForm.end_time || null,
        venue_id: moveForm.venue_id || null,
        venue_detail: moveForm.venue_id
          ? (moveVenueName === 'Room' || moveVenueName === 'Laboratory' ? moveForm.venue_detail : null)
          : null,
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
            onChange={(e) => {
              setVenueFilter(e.target.value)
              setLocationFilter({ room_building: '', room_floor: '', room_number: '', lab_id: '' })
            }}
          >
            <option value="all">All venues</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>

          {filteredVenueName === 'Room' && (
            <>
              <select
                className="cal-select"
                value={locationFilter.room_building}
                onChange={(e) => setLocationFilter({ room_building: e.target.value, room_floor: '', room_number: '', lab_id: '' })}
              >
                <option value="">All buildings</option>
                {roomBuildingOptions.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <select
                className="cal-select"
                value={locationFilter.room_floor}
                onChange={(e) => setLocationFilter({ ...locationFilter, room_floor: e.target.value, room_number: '' })}
                disabled={!locationFilter.room_building}
              >
                <option value="">All floors</option>
                {roomFloorOptions.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <select
                className="cal-select"
                value={locationFilter.room_number}
                onChange={(e) => setLocationFilter({ ...locationFilter, room_number: e.target.value })}
                disabled={!locationFilter.room_floor}
              >
                <option value="">All rooms</option>
                {roomNumberOptions.map((r) => (
                  <option key={r.id} value={r.room_number}>{r.room_number}</option>
                ))}
              </select>
            </>
          )}

          {filteredVenueName === 'Laboratory' && (
            <select
              className="cal-select"
              value={locationFilter.lab_id}
              onChange={(e) => setLocationFilter({ ...locationFilter, lab_id: e.target.value })}
            >
              <option value="">All laboratories</option>
              {venueLabs.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          )}

          {canManageVenues && (
            <button
              className="cal-btn cal-btn--outline"
              onClick={() => { setBlockForm({ venue_id: '', block_date: '', reason: '' }); setShowBlockModal(true) }}
            >
              <Ban size={14} /> Block Date
            </button>
          )}
          {canManageVenues && (
            <button
              className="cal-btn cal-btn--outline"
              onClick={() => { setPeriodError(''); setPeriodForm({ kind: 'holiday', label: '', start_date: '', end_date: '', note: '' }); setShowPeriodModal(true) }}
            >
              <PartyPopper size={14} /> Schedule Holiday / Exam Period
            </button>
          )}
        </div>
      </div>

      <div className="cal-legend">
        <span className="cal-legend__item"><i className="cal-dot cal-dot--pencil" /> Pencil booked (tentative)</span>
        <span className="cal-legend__item"><i className="cal-dot cal-dot--reserved" /> Reserved / confirmed</span>
        <span className="cal-legend__item"><i className="cal-dot cal-dot--returned" /> Returned (pencil booked, needs revision)</span>
        <span className="cal-legend__item"><i className="cal-dot cal-dot--cancelled" /> Cancelled</span>
        <span className="cal-legend__item"><i className="cal-dot cal-dot--holiday" /> Holiday</span>
        <span className="cal-legend__item"><i className="cal-dot cal-dot--exam_period" /> Exam period (booking discouraged)</span>
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
            const dayPeriods = periodsForDay(date)
            const isToday = toISODate(date) === toISODate(today)
            const iso = toISODate(date)
            return (
              <div
                key={date.toISOString()}
                className={`cal-cell ${inMonth ? '' : 'cal-cell--dim'} ${isToday ? 'cal-cell--today' : ''} ${dayPeriods.length ? `cal-cell--${dayPeriods[0].kind}` : ''}`}
              >
                <div className="cal-cell__head">
                  <span className="cal-cell__num">{date.getDate()}</span>
                </div>
                <div className="cal-cell__events">
                  {dayPeriods.filter((p) => p.start_date === iso).map((p) => (
                    <button
                      key={p.id}
                      className={`cal-chip cal-chip--${p.kind}`}
                      onClick={() => setSelectedPeriod(p)}
                      title={p.label}
                    >
                      {p.kind === 'exam_period' ? <GraduationCap size={11} /> : <PartyPopper size={11} />} {p.label}
                    </button>
                  ))}
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
                  <div className="cal-modal__row">
                    <MapPin size={14} />
                    {selectedEvent.venues.name}
                    {selectedEvent.venue_detail && ` — ${selectedEvent.venue_detail}`}
                  </div>
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
                        onChange={(e) => setMoveForm({
                          ...moveForm, venue_id: e.target.value, venue_detail: '',
                          room_building: '', room_floor: '', room_number: '', lab_id: '',
                        })}>
                        <option value="">— No venue —</option>
                        {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </label>

                    {(() => {
                      const moveVenueName = venues.find((v) => v.id === moveForm.venue_id)?.name
                      const moveRoomFloorOptions = [...new Set(venueRooms.filter((r) => r.building === moveForm.room_building).map((r) => r.floor))]
                      const moveRoomNumberOptions = venueRooms.filter((r) => r.building === moveForm.room_building && r.floor === moveForm.room_floor)
                      const moveSelectedLab = venueLabs.find((l) => l.id === moveForm.lab_id)

                      if (moveVenueName === 'Room') {
                        return (
                          <div className="cal-move-form__row">
                            <label className="cal-move-form__field">
                              Building
                              <select
                                value={moveForm.room_building}
                                onChange={(e) => setMoveForm({ ...moveForm, room_building: e.target.value, room_floor: '', room_number: '', venue_detail: '' })}
                              >
                                <option value="">Select building</option>
                                {roomBuildingOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                              </select>
                            </label>
                            <label className="cal-move-form__field">
                              Floor
                              <select
                                value={moveForm.room_floor}
                                onChange={(e) => setMoveForm({ ...moveForm, room_floor: e.target.value, room_number: '', venue_detail: '' })}
                                disabled={!moveForm.room_building}
                              >
                                <option value="">Select floor</option>
                                {moveRoomFloorOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                              </select>
                            </label>
                            <label className="cal-move-form__field">
                              Room
                              <select
                                value={moveForm.room_number}
                                onChange={(e) => {
                                  const room = moveRoomNumberOptions.find((r) => r.room_number === e.target.value)
                                  setMoveForm({
                                    ...moveForm,
                                    room_number: e.target.value,
                                    venue_detail: room ? roomDetailFor(room.building, room.floor, room.room_number) : '',
                                  })
                                }}
                                disabled={!moveForm.room_floor}
                              >
                                <option value="">Select room</option>
                                {moveRoomNumberOptions.map((r) => <option key={r.id} value={r.room_number}>{r.room_number}</option>)}
                              </select>
                            </label>
                          </div>
                        )
                      }

                      if (moveVenueName === 'Laboratory') {
                        return (
                          <label className="cal-move-form__field">
                            Laboratory
                            <select
                              value={moveForm.lab_id}
                              onChange={(e) => {
                                const lab = venueLabs.find((l) => l.id === e.target.value)
                                setMoveForm({
                                  ...moveForm,
                                  lab_id: e.target.value,
                                  venue_detail: lab ? labDetailFor(lab) : '',
                                })
                              }}
                            >
                              <option value="">Select laboratory</option>
                              {venueLabs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                            {moveSelectedLab && (
                              <span className="cal-move-form__hint">c/o {moveSelectedLab.care_of}, {moveSelectedLab.location}</span>
                            )}
                          </label>
                        )
                      }

                      return null
                    })()}

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
      {selectedPeriod && (
        <div className="cal-modal-backdrop" onClick={() => setSelectedPeriod(null)}>
          <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
            <button className="cal-modal__close" onClick={() => setSelectedPeriod(null)}>
              <X size={18} />
            </button>
            <span className={`cal-status-badge cal-status-badge--${selectedPeriod.kind}`}>
              {selectedPeriod.kind === 'exam_period' ? <GraduationCap size={12} /> : <PartyPopper size={12} />}
              {selectedPeriod.kind === 'exam_period' ? 'Exam Period' : 'Holiday'}
            </span>
            <h3 className="cal-modal__title">{selectedPeriod.label}</h3>
            <div className="cal-modal__details">
              <div className="cal-modal__row">
                <CalendarDays size={14} /> {selectedPeriod.start_date}
                {selectedPeriod.end_date !== selectedPeriod.start_date && ` – ${selectedPeriod.end_date}`}
              </div>
              <p className="cal-modal__desc">
                <AlertCircle size={13} /> Booking activities on these dates is not recommended and is only
                allowed under extraordinary circumstances.
              </p>
              {selectedPeriod.note && <p className="cal-modal__desc">{selectedPeriod.note}</p>}
              {canManageVenues && (
                <div className="cal-modal__actions">
                  <button className="cal-btn cal-btn--danger-outline" onClick={() => handleUnschedulePeriod(selectedPeriod.id)}>
                    <Trash2 size={14} /> Unschedule This Period
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showPeriodModal && (
        <div className="cal-modal-backdrop" onClick={() => setShowPeriodModal(false)}>
          <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
            <button className="cal-modal__close" onClick={() => setShowPeriodModal(false)}>
              <X size={18} />
            </button>
            <h3 className="cal-modal__title"><PartyPopper size={16} /> Schedule Holiday / Exam Period</h3>
            {periodError && <div className="cal-error"><AlertCircle size={14} /> {periodError}</div>}
            <form className="cal-move-form" onSubmit={handleSchedulePeriod}>
              <label className="cal-move-form__field">
                Type
                <select value={periodForm.kind} onChange={(e) => setPeriodForm({ ...periodForm, kind: e.target.value })} required>
                  <option value="holiday">Holiday</option>
                  <option value="exam_period">Exam Week (include the week before, if applicable)</option>
                </select>
              </label>
              <label className="cal-move-form__field">
                Label
                <input type="text" value={periodForm.label}
                  onChange={(e) => setPeriodForm({ ...periodForm, label: e.target.value })}
                  placeholder={periodForm.kind === 'exam_period' ? 'e.g. Midterm Exams (incl. pre-exam week)' : 'e.g. National Heroes Day'}
                  required />
              </label>
              <div className="cal-move-form__row">
                <label className="cal-move-form__field">
                  Start Date
                  <input type="date" value={periodForm.start_date}
                    onChange={(e) => setPeriodForm({ ...periodForm, start_date: e.target.value })} required />
                </label>
                <label className="cal-move-form__field">
                  End Date
                  <input type="date" value={periodForm.end_date}
                    onChange={(e) => setPeriodForm({ ...periodForm, end_date: e.target.value })} required />
                </label>
              </div>
              <label className="cal-move-form__field">
                Note <span className="acc-optional">(optional)</span>
                <input type="text" value={periodForm.note}
                  onChange={(e) => setPeriodForm({ ...periodForm, note: e.target.value })}
                  placeholder="Shown to applicants on the notice" />
              </label>
              <p className="cal-empty-note">
                This doesn't block submissions — it flags the dates as discouraged for new activities and
                shows a notice on the Event Application form and here on the calendar.
              </p>
              <div className="cal-modal__actions">
                <button className="cal-btn cal-btn--gold" type="submit" disabled={savingPeriod}>
                  {savingPeriod ? <Loader2 size={14} className="spin" /> : 'Schedule Period'}
                </button>
                <button className="cal-btn cal-btn--outline" type="button" onClick={() => setShowPeriodModal(false)} disabled={savingPeriod}>
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
