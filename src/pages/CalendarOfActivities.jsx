import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays, ChevronLeft, ChevronRight, X, MapPin, Clock,
  User, Building2, Pencil, BadgeCheck, Loader2, AlertCircle, Video, Trash2,
  Ban, Move, PartyPopper, GraduationCap, FileClock,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier, isFMO, isSHSReviewer, seesAllDepartments } from '../context/AuthContext'
import {
  MONTH_NAMES, WEEKDAY_LABELS, toISODate, buildMonthGrid, formatTime, MEDIUM_LABELS, addDaysISO,
} from '../lib/dateUtils'
import './CalendarOfActivities.css'

// An event may have several venues checked (venue_ids/venue_details),
// falling back to the legacy single venue_id/venue_detail pair for older
// rows. Returns an array of "Venue — Detail" strings, one per venue, so
// callers can render either a joined line or a bullet list.
function eventVenueLines(ev, venues) {
  const ids = ev.venue_ids && ev.venue_ids.length ? ev.venue_ids : (ev.venue_id ? [ev.venue_id] : [])
  if (!ids.length) return []
  return ids.map((id) => {
    const v = venues.find((x) => x.id === id) || (id === ev.venue_id ? ev.venues : null)
    const detail = ev.venue_details?.[id] ?? (id === ev.venue_id ? ev.venue_detail : '')
    if (!v) return detail || '—'
    return v.name === 'Others' ? (detail || v.name) : [v.name, detail].filter(Boolean).join(' — ')
  })
}

export default function CalendarOfActivities() {
  const { profile } = useAuth()
  const admin = isAdminTier(profile?.role)
  const fmo = isFMO(profile?.role)
  const shsReviewer = isSHSReviewer(profile?.role)
  const seesAllDepts = seesAllDepartments(profile?.role)
  const canManageVenues = admin || fmo // block dates + reschedule bookings
  // SDAO-SHS can schedule/remove only its own department's exam
  // periods (never holidays, never College's exam periods — see
  // migration 052). Venue blocking itself stays FMO/admin-only.
  const canManageExamPeriods = canManageVenues || shsReviewer
  const myOrgId = profile?.org_memberships?.[0]?.org_id

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

  // ---------- Org report deadlines (org-only, never admin/FMO) ----------
  // Pulled from `clearances` — the same rows the org's Clearance page
  // shows — so the calendar surfaces each still-outstanding report's
  // due date without needing a separate table.
  const [orgReportDeadlines, setOrgReportDeadlines] = useState([])
  const [selectedReportDeadline, setSelectedReportDeadline] = useState(null)

  // ---------- Academic Year + Terms ----------
  const canManageAcademic = ['sdao_assistant', 'sdao_supervisor', 'academic_director', 'system_admin'].includes(profile?.role)
  const [currentAcademicYear, setCurrentAcademicYear] = useState(null)
  const [pastAcademicYears, setPastAcademicYears] = useState([])
  // Which academic year the calendar is currently displaying. Only
  // admins may point this at a past year — orgs (and everyone else)
  // always stay pinned to whatever academic year is current. `null`
  // means "follow the current academic year".
  const [viewingAcademicYearId, setViewingAcademicYearId] = useState(null)
  const [terms, setTerms] = useState([])
  const [showAcademicModal, setShowAcademicModal] = useState(false)
  const [ayForm, setAyForm] = useState({ start_date: '', end_date: '' })
  const [savingAy, setSavingAy] = useState(false)
  const [ayError, setAyError] = useState('')
  const [termForm, setTermForm] = useState({ label: '', start_date: '', end_date: '' })
  const [savingTerm, setSavingTerm] = useState(false)
  const [termError, setTermError] = useState('')
  const [confirmDeleteTermId, setConfirmDeleteTermId] = useState(null)
  const [selectedTermBreak, setSelectedTermBreak] = useState(null)

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor])
  const monthLabel = `${MONTH_NAMES[cursor.month]} ${cursor.year}`

  // Every academic year an admin is allowed to pick from — current
  // one first, then past ones.
  const allAcademicYears = useMemo(() => {
    return currentAcademicYear ? [currentAcademicYear, ...pastAcademicYears] : pastAcademicYears
  }, [currentAcademicYear, pastAcademicYears])

  // The academic year actually driving the calendar's events + month
  // bounds. Gated on `admin` here (not just on the state value) so a
  // non-admin can never end up viewing anything but the current year,
  // no matter what viewingAcademicYearId holds.
  const viewingAcademicYear = admin && viewingAcademicYearId
    ? (allAcademicYears.find((y) => y.id === viewingAcademicYearId) || currentAcademicYear)
    : currentAcademicYear
  const isViewingPastYear = admin && !!viewingAcademicYear && viewingAcademicYear.id !== currentAcademicYear?.id

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
    loadAcademicYear()
  }, [])

  async function loadAcademicYear() {
    const [{ data: current }, { data: past }] = await Promise.all([
      supabase.from('academic_years').select('id, label, start_date, end_date, is_current').eq('is_current', true).maybeSingle(),
      supabase.from('academic_years').select('id, label, start_date, end_date, is_current').order('start_date', { ascending: false }),
    ])
    setCurrentAcademicYear(current || null)
    setPastAcademicYears((past || []).filter((y) => !current || y.id !== current.id))

    if (current) {
      const { data: t } = await supabase
        .from('academic_terms')
        .select('id, label, start_date, end_date')
        .eq('academic_year_id', current.id)
        .order('start_date', { ascending: true })
      setTerms(t || [])
    } else {
      setTerms([])
    }
  }

  // Term breaks are computed, never stored: the gap between one term's
  // end and the next term's start (plus, if terms don't fully bracket
  // the academic year, the lead-in before the first term and the
  // tail after the last term).
  const termBreaks = useMemo(() => {
    if (terms.length === 0) return []
    const sorted = [...terms].sort((a, b) => a.start_date.localeCompare(b.start_date))
    const breaks = []
    for (let i = 0; i < sorted.length - 1; i++) {
      const gapStart = addDaysISO(sorted[i].end_date, 1)
      const gapEnd = addDaysISO(sorted[i + 1].start_date, -1)
      if (gapStart <= gapEnd) {
        breaks.push({
          id: `break-${sorted[i].id}-${sorted[i + 1].id}`,
          label: `Term Break — between ${sorted[i].label} & ${sorted[i + 1].label}`,
          start_date: gapStart,
          end_date: gapEnd,
        })
      }
    }
    return breaks
  }, [terms])

  // Bounds the calendar to the current academic year's date range plus
  // one extra month of slack on either side — when a current academic
  // year is set, navigating further away from it is disabled.
  const academicMonthBounds = useMemo(() => {
    if (!viewingAcademicYear) return null
    const start = new Date(`${viewingAcademicYear.start_date}T00:00:00`)
    const end = new Date(`${viewingAcademicYear.end_date}T00:00:00`)
    const minMonth = { year: start.getFullYear(), month: start.getMonth() - 1 }
    const maxMonth = { year: end.getFullYear(), month: end.getMonth() + 1 }
    // Normalize month overflow/underflow (e.g. January - 1 -> prior December).
    const min = new Date(minMonth.year, minMonth.month, 1)
    const max = new Date(maxMonth.year, maxMonth.month, 1)
    return {
      min: { year: min.getFullYear(), month: min.getMonth() },
      max: { year: max.getFullYear(), month: max.getMonth() },
    }
  }, [viewingAcademicYear])

  function isBeforeBound(cursorVal, bound) {
    return cursorVal.year < bound.year || (cursorVal.year === bound.year && cursorVal.month < bound.month)
  }
  function isAfterBound(cursorVal, bound) {
    return cursorVal.year > bound.year || (cursorVal.year === bound.year && cursorVal.month > bound.month)
  }

  // Once we know the academic year's bounds, snap an out-of-range
  // cursor (e.g. today's month sitting outside a past/future academic
  // year) back inside the allowed window.
  useEffect(() => {
    if (!academicMonthBounds) return
    setCursor((c) => {
      if (isBeforeBound(c, academicMonthBounds.min)) return academicMonthBounds.min
      if (isAfterBound(c, academicMonthBounds.max)) return academicMonthBounds.max
      return c
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicMonthBounds])

  const canGoPrevMonth = !academicMonthBounds || !isBeforeBound({ year: cursor.year, month: cursor.month - 1 }, academicMonthBounds.min)
  const canGoNextMonth = !academicMonthBounds || !isAfterBound({ year: cursor.year, month: cursor.month + 1 }, academicMonthBounds.max)

  useEffect(() => {
    loadEvents()
    loadBlocks()
    loadRestrictedPeriods()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, venueFilter, viewingAcademicYear])

  useEffect(() => {
    loadOrgReportDeadlines()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myOrgId, admin, fmo])

  async function loadRestrictedPeriods() {
    const rangeStart = toISODate(new Date(cursor.year, cursor.month, 1))
    const rangeEnd = toISODate(new Date(cursor.year, cursor.month + 1, 0))

    // Overlap: a period is visible this month if it starts on/before
    // the month's last day AND ends on/after the month's first day.
    let query = supabase
      .from('restricted_periods')
      .select('id, kind, label, start_date, end_date, note, department')
      .lte('start_date', rangeEnd)
      .gte('end_date', rangeStart)
      .order('start_date', { ascending: true })

    // Holidays (department is null) always show for everyone. Exam
    // periods only show for their own department, unless the viewer is
    // one of the roles that sees both (full admin tier) — those get
    // both, tagged in the UI (see the pill on each exam-period chip).
    if (!seesAllDepts) {
      query = shsReviewer
        ? query.or('kind.eq.holiday,department.eq.shs')
        : query.or('kind.eq.holiday,department.eq.college,department.is.null')
    }

    const { data } = await query
    setRestrictedPeriods(data || [])
  }

  // Org-only: still-outstanding report deadlines for the caller's own
  // org (never for admins or FMO — see the `admin || fmo` guard, which
  // mirrors the same gate used everywhere else on this page for
  // org-private data). Not month-scoped since an org typically only
  // has a handful open at once; day-matching happens client-side via
  // reportDeadlinesForDay, same as blocks/periods/term breaks.
  async function loadOrgReportDeadlines() {
    if (admin || fmo || !myOrgId) {
      setOrgReportDeadlines([])
      return
    }
    const { data } = await supabase
      .from('clearances')
      .select('id, reason, status, deadline, extended_deadline, events ( title )')
      .eq('org_id', myOrgId)
      .neq('status', 'cleared')
      .order('deadline', { ascending: true })
    setOrgReportDeadlines(data || [])
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
        venue_id, venue_detail, venue_ids, venue_details, event_date, start_time, end_time, booking_status, medium,
        organizations ( name, acronym ),
        venues ( name, location )
      `)
      .gte('event_date', rangeStart)
      .lte('event_date', rangeEnd)
      .order('start_time', { ascending: true })

    if (venueFilter !== 'all') query = query.eq('venue_id', venueFilter)
    // The calendar only ever shows the events tagged to whichever
    // academic year is being viewed — even a date inside the visible
    // range that belongs to another academic year's tagged event stays
    // hidden. Orgs (and everyone but admins) always have this pinned
    // to the current academic year; admins may switch it to a past one
    // via the toolbar filter.
    if (viewingAcademicYear) query = query.eq('academic_year_id', viewingAcademicYear.id)

    const { data, error: err } = await query

    if (err) {
      setError('Could not load activities. Please try again.')
      setEvents([])
    } else {
      // Column-level visibility (RLS grants row access to everyone, so
      // this is enforced app-side, per the note on events_select_all in
      // schema.sql): SDAO admins/FMO and an org viewing its OWN events
      // get every field. For any other org's event, strip the private
      // fields — contact person, contact number, description — before
      // they ever land in state, so a non-admin org can only ever see
      // title, date, time, and venue for activities that aren't theirs.
      const scrubbed = (data || []).map((ev) => {
        const isOwnOrgEvent = !!myOrgId && ev.org_id === myOrgId
        if (admin || fmo || isOwnOrgEvent) return ev
        const { contact_person, contact_number, description, ...rest } = ev
        return rest
      })
      setEvents(scrubbed)
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

  function termBreaksForDay(date) {
    const iso = toISODate(date)
    return termBreaks.filter((b) => b.start_date <= iso && b.end_date >= iso)
  }

  // A report's real due date is whichever is later set: an extension
  // always overrides the original deadline.
  function effectiveDeadline(d) {
    return d.extended_deadline || d.deadline
  }

  function reportDeadlinesForDay(date) {
    const iso = toISODate(date)
    return orgReportDeadlines.filter((d) => effectiveDeadline(d) === iso)
  }

  function academicYearLabelFor(startISO, endISO) {
    const startYear = new Date(`${startISO}T00:00:00`).getFullYear()
    const endYear = new Date(`${endISO}T00:00:00`).getFullYear()
    return `AY ${startYear}–${endYear}`
  }

  async function handleSetAcademicYear(e) {
    e.preventDefault()
    setAyError('')
    if (!ayForm.start_date || !ayForm.end_date) return
    if (ayForm.end_date <= ayForm.start_date) {
      setAyError("End date must be after the start date.")
      return
    }
    setSavingAy(true)
    // Unset whatever's currently marked current first — the unique
    // partial index only allows one is_current row at a time.
    await supabase.from('academic_years').update({ is_current: false }).eq('is_current', true)
    const { error: err } = await supabase.from('academic_years').insert({
      label: academicYearLabelFor(ayForm.start_date, ayForm.end_date),
      start_date: ayForm.start_date,
      end_date: ayForm.end_date,
      is_current: true,
      created_by: profile?.id,
    })
    setSavingAy(false)
    if (err) {
      setAyError('Could not set this academic year. Please try again.')
      // Re-fetch in case the unset-current above went through but the
      // insert failed — don't leave the app with NO current year.
      loadAcademicYear()
      return
    }
    setAyForm({ start_date: '', end_date: '' })
    loadAcademicYear()
  }

  async function handleReactivateAcademicYear(yearId) {
    setSavingAy(true)
    await supabase.from('academic_years').update({ is_current: false }).eq('is_current', true)
    await supabase.from('academic_years').update({ is_current: true }).eq('id', yearId)
    setSavingAy(false)
    loadAcademicYear()
  }

  async function handleAddTerm(e) {
    e.preventDefault()
    setTermError('')
    if (!currentAcademicYear) {
      setTermError('Set a current academic year first.')
      return
    }
    if (!termForm.label.trim() || !termForm.start_date || !termForm.end_date) return
    if (termForm.end_date <= termForm.start_date) {
      setTermError("End date must be after the start date.")
      return
    }
    if (termForm.start_date < currentAcademicYear.start_date || termForm.end_date > currentAcademicYear.end_date) {
      setTermError('Term dates must fall within the current academic year.')
      return
    }
    setSavingTerm(true)
    const { error: err } = await supabase.from('academic_terms').insert({
      academic_year_id: currentAcademicYear.id,
      label: termForm.label.trim(),
      start_date: termForm.start_date,
      end_date: termForm.end_date,
      sort_order: terms.length,
      created_by: profile?.id,
    })
    setSavingTerm(false)
    if (err) {
      setTermError('Could not add this term. Please try again.')
      return
    }
    setTermForm({ label: '', start_date: '', end_date: '' })
    loadAcademicYear()
  }

  async function handleDeleteTerm(termId) {
    await supabase.from('academic_terms').delete().eq('id', termId)
    setConfirmDeleteTermId(null)
    loadAcademicYear()
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
      // Exam periods are department-specific (College and SHS run
      // different exam calendars on the same venues); holidays are
      // university-wide and stay untagged. SDAO-SHS can only ever
      // reach this with kind = 'exam_period' — see canManageExamPeriods.
      department: periodForm.kind === 'exam_period' ? (shsReviewer ? 'shs' : 'college') : null,
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
      const next = { year: d.getFullYear(), month: d.getMonth() }
      if (academicMonthBounds) {
        if (isBeforeBound(next, academicMonthBounds.min)) return academicMonthBounds.min
        if (isAfterBound(next, academicMonthBounds.max)) return academicMonthBounds.max
      }
      return next
    })
  }

  function goToday() {
    let next = { year: today.getFullYear(), month: today.getMonth() }
    if (academicMonthBounds) {
      if (isBeforeBound(next, academicMonthBounds.min)) next = academicMonthBounds.min
      if (isAfterBound(next, academicMonthBounds.max)) next = academicMonthBounds.max
    }
    setCursor(next)
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
        <div className="cal-toolbar__row cal-toolbar__row--nav">
          <div className="cal-toolbar__nav">
            <button className="cal-icon-btn" onClick={() => changeMonth(-1)} aria-label="Previous month" disabled={!canGoPrevMonth}>
              <ChevronLeft size={17} />
            </button>
            <span className="cal-toolbar__month">
              <CalendarDays size={16} /> {monthLabel}
            </span>
            <button className="cal-icon-btn" onClick={() => changeMonth(1)} aria-label="Next month" disabled={!canGoNextMonth}>
              <ChevronRight size={17} />
            </button>
            <button className="cal-today-btn" onClick={goToday}>Today</button>
          </div>

          {admin && allAcademicYears.length > 0 ? (
            <div className="cal-ay-filter">
              <select
                className="cal-select cal-select--ay"
                value={viewingAcademicYear?.id || ''}
                onChange={(e) => {
                  const val = e.target.value
                  setViewingAcademicYearId(val === currentAcademicYear?.id ? null : val)
                }}
                title="Academic year being viewed"
              >
                {currentAcademicYear && (
                  <option value={currentAcademicYear.id}>{currentAcademicYear.label} (Current)</option>
                )}
                {pastAcademicYears.map((y) => (
                  <option key={y.id} value={y.id}>{y.label}</option>
                ))}
              </select>
              {isViewingPastYear && (
                <span className="cal-ay-badge cal-ay-badge--past">
                  <GraduationCap size={13} /> Viewing past year
                </span>
              )}
            </div>
          ) : currentAcademicYear ? (
            <span className="cal-ay-badge" title={`${currentAcademicYear.start_date} – ${currentAcademicYear.end_date}`}>
              <GraduationCap size={13} /> {currentAcademicYear.label}
            </span>
          ) : canManageAcademic ? (
            <span className="cal-ay-badge cal-ay-badge--warn">
              <AlertCircle size={13} /> No current academic year set
            </span>
          ) : null}
        </div>

        <div className="cal-toolbar__row cal-toolbar__row--filters">
          <div className="cal-toolbar__filters">
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
          </div>

          {(canManageAcademic || canManageVenues) && (
            <div className="cal-toolbar__admin-actions">
              {canManageAcademic && (
                <button
                  className="cal-btn cal-btn--outline cal-btn--toolbar"
                  onClick={() => { setAyError(''); setAyForm({ start_date: '', end_date: '' }); setTermError(''); setShowAcademicModal(true) }}
                >
                  <GraduationCap size={14} /> Academic Year &amp; Terms
                </button>
              )}
              {canManageVenues && (
                <button
                  className="cal-btn cal-btn--outline cal-btn--toolbar"
                  onClick={() => { setBlockForm({ venue_id: '', block_date: '', reason: '' }); setShowBlockModal(true) }}
                >
                  <Ban size={14} /> Block Date
                </button>
              )}
              {canManageExamPeriods && (
                <button
                  className="cal-btn cal-btn--outline cal-btn--toolbar"
                  onClick={() => {
                    setPeriodError('')
                    // SDAO-SHS can only ever create exam periods (never
                    // holidays), pre-tagged to its own department.
                    setPeriodForm(shsReviewer
                      ? { kind: 'exam_period', label: '', start_date: '', end_date: '', note: '' }
                      : { kind: 'holiday', label: '', start_date: '', end_date: '', note: '' })
                    setShowPeriodModal(true)
                  }}
                >
                  <PartyPopper size={14} /> {shsReviewer ? 'Exam Period (SHS)' : 'Holiday / Exam Period'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="cal-legend-row">
        <div className="cal-legend">
          <span className="cal-legend__item"><i className="cal-dot cal-dot--pencil" /> Pencil booked (tentative)</span>
          <span className="cal-legend__item"><i className="cal-dot cal-dot--reserved" /> Reserved / confirmed</span>
          <span className="cal-legend__item"><i className="cal-dot cal-dot--returned" /> Returned (needs revision)</span>
          <span className="cal-legend__item"><i className="cal-dot cal-dot--cancelled" /> Cancelled</span>
          <span className="cal-legend__item"><i className="cal-dot cal-dot--holiday" /> Holiday</span>
          <span className="cal-legend__item"><i className="cal-dot cal-dot--exam_period" /> Exam period</span>
          <span className="cal-legend__item"><i className="cal-dot cal-dot--term_break" /> Term break</span>
          {!admin && !fmo && myOrgId && (
            <span className="cal-legend__item"><i className="cal-dot cal-dot--report_deadline" /> Report due (your org)</span>
          )}
        </div>
        <p className="cal-empty-note">
          Activities are booked automatically from the Submission Bin — no direct booking from the calendar.
        </p>
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
            const dayBlocks = blocksForDay(date)
            const dayPeriods = periodsForDay(date)
            const dayTermBreaks = termBreaksForDay(date)
            const dayReportDeadlines = reportDeadlinesForDay(date)
            const isToday = toISODate(date) === toISODate(today)
            const iso = toISODate(date)
            return (
              <div
                key={date.toISOString()}
                className={`cal-cell ${inMonth ? '' : 'cal-cell--dim'} ${isToday ? 'cal-cell--today' : ''} ${dayPeriods.length ? `cal-cell--${dayPeriods[0].kind}` : (dayTermBreaks.length ? 'cal-cell--term_break' : '')}`}
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
                  {dayTermBreaks.filter((b) => b.start_date === iso).map((b) => (
                    <button
                      key={b.id}
                      className="cal-chip cal-chip--term_break"
                      onClick={() => setSelectedTermBreak(b)}
                      title={b.label}
                    >
                      <GraduationCap size={11} /> Term Break
                    </button>
                  ))}
                  {dayReportDeadlines.map((d) => (
                    <button
                      key={d.id}
                      className={`cal-chip cal-chip--report_deadline cal-chip--report_deadline-${d.status}`}
                      onClick={() => setSelectedReportDeadline(d)}
                      title={`Report due${d.events?.title ? `: ${d.events.title}` : ''}`}
                    >
                      <FileClock size={11} /> Report due
                      {d.events?.title && <span className="cal-chip__org"> · {d.events.title}</span>}
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

            {(() => {
              // Full details: SDAO admins/FMO always, and an org for its
              // OWN scheduled activities. For every other org's event, an
              // RSO only ever sees title (already shown above) + date +
              // time + venue — never contact info or the description.
              const isOwnOrgEvent = !!myOrgId && selectedEvent.org_id === myOrgId
              const canSeeFullDetails = admin || fmo || isOwnOrgEvent
              return canSeeFullDetails ? (
              <div className="cal-modal__details">
                <div className="cal-modal__row"><CalendarDays size={14} /> {selectedEvent.event_date}</div>
                {(selectedEvent.start_time || selectedEvent.end_time) && (
                  <div className="cal-modal__row">
                    <Clock size={14} />
                    {formatTime(selectedEvent.start_time)}{selectedEvent.end_time && ` – ${formatTime(selectedEvent.end_time)}`}
                  </div>
                )}
                {selectedEvent.venues?.name && (
                  <div className="cal-modal__row cal-modal__row--venues">
                    <MapPin size={14} />
                    <ul className="cal-modal__venue-list">
                      {eventVenueLines(selectedEvent, venues).map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
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
                <div className="cal-modal__details">
                  <div className="cal-modal__row"><CalendarDays size={14} /> {selectedEvent.event_date}</div>
                  {(selectedEvent.start_time || selectedEvent.end_time) && (
                    <div className="cal-modal__row">
                      <Clock size={14} />
                      {formatTime(selectedEvent.start_time)}{selectedEvent.end_time && ` – ${formatTime(selectedEvent.end_time)}`}
                    </div>
                  )}
                  {selectedEvent.venues?.name && (
                    <div className="cal-modal__row cal-modal__row--venues">
                      <MapPin size={14} />
                      <ul className="cal-modal__venue-list">
                        {eventVenueLines(selectedEvent, venues).map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="cal-modal__limited">
                    Contact info and other details are only visible to SDAO admins and {selectedEvent.organizations?.acronym || 'the organizing'} org's own members.
                  </p>
                </div>
              )
            })()}
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

      {selectedReportDeadline && (
        <div className="cal-modal-backdrop" onClick={() => setSelectedReportDeadline(null)}>
          <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
            <button className="cal-modal__close" onClick={() => setSelectedReportDeadline(null)}>
              <X size={18} />
            </button>
            <span className={`cal-status-badge cal-status-badge--${selectedReportDeadline.status}`}>
              <FileClock size={12} /> {selectedReportDeadline.status.charAt(0).toUpperCase() + selectedReportDeadline.status.slice(1)}
            </span>
            <h3 className="cal-modal__title">
              {selectedReportDeadline.events?.title || 'Report Requirement'}
            </h3>
            <div className="cal-modal__details">
              <div className="cal-modal__row">
                <CalendarDays size={14} /> Due {effectiveDeadline(selectedReportDeadline)}
                {selectedReportDeadline.extended_deadline && (
                  <span className="cal-extended-tag">extended</span>
                )}
              </div>
              {selectedReportDeadline.reason && (
                <p className="cal-modal__desc">{selectedReportDeadline.reason}</p>
              )}
              <div className="cal-modal__actions">
                <Link className="cal-btn cal-btn--outline" to="/clearance">
                  <FileClock size={14} /> View in Clearance
                </Link>
              </div>
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
              {selectedPeriod.department && seesAllDepts && (
                <p className="cal-modal__desc"><strong>{selectedPeriod.department === 'shs' ? 'SHS' : 'College'} exam period</strong></p>
              )}
              {(canManageVenues || (shsReviewer && selectedPeriod.department === 'shs' && selectedPeriod.kind === 'exam_period')) && (
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
            <h3 className="cal-modal__title"><PartyPopper size={16} /> {shsReviewer ? 'Schedule SHS Exam Period' : 'Schedule Holiday / Exam Period'}</h3>
            {periodError && <div className="cal-error"><AlertCircle size={14} /> {periodError}</div>}
            <form className="cal-move-form" onSubmit={handleSchedulePeriod}>
              <label className="cal-move-form__field">
                Type
                <select
                  value={periodForm.kind}
                  onChange={(e) => setPeriodForm({ ...periodForm, kind: e.target.value })}
                  disabled={shsReviewer}
                  required
                >
                  {shsReviewer ? (
                    <option value="exam_period">Exam Week (include the week before, if applicable)</option>
                  ) : (
                    <>
                      <option value="holiday">Holiday</option>
                      <option value="exam_period">Exam Week (include the week before, if applicable)</option>
                    </>
                  )}
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

      {selectedTermBreak && (
        <div className="cal-modal-backdrop" onClick={() => setSelectedTermBreak(null)}>
          <div className="cal-modal" onClick={(e) => e.stopPropagation()}>
            <button className="cal-modal__close" onClick={() => setSelectedTermBreak(null)}>
              <X size={18} />
            </button>
            <span className="cal-status-badge cal-status-badge--term_break">
              <GraduationCap size={12} /> Term Break
            </span>
            <h3 className="cal-modal__title">{selectedTermBreak.label}</h3>
            <div className="cal-modal__details">
              <div className="cal-modal__row">
                <CalendarDays size={14} /> {selectedTermBreak.start_date}
                {selectedTermBreak.end_date !== selectedTermBreak.start_date && ` – ${selectedTermBreak.end_date}`}
              </div>
              <p className="cal-modal__desc">
                <AlertCircle size={13} /> This falls between two terms. Booking activities during a term break
                is not recommended.
              </p>
            </div>
          </div>
        </div>
      )}

      {showAcademicModal && (
        <div className="cal-modal-backdrop" onClick={() => setShowAcademicModal(false)}>
          <div className="cal-modal cal-modal--wide" onClick={(e) => e.stopPropagation()}>
            <button className="cal-modal__close" onClick={() => setShowAcademicModal(false)}>
              <X size={18} />
            </button>
            <h3 className="cal-modal__title"><GraduationCap size={16} /> Academic Year &amp; Terms</h3>

            <div className="cal-ay-section">
              <h4 className="cal-ay-section__title">Current Academic Year</h4>
              {currentAcademicYear ? (
                <div className="cal-ay-current">
                  <span className="cal-ay-current__label">{currentAcademicYear.label}</span>
                  <span className="cal-ay-current__range">{currentAcademicYear.start_date} – {currentAcademicYear.end_date}</span>
                </div>
              ) : (
                <p className="cal-empty-note">No current academic year is set yet.</p>
              )}

              {ayError && <div className="cal-error"><AlertCircle size={14} /> {ayError}</div>}

              <form className="cal-move-form" onSubmit={handleSetAcademicYear}>
                <div className="cal-move-form__row">
                  <label className="cal-move-form__field">
                    Academic Year Start
                    <input type="date" value={ayForm.start_date}
                      onChange={(e) => setAyForm({ ...ayForm, start_date: e.target.value })} required />
                  </label>
                  <label className="cal-move-form__field">
                    Academic Year End
                    <input type="date" value={ayForm.end_date}
                      onChange={(e) => setAyForm({ ...ayForm, end_date: e.target.value })} required />
                  </label>
                </div>
                <p className="cal-empty-note">
                  Setting a new academic year here replaces the current one. The calendar will then only show
                  this academic year's activities, plus its date range with one extra month before and after.
                  All new applications get tagged to whichever academic year is current at the time.
                </p>
                <div className="cal-modal__actions">
                  <button className="cal-btn cal-btn--gold" type="submit" disabled={savingAy}>
                    {savingAy ? <Loader2 size={14} className="spin" /> : 'Set as Current Academic Year'}
                  </button>
                </div>
              </form>

              {pastAcademicYears.length > 0 && (
                <div className="cal-ay-past">
                  <h4 className="cal-ay-section__title">Past Academic Years</h4>
                  <ul className="cal-ay-past__list">
                    {pastAcademicYears.map((y) => (
                      <li key={y.id}>
                        <span>{y.label} <span className="cal-ay-past__range">({y.start_date} – {y.end_date})</span></span>
                        <button className="cal-btn cal-btn--outline cal-btn--sm" onClick={() => handleReactivateAcademicYear(y.id)} disabled={savingAy}>
                          Make Current
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="cal-ay-section">
              <h4 className="cal-ay-section__title">Terms</h4>
              {!currentAcademicYear ? (
                <p className="cal-empty-note">Set a current academic year first.</p>
              ) : (
                <>
                  {terms.length === 0 ? (
                    <p className="cal-empty-note">No terms defined yet for {currentAcademicYear.label}.</p>
                  ) : (
                    <ul className="cal-ay-term-list">
                      {terms.map((t) => {
                        const isConfirming = confirmDeleteTermId === t.id
                        return (
                          <li key={t.id}>
                            <span className="cal-ay-term-list__label">{t.label}</span>
                            <span className="cal-ay-term-list__range">{t.start_date} – {t.end_date}</span>
                            {isConfirming ? (
                              <span className="cal-row-actions">
                                <button className="cal-icon-btn" onClick={() => handleDeleteTerm(t.id)} title="Confirm delete">
                                  <Trash2 size={13} />
                                </button>
                                <button className="cal-icon-btn" onClick={() => setConfirmDeleteTermId(null)} title="Cancel">
                                  <X size={13} />
                                </button>
                              </span>
                            ) : (
                              <button className="cal-icon-btn" onClick={() => setConfirmDeleteTermId(t.id)} title="Delete term">
                                <Trash2 size={13} />
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {termBreaks.length > 0 && (
                    <ul className="cal-ay-term-list cal-ay-term-list--breaks">
                      {termBreaks.map((b) => (
                        <li key={b.id}>
                          <span className="cal-ay-term-list__label"><GraduationCap size={12} /> Term Break</span>
                          <span className="cal-ay-term-list__range">{b.start_date} – {b.end_date}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {termError && <div className="cal-error"><AlertCircle size={14} /> {termError}</div>}

                  <form className="cal-move-form" onSubmit={handleAddTerm}>
                    <label className="cal-move-form__field">
                      Term Label
                      <input type="text" value={termForm.label}
                        onChange={(e) => setTermForm({ ...termForm, label: e.target.value })}
                        placeholder="e.g. 1st Term" required />
                    </label>
                    <div className="cal-move-form__row">
                      <label className="cal-move-form__field">
                        Term Start
                        <input type="date" value={termForm.start_date}
                          onChange={(e) => setTermForm({ ...termForm, start_date: e.target.value })}
                          min={currentAcademicYear.start_date} max={currentAcademicYear.end_date} required />
                      </label>
                      <label className="cal-move-form__field">
                        Term End
                        <input type="date" value={termForm.end_date}
                          onChange={(e) => setTermForm({ ...termForm, end_date: e.target.value })}
                          min={currentAcademicYear.start_date} max={currentAcademicYear.end_date} required />
                      </label>
                    </div>
                    <p className="cal-empty-note">
                      Any gap between terms is automatically treated as a term break — booking activities
                      then isn't recommended, but it's not blocked outright.
                    </p>
                    <div className="cal-modal__actions">
                      <button className="cal-btn cal-btn--gold" type="submit" disabled={savingTerm}>
                        {savingTerm ? <Loader2 size={14} className="spin" /> : 'Add Term'}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
