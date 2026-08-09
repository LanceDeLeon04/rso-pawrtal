import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Inbox, Plus, X, Loader2, AlertCircle, FileText, ClipboardList,
  Check, Undo2, Ban, Download, MapPin, Clock, Video, Building2, User,
  CheckCircle2, ChevronRight, ChevronLeft, ListChecks, CalendarClock, Trash2,
  Link2, Copy, Send, ShieldAlert, Hourglass, PartyPopper, Tag,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier } from '../context/AuthContext'
import { toISODate, formatTime, MEDIUM_LABELS, MONTH_NAMES, formatEventDates } from '../lib/dateUtils'
import { generateACPFormPdf, generateMerchRequestFormPdf } from '../lib/acpPdf'
import {
  approvalLinkUrl, generateApprovalLink, fetchApprovalLinks, externalApprovalState,
} from '../lib/approvalLinks'
import { ensureEventVerificationToken } from '../lib/eventVerification'
import { reconcileOwnOverdueAssignments } from '../lib/clearanceReconcile'
import { SDG_OPTIONS } from '../lib/sdgOptions'
import { COL_EVENT_OPTIONS, COL_EVENT_TAGGER_POSITIONS } from '../lib/colEventOptions'
import { MERCHANDISE_TYPES } from '../lib/merchandiseOptions'
import VenueMultiSelect from '../components/VenueMultiSelect'
import './SubmissionBin.css'

// 'ACP Form' used to be a manual upload — it's now auto-generated from
// the fields below and attached on submit, so it's no longer in this list.
const EVENT_APP_DOCS = ['Attachments Template']
const REPORT_DOCS = ['PARF Template', 'Liquidation Report', 'Narrative Report', 'Evaluation Report']
const MERCH_DOCS = ['Design Concept', 'Quotation from Supplier']

const ACTIVITY_TYPES = [
  { value: 'org_activity', label: 'Student Organization Activity' },
  { value: 'university_activity', label: 'University/School Activity' },
  { value: 'special_event', label: 'Special Event' },
  { value: 'other', label: 'Others' },
]

// Merchandise Proposals always have "Type of Activity" = Marketing
// Proposal (set automatically, not user-selected) and have no start/end
// time (release date only). Instead they collect whether the item is a
// permanent catalog offering or exclusive to the current academic year —
// this prints on the Merchandise Request Form where Time would otherwise go.
const MERCH_ACTIVITY_TYPE_LABEL = 'Marketing Proposal'
const MERCH_DURATIONS = [
  { value: 'permanent', label: 'Permanent Merchandise' },
  { value: 'exclusive_ay', label: 'Exclusive this Academic Year' },
]

// Finance/Liquidation documents must be Excel; everything else must be PDF.
const FINANCE_DOCS = ['Liquidation Report']
function acceptedExtsFor(docType) {
  return FINANCE_DOCS.includes(docType) ? ['xlsx', 'xls'] : ['pdf']
}
function acceptAttrFor(docType) {
  return FINANCE_DOCS.includes(docType) ? '.xlsx,.xls' : '.pdf'
}
function formatHintFor(docType) {
  return FINANCE_DOCS.includes(docType) ? 'Excel (.xlsx/.xls)' : 'PDF only'
}

// Attachment entries can be either a File (uploaded) or { type: 'link', url }
// (pasted link, e.g. a Google Drive share link).
function validateAttachmentEntry(docType, entry) {
  if (!entry) return `${docType} is required — upload a file or paste a link.`
  if (entry.type === 'link') {
    if (!/^https?:\/\/\S+$/i.test((entry.url || '').trim())) {
      return `Please enter a valid link (starting with http:// or https://) for ${docType}.`
    }
    return null
  }
  const ext = (entry.name.split('.').pop() || '').toLowerCase()
  if (!acceptedExtsFor(docType).includes(ext)) {
    return `${docType} must be a ${formatHintFor(docType)} file — or paste a link instead.`
  }
  return null
}

// Venues tagged to Facilities Office vs INSPIRE Office — drives the
// auto-tag, the pencil-booking reminder, and (Laboratory only) the
// lab-owner endorsement question on the event application form.
const FACILITIES_VENUES = ['Auditorium', 'LRC', 'Room', 'Laboratory']
const INSPIRE_VENUES = [
  'Multi-Sports Center', 'INSPIRE Lounge', 'Hoops Center', 'Wellness Center',
  'High Performance Gym', 'AGETAC Pool', 'Driveway', 'Football Pitch',
]
// Venues big enough to need setup the night before — applicants can
// request to start ingress 7:00 PM–9:00 PM the day before the actual
// event date, as long as nothing else is booked at that venue during
// that window (see nightBeforeConflict below).
const NIGHT_BEFORE_INGRESS_VENUES = [
  'Auditorium', 'Multi-Sports Center', 'Hoops Center', 'Driveway', 'Football Pitch', 'LRC',
]
const NIGHT_BEFORE_START_MIN = 19 * 60 // 7:00 PM
const NIGHT_BEFORE_END_MIN = 21 * 60   // 9:00 PM

// Venues that need a specific location picked (room / lab) or typed
// (Others) before the venue selection is complete.
const VENUE_DETAIL_PROMPTS = {
  Room: 'Select the building, floor, and room',
  Laboratory: 'Select the laboratory',
  Others: 'Please specify',
}

// Shown instead of the physical Venue select once Medium = Online.
const ONLINE_PLATFORMS = [
  { value: 'ms_teams', label: 'MS Teams' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'others', label: 'Others (specify)' },
]

function venueTagFor(name) {
  if (FACILITIES_VENUES.includes(name)) return 'Facilities Office'
  if (INSPIRE_VENUES.includes(name)) return 'INSPIRE Office'
  return null
}

const STAGE_META = {
  draft: { label: 'Draft', tone: 'muted' },
  submitted: { label: 'With SDAO Assistant', tone: 'warn' },
  assistant_review: { label: 'Assistant Review', tone: 'warn' },
  supervisor_endorsement: { label: 'With SDAO Supervisor', tone: 'warn' },
  director_approval: { label: 'With Academic Director', tone: 'warn' },
  approved: { label: 'Approved', tone: 'ok' },
  returned: { label: 'Returned', tone: 'danger' },
  rejected: { label: 'Rejected', tone: 'danger' },
}

const STEPS_EVENT_APP = [
  { key: 'pre_approval', label: 'Pre-Approval' },
  { key: 'submitted', label: 'SDAO Assistant' },
  { key: 'supervisor_endorsement', label: 'SDAO Supervisor' },
  { key: 'director_approval', label: 'Academic Director' },
  { key: 'approved', label: 'Approved' },
]

// Reports don't need Supervisor/Director sign-off — they're closed out
// as soon as the SDAO Assistant receives them.
const STEPS_REPORT = [
  { key: 'submitted', label: 'SDAO Assistant' },
  { key: 'approved', label: 'Received' },
]

const REVIEWER_ROLES = ['sdao_assistant', 'sdao_supervisor', 'academic_director', 'system_admin']

function stepsFor(type) {
  return type === 'report' ? STEPS_REPORT : STEPS_EVENT_APP
}

// `chainComplete` (event applications only) tells us whether the
// external Adviser -> Dean -> SDG Rep chain has fully cleared yet.
// The DB doesn't flip `stage` off 'submitted' until that chain
// resolves (see migration 025), so while it's still pending we show
// the dedicated "Pre-Approval" step instead of jumping straight to
// "SDAO Assistant".
function stepIndexFor(type, stage, chainComplete) {
  const steps = stepsFor(type)
  if (type === 'event_application' || type === 'merchandise') {
    if (stage === 'submitted') return chainComplete ? 1 : 0
    if (stage === 'assistant_review') return 1
  }
  const i = steps.findIndex((s) => s.key === stage)
  return i === -1 ? 0 : i
}

function nextActionFor(role, stage, type) {
  const assistantTurn = stage === 'submitted' || stage === 'assistant_review'

  // Reports: SDAO Assistant just receives them — no forwarding chain.
  if (type === 'report') {
    if (assistantTurn && (role === 'sdao_assistant' || role === 'system_admin')) {
      return { to: 'approved', action: 'received', label: 'Mark as Received' }
    }
    return null
  }

  if (role === 'system_admin') {
    if (assistantTurn) return { to: 'supervisor_endorsement', action: 'checked', label: 'Check & Forward' }
    if (stage === 'supervisor_endorsement') return { to: 'director_approval', action: 'endorsed', label: 'Endorse & Forward' }
    if (stage === 'director_approval') return { to: 'approved', action: 'approved', label: 'Approve' }
    return null
  }
  if (role === 'sdao_assistant' && assistantTurn) return { to: 'supervisor_endorsement', action: 'checked', label: 'Check & Forward' }
  if (role === 'sdao_supervisor' && stage === 'supervisor_endorsement') return { to: 'director_approval', action: 'endorsed', label: 'Endorse & Forward' }
  if (role === 'academic_director' && stage === 'director_approval') return { to: 'approved', action: 'approved', label: 'Approve' }
  return null
}

// Adviser -> Dean (for School Council/Academic orgs) -> SDG
// Representative must all sign off externally, in that order, before
// the SDAO Assistant can pick up an event application. The chain
// resolution itself lives in lib/approvalLinks.js (externalApprovalState)
// so the client-side ordering can't drift from what the DB enforces.

const ROLE_LABELS = { adviser: 'Adviser', dean: 'Dean', sdg_rep: 'SDG Representative', marketing_rep: 'Marketing' }

// SDG Representatives are a fixed, known set of people (unlike
// Adviser/Dean, which vary per org) — presented as a dropdown instead
// of a free-text field so staff can't typo/misspell the name.
const SDG_REP_NAMES = [
  'Mr. Gil Mallen',
  'Ms. Merly Matibag',
  'Mr. Kim Licerio',
  'Mr. Joseph De Grano',
]

async function generateAndSetLink(submissionId, role, name, email, setApprovalLinks, setError, setBusy) {
  setError('')
  if (!name.trim()) {
    setError(`Please enter the ${role === 'adviser' ? "Adviser's" : `${ROLE_LABELS[role]}'s`} name.`)
    return
  }
  setBusy(role)
  const { data, error } = await generateApprovalLink(submissionId, role, name.trim(), email.trim())
  setBusy(null)
  if (error) {
    setError(error.message || 'Could not generate the link. Please try again.')
    return
  }
  setApprovalLinks((prev) => [...prev.filter((l) => l.role !== role), data])
}

// Returns a multi-day event's date entries sorted chronologically, so the
// earliest entry can be used wherever a single event_date/start_time/end_time
// is still expected (sorting, calendar placement, clearance deadlines, etc).
function sortedMultiDayDates(event_dates) {
  return [...(event_dates || [])]
    .filter((d) => d.event_date)
    .sort((a, b) => a.event_date.localeCompare(b.event_date))
}

// Compiles a multi-day event's per-day times into the single "Time" range
// printed on the ACP Form: the EARLIEST time-in across all days (using each
// day's requested additional ingress time when set, else its start time)
// through the LATEST time-out across all days (using each day's requested
// additional egress time when set, else its end time).
function compileMultiDayTimeRange(event_dates) {
  const days = (event_dates || []).filter((d) => d.event_date)
  const ins = days.map((d) => d.additional_ingress_time || d.start_time).filter(Boolean)
  const outs = days.map((d) => d.additional_egress_time || d.end_time).filter(Boolean)
  if (ins.length === 0 && outs.length === 0) return ''
  const earliestIn = ins.length ? ins.sort()[0] : null
  const latestOut = outs.length ? outs.sort()[outs.length - 1] : null
  return [earliestIn && formatTime(earliestIn), latestOut && formatTime(latestOut)].filter(Boolean).join(' – ')
}

// A day entry may carry either the legacy single `venue_id`/`venue_detail`
// pair, or the newer `venue_ids` (array) + `venue_details` (map) pair for
// multi-venue days. This always normalizes to an array of venue ids.
function dayVenueIds(d) {
  if (d.venue_ids && d.venue_ids.length) return d.venue_ids
  return d.venue_id ? [d.venue_id] : []
}
function dayVenueDetail(d, venueId) {
  if (d.venue_details && d.venue_details[venueId] != null) return d.venue_details[venueId]
  return d.venue_id === venueId ? (d.venue_detail || '') : ''
}

// Builds the "Venue — Detail" label for a single venue id on a given day.
function venueNameFor(venueId, venues, detail) {
  const v = venues.find((x) => x.id === venueId)
  if (!v) return detail || '—'
  return v.name === 'Others' ? (detail || v.name) : [v.name, detail].filter(Boolean).join(' — ')
}

// Builds the venue label for a single day, joining multiple venues
// selected for that same day with " + ".
function dayVenueLabel(d, venues) {
  const ids = dayVenueIds(d)
  if (!ids.length) return '—'
  return ids.map((id) => venueNameFor(id, venues, dayVenueDetail(d, id))).join(' + ')
}

// Returns one "Month Day: Venue A + Venue B" line per day — used to render
// the venue breakdown as a bullet list whenever a multi-day event uses
// different venues (or multiple venues) on different days.
function multiDayVenueLines(event_dates, venues) {
  const days = sortedMultiDayDates(event_dates)
  return days.map((d) => `${formatSingleDateShort(d.event_date)}: ${dayVenueLabel(d, venues)}`)
}

// Builds the venue label for a multi-day event: a single venue name if
// every day uses the same venue(s), otherwise a per-day breakdown so the
// ACP Form clearly shows where each date is held. Plain-text (single
// string) version for the generated PDF, which can't render bullets.
function multiDayVenueLabel(event_dates, venues) {
  const days = sortedMultiDayDates(event_dates)
  const uniqueLabels = [...new Set(days.map((d) => dayVenueLabel(d, venues)))]
  if (uniqueLabels.length <= 1) return uniqueLabels[0] || '—'
  return multiDayVenueLines(event_dates, venues).join('; ')
}

// Plain-text venue label for a single-day submission/application that may
// have one or several venues checked (venue_ids / venue_details), falling
// back to the legacy single venue_id/venue_detail/venues.name shape for
// older rows. Used anywhere the venue needs to be a single string (PDF
// export). Pass either a loaded submission row (with `venues` embedded) or
// the in-progress appForm + its currently selectedVenue.
function singleDayVenueLabel({ venueIds, venueDetails, legacyVenueId, legacyVenueDetail, legacyVenueName }, venues) {
  const ids = venueIds && venueIds.length ? venueIds : (legacyVenueId ? [legacyVenueId] : [])
  if (!ids.length) return legacyVenueName === 'Others' ? (legacyVenueDetail || '—') : [legacyVenueName, legacyVenueDetail].filter(Boolean).join(' — ') || '—'
  return ids.map((id) => {
    const detail = venueDetails?.[id] ?? (id === legacyVenueId ? legacyVenueDetail : '')
    return venueNameFor(id, venues, detail)
  }).join(' + ')
}

// Same inputs as singleDayVenueLabel, but returns one string per venue
// instead of a single " + "-joined line — used to render each venue as
// its own bullet on the generated ACP Form PDF.
function singleDayVenueLines(args, venues) {
  const { venueIds, legacyVenueId } = args
  const ids = venueIds && venueIds.length ? venueIds : (legacyVenueId ? [legacyVenueId] : [])
  if (!ids.length) return [singleDayVenueLabel(args, venues)]
  return ids.map((id) => venueNameFor(id, venues, args.venueDetails?.[id] ?? (id === legacyVenueId ? args.legacyVenueDetail : '')))
}

function formatSingleDateShort(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${d}`
}

const EMPTY_APP_FORM = {
  title: '', contact_person: '', contact_number: '',
  // venue_id/venue_detail are kept (mirroring venue_ids[0]) for backward
  // compatibility with code that still reads a single venue. venue_ids
  // (checked venues) and venue_details (per-venue room/lab/"Others" text)
  // are the source of truth now that venue selection is multi-select.
  venue_id: '', venue_ids: [], venue_detail: '', venue_details: {},
  pencil_booked: '', lab_endorsed: '',
  room_selections: {}, lab_selections: {},
  online_platform: '',
  event_date: '', start_time: '', end_time: '', medium: 'f2f', description: '',
  position: '', email: '', activity_type: '', activity_type_other: '',
  target_audience: '', target_participants: '', projected_budget: '', budget_source: '',
  learning_goal_1: '', learning_goal_2: '', learning_goal_3: '',
  is_multi_day: false,
  event_dates: [{
    event_date: '', start_time: '', end_time: '',
    venue_id: '', venue_ids: [], venue_detail: '', venue_details: {},
    room_selections: {}, lab_selections: {},
    pencil_booked: '',
    wants_additional_time: false, additional_ingress_time: '', additional_egress_time: '',
  }],
  is_continuing: false, continuing_type: 'year_round', term_label: '',
  restricted_period_ack: false, restricted_period_justification: '',
  wants_additional_time: false, additional_ingress_time: '', additional_egress_time: '',
  night_before_ingress: false,
  col_event_tags: [], col_event_other: '',
}

// Merchandise Proposal collects the same fields as an Event Application
// (contact/position info, medium & venue, date/time, target audience,
// budget, description, learning goals) — except the title (auto-set to
// "[Org] Merchandise Proposal") and the SDG section, which is replaced
// on this form by the Types of Merchandise checklist. Continuing-activity,
// restricted-period, and additional ingress/egress-time booking logic are
// event-venue-booking concerns and intentionally don't apply here.
const EMPTY_MERCH_FORM = {
  contact_person: '', contact_number: '',
  event_date: '', description: '',
  position: '', email: '',
  target_audience: '', target_participants: '', projected_budget: '', budget_source: '',
  learning_goal_1: '', learning_goal_2: '', learning_goal_3: '',
  merchandise_duration: '',
}

export default function SubmissionBin() {
  const { profile } = useAuth()
  const admin = isAdminTier(profile?.role)
  const canReview = REVIEWER_ROLES.includes(profile?.role)
  const myOrgId = profile?.org_memberships?.[0]?.org_id
  const myMembershipRoot = profile?.org_memberships?.[0]
  const myOrgIsCOL = myMembershipRoot?.organizations?.category === 'COL'
  const canTagCOLEvents = myOrgIsCOL && COL_EVENT_TAGGER_POSITIONS.includes(myMembershipRoot?.position)
  const location = useLocation()
  const navigate = useNavigate()

  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deletingSubmissionId, setDeletingSubmissionId] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [stageFilter, setStageFilter] = useState('all')
  const [orgFilter, setOrgFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [filterOrgs, setFilterOrgs] = useState([])
  const [venues, setVenues] = useState([])
  const [venueRooms, setVenueRooms] = useState([])
  const [venueLabs, setVenueLabs] = useState([])
  const [templates, setTemplates] = useState([])
  const [openClearances, setOpenClearances] = useState([])

  const [showAppModal, setShowAppModal] = useState(false)
  const [appForm, setAppForm] = useState(EMPTY_APP_FORM)
  const [appFiles, setAppFiles] = useState({})
  const [venueConflict, setVenueConflict] = useState(null)
  const [venueAdvisory, setVenueAdvisory] = useState(null)
  const [checkingVenue, setCheckingVenue] = useState(false)
  // Per-venue availability status for the (possibly multiple) venues
  // checked on the single-day form: { [venueId]: { status, message } }.
  const [venueAvailability, setVenueAvailability] = useState({})
  // Same idea for multi-day rows, one map per day index:
  // { [dayIndex]: { [venueId]: { status, message } } }.
  const [dayVenueAvailability, setDayVenueAvailability] = useState({})
  const [nightBeforeConflict, setNightBeforeConflict] = useState(null)
  const [checkingNightBefore, setCheckingNightBefore] = useState(false)
  const [restrictedPeriods, setRestrictedPeriods] = useState([])

  const [showReportModal, setShowReportModal] = useState(false)
  const [reportClearanceId, setReportClearanceId] = useState('')
  const [reportFiles, setReportFiles] = useState({})

  const [allowMerchandise, setAllowMerchandise] = useState(false)
  const [showMerchModal, setShowMerchModal] = useState(false)
  const [merchForm, setMerchForm] = useState(EMPTY_MERCH_FORM)
  const [merchTypes, setMerchTypes] = useState([])
  const [merchOtherText, setMerchOtherText] = useState('')
  const [merchFiles, setMerchFiles] = useState({})

  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [selected, setSelected] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [history, setHistory] = useState([])
  const [openTasks, setOpenTasks] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionMode, setActionMode] = useState(null)
  const [actionComment, setActionComment] = useState('')
  const [conditionalDueDate, setConditionalDueDate] = useState('')
  const [reportSubmissionDate, setReportSubmissionDate] = useState('')
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState('')

  // Reviewer checklist ("Additional Requirements")
  const [checklist, setChecklist] = useState([])
  const [newChecklistLabel, setNewChecklistLabel] = useState('')
  const [addingChecklistItem, setAddingChecklistItem] = useState(false)

  // Paginated review comments
  const [comments, setComments] = useState([])
  const [commentIndex, setCommentIndex] = useState(0)
  const [showNewComment, setShowNewComment] = useState(false)
  const [newCommentPage, setNewCommentPage] = useState('')
  const [newCommentBody, setNewCommentBody] = useState('')
  const [savingComment, setSavingComment] = useState(false)

  // File viewer (right pane)
  const [viewerAttachmentId, setViewerAttachmentId] = useState(null)

  // Add an additional attachment mid-review / on resubmission
  const [extraDocLabel, setExtraDocLabel] = useState('')
  const [extraDocEntry, setExtraDocEntry] = useState(null)
  const [uploadingExtra, setUploadingExtra] = useState(false)

  // Resubmission (returned submission, owning org)
  const [resubmitting, setResubmitting] = useState(false)
  const [resubmitNote, setResubmitNote] = useState('')

  // Adviser/Dean external approval links (event applications only)
  const [approvalLinks, setApprovalLinks] = useState([])
  const [linkForm, setLinkForm] = useState({ adviser: { name: '', email: '' }, dean: { name: '', email: '' }, sdg_rep: { name: '', email: '' }, marketing_rep: { name: '', email: '' } })
  const [generatingLinkRole, setGeneratingLinkRole] = useState(null)
  const [linkError, setLinkError] = useState('')
  const [copiedRole, setCopiedRole] = useState(null)

  useEffect(() => {
    loadSubmissions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, stageFilter, orgFilter, profile?.id])

  useEffect(() => {
    if (!admin) return
    supabase.from('organizations').select('id, acronym').eq('is_active', true).order('acronym')
      .then(({ data }) => setFilterOrgs(data || []))
  }, [admin])

  useEffect(() => {
    // Whether "New Merchandise Proposal" is available for RSO officers
    // right now — set by SDAO/Admin from Settings.
    supabase.from('app_settings').select('value').eq('key', 'allow_merchandise_submission').single()
      .then(({ data }) => setAllowMerchandise(!!data?.value))
  }, [])

  useEffect(() => {
    // Load clearance status up front (not just when the Submit Report
    // modal opens) so the "settle clearance first" notice and the New
    // Application gate are in place as soon as the page loads.
    if (!admin && myOrgId) loadOpenClearances()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myOrgId])

  useEffect(() => {
    // Live venue-availability check as the applicant checks venue(s) +
    // picks a date in the New Application form — re-runs whenever either
    // changes so stale conflicts (or stale "all clear") don't linger.
    // Every checked venue is checked independently so the applicant can
    // see exactly which one(s) are the problem, rather than one combined
    // pass/fail for the whole selection.
    const ids = appForm.venue_ids || []
    if (!showAppModal || appForm.medium === 'online' || appForm.is_continuing || !ids.length || !appForm.event_date) {
      setVenueConflict(null)
      setVenueAdvisory(null)
      setVenueAvailability({})
      return
    }
    let cancelled = false
    setCheckingVenue(true)
    setVenueAvailability((prev) => {
      const next = {}
      ids.forEach((id) => { next[id] = { status: 'checking' } })
      return next
    })
    Promise.all(ids.map((id) =>
      checkVenueAvailability(
        id, appForm.event_date, appForm.start_time, appForm.end_time,
        appForm.wants_additional_time ? appForm.additional_ingress_time : '',
        appForm.wants_additional_time ? appForm.additional_egress_time : '',
      ).then((result) => [id, result]),
    )).then((results) => {
      if (cancelled) return
      const next = {}
      let blocking = null
      let advisory = null
      results.forEach(([id, result]) => {
        if (result?.blocking) {
          next[id] = { status: 'unavailable', message: result.message }
          blocking = blocking || result.message
        } else if (result) {
          next[id] = { status: 'advisory', message: result.message }
          advisory = advisory || result.message
        } else {
          next[id] = { status: 'available' }
        }
      })
      setVenueAvailability(next)
      // Kept for the existing submit-button disable / inline error UI,
      // which still reads a single combined conflict/advisory message.
      setVenueConflict(blocking)
      setVenueAdvisory(!blocking ? advisory : null)
      setCheckingVenue(false)
    })
    return () => { cancelled = true }
  }, [showAppModal, appForm.venue_ids, appForm.event_date, appForm.medium, appForm.is_continuing, appForm.start_time, appForm.end_time, appForm.wants_additional_time, appForm.additional_ingress_time, appForm.additional_egress_time])

  // Same per-venue availability check, but for every day of a multi-day
  // event — each day can have its own set of checked venues.
  useEffect(() => {
    if (!showAppModal || !appForm.is_multi_day || appForm.medium === 'online') {
      setDayVenueAvailability({})
      return
    }
    let cancelled = false
    ;(async () => {
      const next = {}
      await Promise.all(appForm.event_dates.map(async (entry, idx) => {
        if (!entry.event_date || !entry.venue_ids?.length) return
        const results = await Promise.all(entry.venue_ids.map((id) =>
          checkVenueAvailability(
            id, entry.event_date, entry.start_time, entry.end_time,
            entry.wants_additional_time ? entry.additional_ingress_time : '',
            entry.wants_additional_time ? entry.additional_egress_time : '',
          ).then((result) => [id, result]),
        ))
        const dayMap = {}
        results.forEach(([id, result]) => {
          dayMap[id] = result?.blocking
            ? { status: 'unavailable', message: result.message }
            : result
              ? { status: 'advisory', message: result.message }
              : { status: 'available' }
        })
        next[idx] = dayMap
      }))
      if (!cancelled) setDayVenueAvailability(next)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAppModal, appForm.is_multi_day, appForm.medium, JSON.stringify(appForm.event_dates.map((d) => [d.event_date, d.venue_ids, d.start_time, d.end_time, d.wants_additional_time, d.additional_ingress_time, d.additional_egress_time]))])

  // True if any checked venue, on any day (single-day or multi-day), came
  // back unavailable — used to hard-block submission per the "ask to
  // change, don't allow submit" requirement.
  const anyVenueUnavailable = appForm.is_multi_day
    ? Object.values(dayVenueAvailability).some((dayMap) => Object.values(dayMap).some((s) => s.status === 'unavailable'))
    : Object.values(venueAvailability).some((s) => s.status === 'unavailable')

  useEffect(() => {
    // Live check for the night-before-ingress option — only relevant
    // for the handful of venues large enough to need setup that early.
    // With multiple venues checked, this looks at the first selected
    // venue that's actually night-before-eligible.
    const eligibleVenueId = (appForm.venue_ids || []).find(
      (id) => NIGHT_BEFORE_INGRESS_VENUES.includes(venues.find((v) => v.id === id)?.name),
    )
    if (!showAppModal || appForm.medium === 'online' || appForm.is_continuing || !eligibleVenueId || !appForm.event_date) {
      setNightBeforeConflict(null)
      return
    }
    let cancelled = false
    setCheckingNightBefore(true)
    checkNightBeforeAvailability(eligibleVenueId, appForm.event_date).then((message) => {
      if (!cancelled) {
        setNightBeforeConflict(message)
        setCheckingNightBefore(false)
        if (message) setAppForm((prev) => (prev.night_before_ingress ? { ...prev, night_before_ingress: false } : prev))
      }
    })
    return () => { cancelled = true }
  }, [showAppModal, appForm.venue_ids, appForm.event_date, appForm.medium, appForm.is_continuing, venues])

  useEffect(() => {
    async function loadStatics() {
      const [{ data: v }, { data: t }, { data: rp }, { data: rooms }, { data: labs }] = await Promise.all([
        supabase.from('venues').select('id, name').eq('is_active', true).order('name'),
        supabase.from('templates').select('id, name, category, file_url'),
        supabase.from('restricted_periods').select('id, kind, label, start_date, end_date, note'),
        supabase.from('venue_rooms').select('id, building, floor, room_number').order('building').order('floor').order('sort_order'),
        supabase.from('venue_labs').select('id, name, care_of, location').order('sort_order'),
      ])
      setVenues(v || [])
      setTemplates(t || [])
      setRestrictedPeriods(rp || [])
      setVenueRooms(rooms || [])
      setVenueLabs(labs || [])
    }
    loadStatics()
  }, [])

  async function loadSubmissions() {
    if (!profile) return
    setLoading(true)
    let q = supabase
      .from('submissions')
      .select(`
        id, type, org_id, event_id, title, contact_person, contact_number,
        venue_id, venue_detail, venue_tag, online_platform, pencil_booked, lab_endorsed,
        event_date, start_time, end_time, additional_ingress_time, additional_egress_time, medium, description,
        is_continuing, continuing_type, term_label, report_submission_date,
        is_multi_day, event_dates,
        position, email, activity_type, activity_type_other, target_audience, target_participants,
        projected_budget, budget_source, learning_goals,
        sdgs, sdg_representative, sdg_marked_acp_generated, col_event_tags,
        merchandise_types, merchandise_duration, marketing_representative,
        restricted_period_ack, restricted_period_justification,
        stage, submitted_by, submitted_at,
        organizations ( name, acronym, category ),
        venues ( name ),
        events ( title ),
        submitter:profiles!submissions_submitted_by_fkey ( full_name )
      `)
      .order('submitted_at', { ascending: false })

    if (!admin && myOrgId) q = q.eq('org_id', myOrgId)
    if (!admin && !myOrgId) q = q.eq('org_id', '00000000-0000-0000-0000-000000000000')
    if (admin && orgFilter !== 'all') q = q.eq('org_id', orgFilter)
    if (typeFilter !== 'all') q = q.eq('type', typeFilter)
    if (stageFilter !== 'all') q = q.eq('stage', stageFilter)

    const { data, error } = await q
    setSubmissions(error ? [] : data || [])
    setLoading(false)
  }

  async function loadOpenClearances() {
    if (!myOrgId) return []
    // Materialize any overdue non-event task into a blocking clearance
    // row for this org first — previously this only happened when an
    // admin opened the Assignments page, so an org's block could go
    // unregistered indefinitely. See src/lib/clearanceReconcile.js.
    await reconcileOwnOverdueAssignments(profile)
    const { data } = await supabase
      .from('clearances')
      .select('id, event_id, deadline, extended_deadline, status, events ( title, event_date )')
      .eq('org_id', myOrgId)
      .in('status', ['pending', 'overdue', 'extended'])

    // Self-healing: flip any pending/extended row whose effective deadline
    // has already passed to 'overdue' — there's no server cron, so this
    // reconciles status on every load (same approach as Clearance.jsx).
    // This matters here specifically because the clearance gate on new
    // Event Application submissions only blocks on status = 'overdue',
    // so a stale 'pending' row past its deadline would otherwise let a
    // new application slip through.
    const today = toISODate(new Date())
    const rows = data || []
    const toFlip = rows.filter((c) => {
      if (!['pending', 'extended'].includes(c.status)) return false
      const effective = c.extended_deadline || c.deadline
      return effective < today
    })
    if (toFlip.length > 0) {
      await Promise.all(toFlip.map((c) => supabase.from('clearances').update({ status: 'overdue' }).eq('id', c.id)))
    }
    const flippedIds = new Set(toFlip.map((c) => c.id))
    const reconciled = rows.map((c) => (flippedIds.has(c.id) ? { ...c, status: 'overdue' } : c))

    setOpenClearances(reconciled)
    return reconciled
  }

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
  // required (see gateCappedIngress/gateCappedEgress/additionalTimeNeedsLetter below).
  //
  // Buffers only matter against the OTHER booking's actual event time —
  // i.e. a conflict is when one activity's real (unbuffered) event time
  // falls inside another's buffered window. It's fine for two buffers to
  // overlap each other with no real time inside either: e.g. Event A
  // 7–10 AM (buffers 6 AM–12 PM) and Event B 1–5 PM (buffers 11 AM–7 PM)
  // overlap only in their buffer zones (11 AM–12 PM), which just means A
  // will still be egressing while B is ingressing — allowed, just
  // flagged as a heads-up rather than blocked. Requested *additional*
  // time is held to a stricter standard (see checkVenueAvailability).
  const INGRESS_EGRESS_BUFFER_MIN = 2 * 60
  const GATE_OPEN_MIN = 6 * 60   // 6:00 AM — venue can't be entered earlier
  const GATE_CLOSE_MIN = 21 * 60 // 9:00 PM — venue must be cleared by then

  function toMinutes(t) {
    if (!t) return null
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }

  // The event's real, unbuffered time — used to tell "another activity is
  // actually happening then" apart from "another activity is merely
  // setting up or tearing down then".
  function coreWindow(startTime, endTime) {
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
  function bufferedWindow(startTime, endTime, additionalIngressTime, additionalEgressTime) {
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

  function windowsOverlap(a, b) {
    return a[0] < b[1] && b[0] < a[1]
  }

  // Returns null when the venue/time is clear, or
  // { blocking: true, message } for a real conflict that must block
  // submission, or { blocking: false, message } for a heads-up (buffer
  // zones overlap, but neither activity's real time is affected).
  // additionalIngressTime / additionalEgressTime are the requested
  // additional-time values (if any) for the booking being checked.
  async function checkVenueAvailability(venueId, date, startTime, endTime, additionalIngressTime, additionalEgressTime) {
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

  // Calendar date-1 as an ISO string, for the night-before-ingress window.
  function dayBefore(dateStr) {
    if (!dateStr) return null
    const [y, m, d] = dateStr.split('-').map(Number)
    return toISODate(new Date(y, m - 1, d - 1))
  }

  // Night-before ingress (7:00 PM–9:00 PM the day before the actual
  // event date) is only offered for venues large enough to need
  // setup that early, and only if nothing else at that venue is
  // already occupying that window on that prior date. Returns a
  // conflict message (button should be disabled) or null (clear).
  async function checkNightBeforeAvailability(venueId, eventDate) {
    const priorDate = dayBefore(eventDate)
    if (!venueId || !priorDate) return null

    const [{ data: priorEvents }, { data: priorBlocks }] = await Promise.all([
      supabase
        .from('events')
        .select('id, booking_status, start_time, end_time, additional_ingress_time, additional_egress_time, organizations ( acronym )')
        .eq('venue_id', venueId)
        .eq('event_date', priorDate)
        .in('booking_status', ['pencil', 'reserved']),
      supabase
        .from('venue_blocks')
        .select('id, reason')
        .eq('venue_id', venueId)
        .eq('block_date', priorDate),
    ])

    if (priorBlocks && priorBlocks.length > 0) {
      return `This venue is blocked the night before (${priorBlocks[0].reason || 'maintenance/holiday'}) — ingress request unavailable.`
    }

    const nightWindow = [NIGHT_BEFORE_START_MIN, NIGHT_BEFORE_END_MIN]
    for (const ev of priorEvents || []) {
      const evBuffered = bufferedWindow(ev.start_time, ev.end_time, ev.additional_ingress_time, ev.additional_egress_time)
      if (!evBuffered) {
        return `This venue already has an event booked the night before — ingress request unavailable.`
      }
      if (windowsOverlap(nightWindow, evBuffered)) {
        const orgLabel = ev.organizations?.acronym || 'another activity'
        return `${orgLabel} already has this venue booked the night before during 7:00–9:00 PM — ingress request unavailable.`
      }
    }
    return null
  }

  // Holiday / exam-week (+ the week before) advisory: unlike the venue
  // conflict check above, this never blocks submission — it's flagged
  // by admin/SDAO/QMO/FMO on the Calendar as a date range where new
  // activities are discouraged. The applicant just has to acknowledge
  // it, and may add a justification if the case is extraordinary.
  function restrictedPeriodFor(date) {
    if (!date) return null
    return restrictedPeriods.find((p) => p.start_date <= date && p.end_date >= date) || null
  }

  function templateFor(docName) {
    return templates.find((t) => t.name.toLowerCase() === docName.toLowerCase())
  }

  // signedUrl / stored value looks like:
  //   https://.../storage/v1/object/sign/submission-attachments/<path>?token=...
  // or, if createSignedUrl failed at upload time, just the raw <path>.
  // Either way we want the "<path>" part to pass to storage.remove().
  function extractStoragePath(fileUrl) {
    if (!fileUrl) return null
    const marker = '/submission-attachments/'
    const idx = fileUrl.indexOf(marker)
    if (idx === -1) return fileUrl // already a bare path
    return fileUrl.slice(idx + marker.length).split('?')[0]
  }

  async function uploadAttachment(submissionId, docType, entry) {
    // Pasted link — no storage upload needed, just record the URL.
    if (entry.type === 'link') {
      await supabase.from('submission_attachments').insert({
        submission_id: submissionId,
        document_type: docType,
        file_url: entry.url.trim(),
      })
      return
    }

    const file = entry
    const ext = file.name.split('.').pop()
    const path = `${submissionId}/${docType.replace(/\s+/g, '-')}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('submission-attachments').upload(path, file)
    if (upErr) throw upErr
    const { data: signed } = await supabase.storage
      .from('submission-attachments')
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 5)
    await supabase.from('submission_attachments').insert({
      submission_id: submissionId,
      document_type: docType,
      file_url: signed?.signedUrl || path,
    })
  }

  // Fired once the SDG Representative has approved their link (writing
  // marked SDGs onto `submissions.sdgs`) — swaps the blank-boxes ACP
  // Form generated at submission time for one with the SDGs marked.
  // Guarded by `sdg_marked_acp_generated` so it only fires once per
  // submission even if the reviewer reopens the record.
  async function regenerateAcpWithSdgMarks(sub) {
    try {
      const { data: fullSub } = await supabase
        .from('submissions')
        .select('*, organizations ( name ), venues ( name )')
        .eq('id', sub.id)
        .single()
      if (!fullSub) return

      const venueLabel = fullSub.medium === 'online'
        ? [ONLINE_PLATFORMS.find((p) => p.value === fullSub.online_platform)?.label, fullSub.online_platform === 'others' ? fullSub.venue_detail : null].filter(Boolean).join(' — ')
        : fullSub.is_multi_day && fullSub.event_dates?.length
          ? multiDayVenueLabel(fullSub.event_dates, venues)
          : singleDayVenueLabel({
              venueIds: fullSub.venue_ids, venueDetails: fullSub.venue_details,
              legacyVenueId: fullSub.venue_id, legacyVenueDetail: fullSub.venue_detail, legacyVenueName: fullSub.venues?.name,
            }, venues)
      const venueLabelLines = fullSub.medium === 'online'
        ? [venueLabel]
        : fullSub.is_multi_day && fullSub.event_dates?.length
          ? multiDayVenueLines(fullSub.event_dates, venues)
          : singleDayVenueLines({
              venueIds: fullSub.venue_ids, venueDetails: fullSub.venue_details,
              legacyVenueId: fullSub.venue_id, legacyVenueDetail: fullSub.venue_detail, legacyVenueName: fullSub.venues?.name,
            }, venues)
      const timeRange = fullSub.is_multi_day && fullSub.event_dates?.length
        ? compileMultiDayTimeRange(fullSub.event_dates)
        : [fullSub.start_time && formatTime(fullSub.start_time), fullSub.end_time && formatTime(fullSub.end_time)].filter(Boolean).join(' – ')
      const activityTypeLabel = fullSub.activity_type === 'other'
        ? fullSub.activity_type_other
        : ACTIVITY_TYPES.find((t) => t.value === fullSub.activity_type)?.label
      const acpDateLabel = fullSub.is_continuing
        ? (fullSub.continuing_type === 'term' ? `Term ${(fullSub.term_label || '').trim()}` : 'Year-Round')
        : fullSub.is_multi_day && fullSub.event_dates?.length
          ? formatEventDates(fullSub.event_dates.map((d) => d.event_date))
          : fullSub.event_date

      const pdfBytes = await generateACPFormPdf({
        applicationDate: toISODate(new Date(fullSub.submitted_at)),
        orgName: fullSub.organizations?.name || '',
        contactPerson: fullSub.contact_person,
        position: fullSub.position,
        email: fullSub.email,
        title: fullSub.title,
        activityTypeLabel,
        venueAddress: venueLabel,
        venueAddressLines: venueLabelLines,
        targetAudience: fullSub.target_audience,
        targetParticipants: fullSub.target_participants,
        eventDate: acpDateLabel,
        timeRange,
        projectedBudget: fullSub.projected_budget,
        budgetSource: fullSub.budget_source,
        sdgs: fullSub.sdgs,
        sdgRepresentative: fullSub.sdg_representative,
        learningGoals: fullSub.learning_goals,
        description: fullSub.description,
      })
      const acpFile = new File([pdfBytes], `ACP-Form-${sub.id}-sdg-marked.pdf`, { type: 'application/pdf' })

      const { data: oldAcpRows } = await supabase
        .from('submission_attachments')
        .select('id, file_url')
        .eq('submission_id', sub.id).eq('document_type', 'ACP Form')
      const { error: delErr } = await supabase.from('submission_attachments').delete()
        .eq('submission_id', sub.id).eq('document_type', 'ACP Form')
      if (!delErr) {
        for (const row of oldAcpRows || []) {
          const path = extractStoragePath(row.file_url)
          if (path) await supabase.storage.from('submission-attachments').remove([path])
        }
      }
      await uploadAttachment(sub.id, 'ACP Form', acpFile)
      await supabase.from('submissions').update({ sdg_marked_acp_generated: true }).eq('id', sub.id)

      // No need to set attachments state here — openDetail awaits this
      // function before it runs its own attachments fetch, so that
      // fetch will already pick up the swapped-in ACP Form.
      setSubmissions((prev) => prev.map((s) => (s.id === sub.id ? { ...s, sdg_marked_acp_generated: true } : s)))
    } catch (err) {
      console.error('Failed to regenerate ACP Form with SDG marks', err)
    }
  }

  // Block on ANY open clearance (pending or overdue) whose EVENT DATE has
  // already passed — not just ones the deadline reconciliation has
  // already flipped to 'overdue', and not on report-submission deadline
  // at all. An org stays clear all the way through the day of the event
  // itself; the block kicks in starting the day AFTER. Example: event on
  // Aug 8 — clear through Aug 8, blocked from Aug 9 onward, even though
  // the clearance may still show status 'pending' (its 7-day report
  // deadline hasn't passed yet).
  //
  // Assignment-based clearance issues (event_id is null — an overdue
  // non-event task) have no event date to compare against, so those
  // keep blocking purely on status === 'overdue', as before.
  const todayISO = toISODate(new Date())
  const overdueClearances = openClearances.filter((c) => {
    if (!c.event_id) return c.status === 'overdue'
    const eventDate = c.events?.event_date
    return !!eventDate && eventDate < todayISO
  })
  const blockingClearances = overdueClearances
  const clearanceBlocked = blockingClearances.length > 0

  const activeRestrictedPeriod = !appForm.is_continuing ? restrictedPeriodFor(appForm.event_date) : null
  // Every activity auto-gets a 2-hour ingress buffer before its start and
  // a 2-hour egress buffer after its end, but the venue can only be
  // entered from 6:00 AM and must be cleared by 9:00 PM — so an event
  // starting before 8:00 AM won't get the full 2 hours of ingress (it's
  // capped at 6:00 AM), and one ending after 7:00 PM won't get the full
  // 2 hours of egress (capped at 9:00 PM). This is just informational —
  // it doesn't block submission or need a letter by itself.
  const gateCappedIngress = !appForm.is_continuing && !!appForm.start_time && appForm.start_time < '08:00'
  const gateCappedEgress = !appForm.is_continuing && !!appForm.end_time && appForm.end_time > '19:00'

  // Requesting additional ingress/egress time beyond the gate-capped
  // buffer, past the actual gate hours (before 6:00 AM / after 9:00 PM),
  // requires a Security Office letter.
  const additionalIngressNeedsLetter = appForm.wants_additional_time && !!appForm.additional_ingress_time && appForm.additional_ingress_time < '06:00'
  const additionalEgressNeedsLetter = appForm.wants_additional_time && !!appForm.additional_egress_time && appForm.additional_egress_time > '21:00'
  const additionalTimeNeedsLetter = additionalIngressNeedsLetter || additionalEgressNeedsLetter

  // The actual ingress/egress clock times to show under the Start/End
  // Time fields — the normal 2-hour buffer capped to gate hours, widened
  // to cover any requested additional time.
  function minutesToClock(min) {
    if (min == null) return null
    const h = Math.floor(min / 60) % 24
    const m = min % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  const displayedBuffer = !appForm.is_continuing && appForm.start_time && appForm.end_time
    ? bufferedWindow(
        appForm.start_time, appForm.end_time,
        appForm.wants_additional_time ? appForm.additional_ingress_time : '',
        appForm.wants_additional_time ? appForm.additional_egress_time : '',
      )
    : null
  const displayIngressTime = displayedBuffer ? formatTime(minutesToClock(displayedBuffer[0])) : ''
  const displayEgressTime = displayedBuffer ? formatTime(minutesToClock(displayedBuffer[1])) : ''

  // Legacy single-venue name — still used as a fallback wherever a lone
  // venue name is needed and venue_ids hasn't been populated yet.
  const selectedVenueName = venues.find((v) => v.id === appForm.venue_id)?.name
  const selectedVenueNames = (appForm.venue_ids || []).map((id) => venues.find((v) => v.id === id)?.name).filter(Boolean)
  const roomBuildingOptionsFor = () => [...new Set(venueRooms.map((r) => r.building))]
  const roomFloorOptionsFor = (building) => [...new Set(venueRooms.filter((r) => r.building === building).map((r) => r.floor))]
  const roomNumberOptionsFor = (building, floor) => venueRooms.filter((r) => r.building === building && r.floor === floor)
  const nightBeforeEligible = appForm.medium !== 'online' && !appForm.is_continuing
    && selectedVenueNames.some((n) => NIGHT_BEFORE_INGRESS_VENUES.includes(n))
  const nightBeforeDateISO = appForm.event_date ? dayBefore(appForm.event_date) : ''
  const nightBeforeDateLabel = nightBeforeDateISO
    ? (() => {
        const [y, m, d] = nightBeforeDateISO.split('-').map(Number)
        return `${MONTH_NAMES[m - 1]} ${d}, ${y}`
      })()
    : ''

  function openAppModal() {
    // Clearance gate: an org with a settled-past-deadline clearance
    // (an unresolved activity report, or an overdue non-event task)
    // can't start a new Event Application until it's resolved — this
    // mirrors the DB-level RLS policy on submissions, but blocks it in
    // the UI up front instead of letting the org fill out the whole
    // form first.
    if (clearanceBlocked) return
    const myMembership = profile?.org_memberships?.find((m) => m.org_id === myOrgId)
    setAppForm({ ...EMPTY_APP_FORM, position: myMembership?.position || '' })
    setAppFiles({})
    setFormError('')
    setVenueConflict(null)
    setVenueAdvisory(null)
    setShowAppModal(true)
  }

  async function openReportModal(preselectEventId) {
    const data = await loadOpenClearances()
    const preselect = preselectEventId ? data.find((c) => c.event_id === preselectEventId) : null
    setReportClearanceId(preselect?.id || '')
    setReportFiles({})
    setFormError('')
    setShowReportModal(true)
  }

  function openMerchModal() {
    if (!allowMerchandise) return
    const myMembership = profile?.org_memberships?.find((m) => m.org_id === myOrgId)
    setMerchForm({ ...EMPTY_MERCH_FORM, position: myMembership?.position || '' })
    setMerchTypes([])
    setMerchOtherText('')
    setMerchFiles({})
    setFormError('')
    setShowMerchModal(true)
  }

  useEffect(() => {
    if (location.state?.autoOpenReportForEventId && myOrgId) {
      openReportModal(location.state.autoOpenReportForEventId)
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, myOrgId])

  async function handleSubmitApp(e) {
    e.preventDefault()
    setFormError('')

    // Re-check the clearance gate at submit time, not just when the modal
    // was opened — an org can go from clear to overdue while the modal is
    // sitting open (e.g. a deadline passes, or another tab flips a task to
    // overdue), and the Submit button has no `disabled` wiring of its own.
    if (clearanceBlocked) {
      setFormError("Your organization has an overdue clearance — settle it before submitting a new Event Application.")
      return
    }

    if (!appForm.title || !appForm.contact_person || !appForm.medium) {
      setFormError('Please fill in the event name, contact person, and medium.')
      return
    }
    if (appForm.medium === 'online') {
      if (!appForm.online_platform) {
        setFormError('Please select the online platform.')
        return
      }
      if (appForm.online_platform === 'others' && !appForm.venue_detail.trim()) {
        setFormError('Please specify the online platform.')
        return
      }
    } else if (!appForm.is_multi_day && !appForm.venue_ids.length) {
      setFormError('Please select at least one venue.')
      return
    } else if (!appForm.is_multi_day && appForm.venue_ids.some((id) => venues.find((v) => v.id === id)?.name === 'Others' && !(appForm.venue_details[id] || '').trim())) {
      setFormError('Please specify the venue for every "Others" selection.')
      return
    }
    if (!appForm.is_continuing && !appForm.is_multi_day && !appForm.event_date) {
      setFormError('Please fill in the date.')
      return
    }
    if (appForm.is_multi_day && appForm.event_dates.some((d) => !d.event_date)) {
      setFormError('Please fill in all the dates, or remove the empty date picker.')
      return
    }
    if (appForm.is_multi_day && appForm.medium !== 'online' && appForm.event_dates.some((d) => !d.venue_ids?.length)) {
      setFormError('Please select at least one venue for every day.')
      return
    }
    if (appForm.is_multi_day && appForm.medium !== 'online' && appForm.event_dates.some((d) =>
      (d.venue_ids || []).some((id) => venues.find((v) => v.id === id)?.name === 'Others' && !(d.venue_details?.[id] || '').trim()),
    )) {
      setFormError('Please specify the venue for every day\'s "Others" selection.')
      return
    }
    if (!appForm.is_continuing && anyVenueUnavailable) {
      setFormError('One or more selected venues are unavailable on the chosen date — please change them before submitting.')
      return
    }
    if (!appForm.position || !appForm.email) {
      setFormError('Please fill in your position and email address.')
      return
    }
    if (!appForm.activity_type || (appForm.activity_type === 'other' && !appForm.activity_type_other.trim())) {
      setFormError('Please select the type of activity.')
      return
    }
    if (!appForm.target_audience || !appForm.target_participants) {
      setFormError('Please fill in the target audience and target number of participants.')
      return
    }
    if (!appForm.projected_budget || !appForm.budget_source) {
      setFormError('Please fill in the projected budget and its source.')
      return
    }
    if (!appForm.learning_goal_1.trim()) {
      setFormError('Please fill in at least one learning goal/objective.')
      return
    }
    if (appForm.is_continuing && appForm.continuing_type === 'term' && !appForm.term_label.trim()) {
      setFormError('Please specify the term (e.g. "1st Term, SY 2026-2027").')
      return
    }
    if (activeRestrictedPeriod) {
      if (!appForm.restricted_period_ack) {
        setFormError('Please acknowledge the holiday/exam period notice before submitting.')
        return
      }
      if (!appForm.restricted_period_justification.trim()) {
        setFormError('Please briefly explain the extraordinary circumstance for booking during this period.')
        return
      }
    }

    // Re-check venue availability right before submitting — guards
    // against another org grabbing the slot (or FMO blocking it)
    // between the live check above and now. Every checked venue, on
    // every day, is re-checked — a late conflict on any one of them
    // blocks submission.
    if (!appForm.is_continuing && appForm.medium !== 'online') {
      const daysToCheck = appForm.is_multi_day
        ? appForm.event_dates
        : [{ event_date: appForm.event_date, start_time: appForm.start_time, end_time: appForm.end_time, venue_ids: appForm.venue_ids, wants_additional_time: appForm.wants_additional_time, additional_ingress_time: appForm.additional_ingress_time, additional_egress_time: appForm.additional_egress_time }]
      for (const day of daysToCheck) {
        if (!day.event_date) continue
        for (const venueId of day.venue_ids || []) {
          const result = await checkVenueAvailability(
            venueId, day.event_date, day.start_time, day.end_time,
            day.wants_additional_time ? day.additional_ingress_time : '',
            day.wants_additional_time ? day.additional_egress_time : '',
          )
          if (result?.blocking) {
            setFormError(`${venues.find((v) => v.id === venueId)?.name || 'A selected venue'}: ${result.message}`)
            if (!appForm.is_multi_day) setVenueConflict(result.message)
            return
          }
        }
      }
      if (!appForm.is_multi_day) setVenueConflict(null)
    }

    const isOnline = appForm.medium === 'online'
    const selectedVenue = isOnline ? null : venues.find((v) => v.id === appForm.venue_id)
    const venueName = selectedVenue?.name
    const detailPrompt = VENUE_DETAIL_PROMPTS[venueName]
    if (!isOnline && !appForm.is_multi_day) {
      const missingDetail = appForm.venue_ids.some((id) => VENUE_DETAIL_PROMPTS[venues.find((v) => v.id === id)?.name] && !(appForm.venue_details[id] || '').trim())
      if (missingDetail) {
        setFormError('Please fill in the room/lab/venue detail for every selected venue that needs it.')
        return
      }
      if (!appForm.pencil_booked) {
        setFormError('Please confirm whether this has been pencil booked with INSPIRE or Facilities Office.')
        return
      }
      if (appForm.venue_ids.some((id) => venues.find((v) => v.id === id)?.name === 'Laboratory') && !appForm.lab_endorsed) {
        setFormError('Please confirm whether the laboratory owner has endorsed this booking.')
        return
      }
    }

    for (const doc of EVENT_APP_DOCS) {
      const err = validateAttachmentEntry(doc, appFiles[doc])
      if (err) {
        setFormError(err)
        return
      }
    }

    setSaving(true)
    const { data: sub, error: err } = await supabase.from('submissions').insert({
      type: 'event_application',
      org_id: myOrgId,
      title: appForm.title,
      contact_person: appForm.contact_person,
      contact_number: appForm.contact_number || null,
      // venue_id/venue_detail keep pointing at the FIRST selected venue
      // of the first day, for backward compatibility with joins/reports
      // that still read a single venue. venue_ids/venue_details carry
      // the complete multi-venue selection for that same first day (the
      // full per-day breakdown for multi-day events lives in event_dates).
      venue_id: isOnline
        ? null
        : (appForm.is_multi_day ? (dayVenueIds(sortedMultiDayDates(appForm.event_dates)[0] || {})[0] || null) : (appForm.venue_ids[0] || null)),
      venue_ids: isOnline
        ? []
        : (appForm.is_multi_day ? dayVenueIds(sortedMultiDayDates(appForm.event_dates)[0] || {}) : appForm.venue_ids),
      venue_detail: isOnline
        ? (appForm.online_platform === 'others' ? appForm.venue_detail.trim() : null)
        : (appForm.is_multi_day
          ? dayVenueDetail(sortedMultiDayDates(appForm.event_dates)[0] || {}, dayVenueIds(sortedMultiDayDates(appForm.event_dates)[0] || {})[0])
          : (detailPrompt ? (appForm.venue_details[appForm.venue_ids[0]] || '').trim() : null)),
      venue_details: isOnline
        ? {}
        : (appForm.is_multi_day ? (sortedMultiDayDates(appForm.event_dates)[0]?.venue_details || {}) : appForm.venue_details),
      venue_tag: isOnline
        ? null
        : (appForm.is_multi_day
          ? venueTagFor(venues.find((v) => v.id === dayVenueIds(sortedMultiDayDates(appForm.event_dates)[0] || {})[0])?.name)
          : venueTagFor(venueName)),
      online_platform: isOnline ? appForm.online_platform : null,
      pencil_booked: isOnline
        ? null
        : (appForm.is_multi_day ? (sortedMultiDayDates(appForm.event_dates)[0]?.pencil_booked === 'yes') : appForm.pencil_booked === 'yes'),
      lab_endorsed: !isOnline && !appForm.is_multi_day && venueName === 'Laboratory' ? appForm.lab_endorsed === 'yes' : null,
      event_date: appForm.is_continuing
        ? null
        : (appForm.is_multi_day ? sortedMultiDayDates(appForm.event_dates)[0]?.event_date : appForm.event_date),
      start_time: appForm.is_continuing
        ? null
        : (appForm.is_multi_day ? (sortedMultiDayDates(appForm.event_dates)[0]?.start_time || null) : (appForm.start_time || null)),
      end_time: appForm.is_continuing
        ? null
        : (appForm.is_multi_day ? (sortedMultiDayDates(appForm.event_dates)[0]?.end_time || null) : (appForm.end_time || null)),
      is_multi_day: !appForm.is_continuing && appForm.is_multi_day,
      event_dates: (!appForm.is_continuing && appForm.is_multi_day) ? sortedMultiDayDates(appForm.event_dates) : null,
      medium: appForm.medium,
      description: appForm.description || null,
      position: appForm.position,
      email: appForm.email,
      activity_type: appForm.activity_type,
      activity_type_other: appForm.activity_type === 'other' ? appForm.activity_type_other.trim() : null,
      target_audience: appForm.target_audience,
      target_participants: Number(appForm.target_participants),
      projected_budget: Number(appForm.projected_budget),
      budget_source: appForm.budget_source,
      // SDGs are no longer self-declared by the student — they're left
      // blank here and marked externally by the SDG Representative
      // (see the sdg_rep approval-link step), which also fills in
      // sdg_representative once they've signed off.
      sdgs: [],
      sdg_representative: null,
      learning_goals: [appForm.learning_goal_1, appForm.learning_goal_2, appForm.learning_goal_3].map((g) => g.trim()).filter(Boolean),
      is_continuing: appForm.is_continuing,
      continuing_type: appForm.is_continuing ? appForm.continuing_type : null,
      term_label: appForm.is_continuing && appForm.continuing_type === 'term' ? appForm.term_label.trim() : null,
      restricted_period_ack: !!activeRestrictedPeriod && appForm.restricted_period_ack,
      restricted_period_justification: activeRestrictedPeriod ? appForm.restricted_period_justification.trim() : null,
      additional_ingress_time: appForm.wants_additional_time && appForm.additional_ingress_time ? appForm.additional_ingress_time : null,
      additional_egress_time: appForm.wants_additional_time && appForm.additional_egress_time ? appForm.additional_egress_time : null,
      night_before_ingress: nightBeforeEligible && !nightBeforeConflict && appForm.night_before_ingress,
      submitted_by: profile.id,
      ...(canTagCOLEvents ? {
        col_event_tags: [
          ...appForm.col_event_tags,
          ...(appForm.col_event_tags.includes('Others') && appForm.col_event_other.trim() ? [appForm.col_event_other.trim()] : []),
        ].filter((t) => t !== 'Others'),
      } : {}),
    }).select().single()

    if (err) {
      setSaving(false)
      setFormError(
        err.code === '42501' || err.message?.toLowerCase().includes('row-level security')
          ? "Your organization has an unresolved clearance report — submit that report first before applying for a new activity."
          : 'Could not submit your application. Please try again.'
      )
      return
    }

    // Pencil-book this on the calendar right away — while it's under
    // review/approval it shows as tentative, and stays that way (or goes
    // gray if returned) until the application is approved or rejected.
    // Year-Round/Term activities have no single date yet, so they skip
    // the calendar entirely for now — one gets created once the SDAO
    // Assistant assigns a report submission date/deadline.
    if (!sub.is_continuing) {
      const { data: newEvent } = await supabase.from('events').insert({
        title: sub.title,
        org_id: sub.org_id,
        contact_person: sub.contact_person,
        contact_number: sub.contact_number,
        description: sub.description,
        venue_id: sub.venue_id,
        venue_ids: sub.venue_ids,
        venue_detail: sub.venue_detail,
        venue_details: sub.venue_details,
        event_date: sub.event_date || toISODate(new Date()),
        start_time: sub.start_time,
        end_time: sub.end_time,
        additional_ingress_time: sub.additional_ingress_time,
        additional_egress_time: sub.additional_egress_time,
        night_before_ingress: sub.night_before_ingress,
        medium: sub.medium,
        booking_status: 'pencil',
        submission_id: sub.id,
        created_by: profile.id,
      }).select().single()
      if (newEvent) {
        await supabase.from('submissions').update({ event_id: newEvent.id }).eq('id', sub.id)
      }
    }

    // Auto-generate the filled ACP Form PDF from what was just submitted
    // and attach it — no manual upload needed.
    try {
      const myMembership = profile?.org_memberships?.find((m) => m.org_id === myOrgId)
      const orgName = myMembership?.organizations?.name || ''
      const venueLabel = isOnline
        ? [ONLINE_PLATFORMS.find((p) => p.value === appForm.online_platform)?.label, appForm.online_platform === 'others' ? appForm.venue_detail : null].filter(Boolean).join(' — ')
        : appForm.is_multi_day
          ? multiDayVenueLabel(appForm.event_dates, venues)
          : singleDayVenueLabel({
              venueIds: appForm.venue_ids, venueDetails: appForm.venue_details,
              legacyVenueId: appForm.venue_id, legacyVenueDetail: appForm.venue_detail, legacyVenueName: selectedVenue?.name,
            }, venues)
      const venueLabelLines = isOnline
        ? [venueLabel]
        : appForm.is_multi_day
          ? multiDayVenueLines(appForm.event_dates, venues)
          : singleDayVenueLines({
              venueIds: appForm.venue_ids, venueDetails: appForm.venue_details,
              legacyVenueId: appForm.venue_id, legacyVenueDetail: appForm.venue_detail, legacyVenueName: selectedVenue?.name,
            }, venues)
      const timeRange = appForm.is_multi_day
        ? compileMultiDayTimeRange(appForm.event_dates)
        : [appForm.start_time && formatTime(appForm.start_time), appForm.end_time && formatTime(appForm.end_time)].filter(Boolean).join(' – ')
      const activityTypeLabel = appForm.activity_type === 'other'
        ? appForm.activity_type_other
        : ACTIVITY_TYPES.find((t) => t.value === appForm.activity_type)?.label
      const acpDateLabel = appForm.is_continuing
        ? (appForm.continuing_type === 'term' ? `Term ${appForm.term_label.trim()}` : 'Year-Round')
        : appForm.is_multi_day
          ? formatEventDates(appForm.event_dates.map((d) => d.event_date))
          : appForm.event_date

      const pdfBytes = await generateACPFormPdf({
        applicationDate: toISODate(new Date()),
        orgName,
        contactPerson: appForm.contact_person,
        position: appForm.position,
        email: appForm.email,
        title: appForm.title,
        activityTypeLabel,
        venueAddress: venueLabel,
        venueAddressLines: venueLabelLines,
        targetAudience: appForm.target_audience,
        targetParticipants: appForm.target_participants,
        eventDate: acpDateLabel,
        timeRange,
        projectedBudget: appForm.projected_budget,
        budgetSource: appForm.budget_source,
        // Blank at first submission — no marks yet. The ACP is
        // regenerated with marks once the SDG Representative signs off.
        sdgs: [],
        sdgRepresentative: null,
        learningGoals: [appForm.learning_goal_1, appForm.learning_goal_2, appForm.learning_goal_3],
        description: appForm.description,
      })
      const acpFile = new File([pdfBytes], `ACP-Form-${sub.id}.pdf`, { type: 'application/pdf' })
      await uploadAttachment(sub.id, 'ACP Form', acpFile)
    } catch (pdfErr) {
      console.error('Failed to auto-generate ACP Form PDF', pdfErr)
      setFormError('Application submitted, but the ACP Form PDF could not be generated — you can attach one manually from the list.')
    }

    const failedDocs = []
    for (const doc of EVENT_APP_DOCS) {
      try {
        await uploadAttachment(sub.id, doc, appFiles[doc])
      } catch (uploadErr) {
        console.error(`Failed to upload ${doc}`, uploadErr)
        failedDocs.push(doc)
      }
    }
    await supabase.from('submission_status_history').insert({
      submission_id: sub.id, stage: 'submitted', action: 'submitted', actor_id: profile.id,
    })
    if (failedDocs.length) {
      setFormError(`Application submitted, but ${failedDocs.join(', ')} failed to upload — reopen it from the list to re-attach.`)
    }

    setSaving(false)
    if (!failedDocs.length) setShowAppModal(false)
    loadSubmissions()
  }

  async function handleSubmitReport(e) {
    e.preventDefault()
    setFormError('')

    if (!reportClearanceId) {
      setFormError('Please select which activity this report is for.')
      return
    }
    for (const doc of REPORT_DOCS) {
      const err = validateAttachmentEntry(doc, reportFiles[doc])
      if (err) {
        setFormError(err)
        return
      }
    }

    const clearance = openClearances.find((c) => c.id === reportClearanceId)

    setSaving(true)
    const { data: sub, error: err } = await supabase.from('submissions').insert({
      type: 'report',
      org_id: myOrgId,
      event_id: clearance?.event_id,
      title: `Activity Report — ${clearance?.events?.title || 'Untitled Activity'}`,
      submitted_by: profile.id,
    }).select().single()

    if (err) {
      setSaving(false)
      setFormError('Could not submit your report. Please try again.')
      return
    }

    const failedDocs = []
    for (const doc of REPORT_DOCS) {
      try {
        await uploadAttachment(sub.id, doc, reportFiles[doc])
      } catch (uploadErr) {
        console.error(`Failed to upload ${doc}`, uploadErr)
        failedDocs.push(doc)
      }
    }
    await supabase.from('submission_status_history').insert({
      submission_id: sub.id, stage: 'submitted', action: 'submitted', actor_id: profile.id,
    })
    if (clearance?.event_id) {
      const { error: asgErr } = await supabase.from('assignments')
        .update({ status: 'submitted', submission_id: sub.id, updated_at: new Date().toISOString() })
        .eq('event_id', clearance.event_id)
        .eq('auto_generated', true)
        .in('status', ['pending', 'returned', 'conditional_approved'])
      if (asgErr) console.error('Failed to update linked assignment status', asgErr)
    }
    if (failedDocs.length) {
      setFormError(`Report submitted, but ${failedDocs.join(', ')} failed to upload — reopen it from the list to re-attach.`)
    }

    setSaving(false)
    if (!failedDocs.length) setShowReportModal(false)
    loadSubmissions()
  }

  async function handleSubmitMerch(e) {
    e.preventDefault()
    setFormError('')

    if (clearanceBlocked) {
      setFormError("Your organization has an overdue clearance — settle it before submitting a new Merchandise Proposal.")
      return
    }

    if (merchTypes.length === 0) {
      setFormError('Please check at least one type of merchandise.')
      return
    }
    if (merchTypes.includes('Others') && !merchOtherText.trim()) {
      setFormError('Please specify the "Others" type of merchandise.')
      return
    }
    if (!merchForm.contact_person) {
      setFormError('Please fill in the contact person.')
      return
    }
    if (!merchForm.event_date) {
      setFormError('Please fill in the release date.')
      return
    }
    if (!merchForm.position || !merchForm.email) {
      setFormError('Please fill in your position and email address.')
      return
    }
    if (!merchForm.merchandise_duration) {
      setFormError('Please select whether this is Permanent Merchandise or Exclusive this Academic Year.')
      return
    }
    if (!merchForm.target_audience || !merchForm.target_participants) {
      setFormError('Please fill in the target audience and target number of participants.')
      return
    }
    if (!merchForm.projected_budget || !merchForm.budget_source) {
      setFormError('Please fill in the projected budget and its source.')
      return
    }
    if (!merchForm.learning_goal_1.trim()) {
      setFormError('Please fill in at least one learning goal/objective.')
      return
    }
    for (const doc of MERCH_DOCS) {
      const err = validateAttachmentEntry(doc, merchFiles[doc])
      if (err) {
        setFormError(err)
        return
      }
    }

    const myMembership = profile?.org_memberships?.find((m) => m.org_id === myOrgId)
    const orgName = myMembership?.organizations?.name || myMembership?.organizations?.acronym || 'Org'

    // "Others" prints/stores with its specify text in place of the bare
    // checkbox label — e.g. "Others: Enamel pins" — so the detail is
    // captured without needing a separate DB column.
    const finalMerchTypes = merchTypes.map((t) => (
      t === 'Others' && merchOtherText.trim() ? `Others: ${merchOtherText.trim()}` : t
    ))

    setSaving(true)
    const { data: sub, error: err } = await supabase.from('submissions').insert({
      type: 'merchandise',
      org_id: myOrgId,
      title: `${orgName} Merchandise Proposal`,
      contact_person: merchForm.contact_person,
      contact_number: merchForm.contact_number || null,
      event_date: merchForm.event_date,
      start_time: null,
      end_time: null,
      description: merchForm.description || null,
      position: merchForm.position,
      email: merchForm.email,
      activity_type: 'other',
      activity_type_other: MERCH_ACTIVITY_TYPE_LABEL,
      target_audience: merchForm.target_audience,
      target_participants: Number(merchForm.target_participants),
      projected_budget: Number(merchForm.projected_budget),
      budget_source: merchForm.budget_source,
      learning_goals: [merchForm.learning_goal_1, merchForm.learning_goal_2, merchForm.learning_goal_3].map((g) => g.trim()).filter(Boolean),
      merchandise_types: finalMerchTypes,
      merchandise_duration: merchForm.merchandise_duration,
      submitted_by: profile.id,
    }).select().single()

    if (err) {
      setSaving(false)
      setFormError(
        err.code === '42501' || err.message?.toLowerCase().includes('row-level security')
          ? "Your organization has an unresolved clearance report — submit that report first before applying for a new activity."
          : 'Could not submit your proposal. Please try again.'
      )
      return
    }

    // Auto-generate the filled Merchandise Request Form PDF — same
    // renderer as the ACP Form, minus the SDG section (see acpPdf.js).
    try {
      const merchandiseDurationLabel = MERCH_DURATIONS.find((d) => d.value === merchForm.merchandise_duration)?.label

      const pdfBytes = await generateMerchRequestFormPdf({
        applicationDate: toISODate(new Date()),
        orgName,
        contactPerson: merchForm.contact_person,
        position: merchForm.position,
        email: merchForm.email,
        title: sub.title,
        activityTypeLabel: MERCH_ACTIVITY_TYPE_LABEL,
        targetAudience: merchForm.target_audience,
        targetParticipants: merchForm.target_participants,
        eventDate: merchForm.event_date,
        merchandiseDurationLabel,
        projectedBudget: merchForm.projected_budget,
        budgetSource: merchForm.budget_source,
        merchandiseTypes: finalMerchTypes,
        learningGoals: [merchForm.learning_goal_1, merchForm.learning_goal_2, merchForm.learning_goal_3],
        description: merchForm.description,
      })
      const formFile = new File([pdfBytes], `Merchandise-Request-Form-${sub.id}.pdf`, { type: 'application/pdf' })
      await uploadAttachment(sub.id, 'Merchandise Request Form', formFile)
    } catch (pdfErr) {
      console.error('Failed to auto-generate Merchandise Request Form PDF', pdfErr)
      setFormError('Proposal submitted, but the Merchandise Request Form PDF could not be generated — you can attach one manually from the list.')
    }

    const failedDocs = []
    for (const doc of MERCH_DOCS) {
      try {
        await uploadAttachment(sub.id, doc, merchFiles[doc])
      } catch (uploadErr) {
        console.error(`Failed to upload ${doc}`, uploadErr)
        failedDocs.push(doc)
      }
    }
    await supabase.from('submission_status_history').insert({
      submission_id: sub.id, stage: 'submitted', action: 'submitted', actor_id: profile.id,
    })
    if (failedDocs.length) {
      setFormError(`Proposal submitted, but ${failedDocs.join(', ')} failed to upload — reopen it from the list to re-attach.`)
    }

    setSaving(false)
    if (!failedDocs.length) setShowMerchModal(false)
    loadSubmissions()
  }

  async function openDetail(sub) {
    setSelected(sub)
    setActionMode(null)
    setActionComment('')
    setActionError('')
    setConditionalDueDate('')
    setReportSubmissionDate(sub.report_submission_date || '')
    setAddingChecklistItem(false)
    setNewChecklistLabel('')
    setShowNewComment(false)
    setNewCommentPage('')
    setNewCommentBody('')
    setCommentIndex(0)
    setExtraDocLabel('')
    setExtraDocEntry(null)
    setResubmitting(false)
    setResubmitNote('')
    setLinkForm({ adviser: { name: '', email: '' }, dean: { name: '', email: '' }, sdg_rep: { name: '', email: '' }, marketing_rep: { name: '', email: '' } })
    setLinkError('')
    setApprovalLinks([])
    setDetailLoading(true)
    if (sub.type === 'event_application' || sub.type === 'merchandise') {
      const { data: links } = await fetchApprovalLinks(sub.id)
      setApprovalLinks(links)
      const sdgRepLink = links.find((l) => l.role === 'sdg_rep')
      if (sub.type === 'event_application' && sdgRepLink?.status === 'approved' && !sub.sdg_marked_acp_generated) {
        // Awaited so the old ACP Form row/file is deleted and the new
        // one uploaded *before* we fetch attachments below — otherwise
        // that fetch can race the delete and the stale ACP briefly (or
        // permanently, if it wins the race) reappears in the UI.
        await regenerateAcpWithSdgMarks(sub)
      }
    }
    const [{ data: att }, { data: hist }, { data: tasks }, { data: check }, { data: cmts }] = await Promise.all([
      supabase.from('submission_attachments').select('*').eq('submission_id', sub.id).order('uploaded_at', { ascending: true }),
      supabase.from('submission_status_history')
        .select('*, actor:profiles ( full_name )')
        .eq('submission_id', sub.id)
        .order('created_at', { ascending: true }),
      supabase.from('assignments')
        .select('id, title, status, due_date, assigned_to, assignee:profiles!assignments_assigned_to_fkey ( full_name )')
        .eq('submission_id', sub.id),
      supabase.from('submission_checklist_items')
        .select('*, creator:profiles!submission_checklist_items_created_by_fkey ( full_name )')
        .eq('submission_id', sub.id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase.from('submission_comments')
        .select('*, author:profiles ( full_name )')
        .eq('submission_id', sub.id)
        .order('created_at', { ascending: true }),
    ])
    setAttachments(att || [])
    setHistory(hist || [])
    setOpenTasks((tasks || []).filter((t) => t.status !== 'approved'))
    setChecklist(check || [])
    setComments(cmts || [])
    setViewerAttachmentId((att && att[0]?.id) || null)
    setDetailLoading(false)
  }

  async function refreshChecklist() {
    if (!selected) return
    const { data } = await supabase.from('submission_checklist_items')
      .select('*, creator:profiles!submission_checklist_items_created_by_fkey ( full_name )')
      .eq('submission_id', selected.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    setChecklist(data || [])
  }

  async function addChecklistItem() {
    const label = newChecklistLabel.trim()
    if (!label || !selected) return
    await supabase.from('submission_checklist_items').insert({
      submission_id: selected.id, label, created_by: profile.id, sort_order: checklist.length,
    })
    setNewChecklistLabel('')
    setAddingChecklistItem(false)
    refreshChecklist()
  }

  async function toggleChecklistItem(item) {
    await supabase.from('submission_checklist_items').update({
      is_checked: !item.is_checked,
      checked_by: !item.is_checked ? profile.id : null,
      checked_at: !item.is_checked ? new Date().toISOString() : null,
    }).eq('id', item.id)
    refreshChecklist()
  }

  async function removeChecklistItem(item) {
    await supabase.from('submission_checklist_items').delete().eq('id', item.id)
    refreshChecklist()
  }

  async function refreshComments(focusLast) {
    if (!selected) return
    const { data } = await supabase.from('submission_comments')
      .select('*, author:profiles ( full_name )')
      .eq('submission_id', selected.id)
      .order('created_at', { ascending: true })
    setComments(data || [])
    if (focusLast && data?.length) setCommentIndex(data.length - 1)
  }

  async function addComment() {
    if (!selected || !newCommentBody.trim()) return
    setSavingComment(true)
    await supabase.from('submission_comments').insert({
      submission_id: selected.id,
      page_number: newCommentPage.trim() || null,
      body: newCommentBody.trim(),
      author_id: profile.id,
    })
    setNewCommentPage('')
    setNewCommentBody('')
    setShowNewComment(false)
    setSavingComment(false)
    refreshComments(true)
  }

  async function deleteComment(comment) {
    await supabase.from('submission_comments').delete().eq('id', comment.id)
    setCommentIndex((i) => Math.max(0, i - 1))
    refreshComments(false)
  }

  async function refreshAttachments() {
    if (!selected) return
    const { data } = await supabase.from('submission_attachments').select('*').eq('submission_id', selected.id).order('uploaded_at', { ascending: true })
    setAttachments(data || [])
    if (data?.length) setViewerAttachmentId(data[data.length - 1].id)
  }

  async function addExtraAttachment() {
    if (!selected || !extraDocEntry) return
    const label = extraDocLabel.trim() || 'Additional Attachment'
    setUploadingExtra(true)
    try {
      await uploadAttachment(selected.id, label, extraDocEntry)
      setExtraDocLabel('')
      setExtraDocEntry(null)
      await refreshAttachments()
    } catch {
      setActionError('Could not upload that attachment. Please try again.')
    }
    setUploadingExtra(false)
  }

  async function handleResubmit() {
    if (!selected) return
    setResubmitting(true)
    setActionError('')
    const { error } = await supabase.from('submissions')
      .update({ stage: 'submitted', updated_at: new Date().toISOString() })
      .eq('id', selected.id)
    if (error) {
      setActionError('Could not resubmit. Please try again.')
      setResubmitting(false)
      return
    }
    await supabase.from('submission_status_history').insert({
      submission_id: selected.id, stage: 'submitted', action: 'resubmitted',
      actor_id: profile.id, comment: resubmitNote.trim() || null,
    })

    // Back to tentative on the calendar — was grayed out ('returned') or,
    // if it had been cleared entirely, gets a fresh pencil booking.
    if (selected.type === 'event_application') {
      if (selected.event_id) {
        await supabase.from('events').update({ booking_status: 'pencil' }).eq('id', selected.event_id)
      } else if (!selected.is_continuing) {
        // Year-Round/Term activities still have no assigned date at this
        // point — they stay off the calendar until the SDAO Assistant
        // assigns a report submission date again.
        const { data: newEvent } = await supabase.from('events').insert({
          title: selected.title,
          org_id: selected.org_id,
          contact_person: selected.contact_person,
          contact_number: selected.contact_number,
          description: selected.description,
          venue_id: selected.venue_id,
          venue_detail: selected.venue_detail,
          event_date: selected.event_date,
          start_time: selected.start_time,
          end_time: selected.end_time,
          additional_ingress_time: selected.additional_ingress_time,
          additional_egress_time: selected.additional_egress_time,
          night_before_ingress: selected.night_before_ingress,
          medium: selected.medium,
          booking_status: 'pencil',
          submission_id: selected.id,
          created_by: profile.id,
        }).select().single()
        if (newEvent) {
          await supabase.from('submissions').update({ event_id: newEvent.id }).eq('id', selected.id)
        }
      }
    }

    setResubmitting(false)
    setResubmitNote('')
    setSelected(null)
    loadSubmissions()
  }

  async function handleDeleteSubmission(sub) {
    setDeletingSubmissionId(sub.id)
    // Clear the linked calendar entry too, if it hasn't materialized into
    // an approved/reserved activity that should stay on record.
    if (sub.type === 'event_application' && sub.event_id && sub.stage !== 'approved') {
      await supabase.from('events').delete().eq('id', sub.event_id)
    }
    const { error: err } = await supabase.from('submissions').delete().eq('id', sub.id)
    setDeletingSubmissionId(null)
    setConfirmDeleteId(null)
    if (err) {
      setListError('Could not delete that submission. Please try again.')
      return
    }
    if (selected?.id === sub.id) setSelected(null)
    loadSubmissions()
  }

  async function performAction(kind, nextAction, overrideLabel) {
    if ((kind === 'return' || kind === 'reject') && !actionComment.trim()) {
      setActionError('Please provide a short reason.')
      return
    }

    const assistantForwarding = kind === 'advance'
      && ['sdao_assistant', 'system_admin'].includes(profile.role)
      && (selected.stage === 'submitted' || selected.stage === 'assistant_review')

    // Year-Round/Term applications have no single event date, so the
    // SDAO Assistant must assign a report submission date before this
    // can be forwarded to the Supervisor.
    if (assistantForwarding && selected.is_continuing && !reportSubmissionDate) {
      setActionError('Please assign a report submission date before forwarding this Year-Round/Term application.')
      return
    }

    setActing(true)
    setActionError('')

    let continuingEventId = selected.event_id
    if (assistantForwarding && selected.is_continuing) {
      await supabase.from('submissions').update({ report_submission_date: reportSubmissionDate }).eq('id', selected.id)

      // This is the first time a Year-Round/Term application gets a
      // date — put it on the calendar now (as the report deadline),
      // since it was deliberately left off at submission time.
      if (continuingEventId) {
        await supabase.from('events').update({
          event_date: reportSubmissionDate,
          booking_status: 'pencil',
        }).eq('id', continuingEventId)
      } else {
        const { data: newEvent } = await supabase.from('events').insert({
          title: selected.title,
          org_id: selected.org_id,
          contact_person: selected.contact_person,
          contact_number: selected.contact_number,
          description: selected.description,
          venue_id: selected.venue_id,
          venue_detail: selected.venue_detail,
          event_date: reportSubmissionDate,
          start_time: selected.start_time,
          end_time: selected.end_time,
          additional_ingress_time: selected.additional_ingress_time,
          additional_egress_time: selected.additional_egress_time,
          night_before_ingress: selected.night_before_ingress,
          medium: selected.medium,
          booking_status: 'pencil',
          submission_id: selected.id,
          created_by: profile.id,
        }).select().single()
        if (newEvent) {
          continuingEventId = newEvent.id
          await supabase.from('submissions').update({ event_id: continuingEventId }).eq('id', selected.id)
        }
      }
    }

    const sub = selected.is_continuing
      ? { ...selected, report_submission_date: reportSubmissionDate, event_id: continuingEventId }
      : selected
    const newStage = kind === 'return' ? 'returned' : kind === 'reject' ? 'rejected' : nextAction.to
    const actionLabel = overrideLabel || (kind === 'return' ? 'returned' : kind === 'reject' ? 'rejected' : nextAction.action)

    await supabase.from('submissions').update({ stage: newStage, updated_at: new Date().toISOString() }).eq('id', sub.id)
    await supabase.from('submission_status_history').insert({
      submission_id: sub.id, stage: newStage, action: actionLabel, actor_id: profile.id, comment: actionComment || null,
    })

    if (newStage === 'approved') {
      if (sub.type === 'event_application') {
        // The calendar entry was already pencil-booked at submission time
        // (and possibly grayed to 'returned' along the way) — just confirm
        // it rather than creating a duplicate. Fall back to inserting one
        // only if, for some reason, it isn't there.
        // Year-Round/Term activities show their assigned report
        // submission date on the calendar, not today's date.
        const calendarDate = sub.is_continuing ? sub.report_submission_date : (sub.event_date || toISODate(new Date()))
        let eventId = sub.event_id
        if (eventId) {
          await supabase.from('events').update({
            title: sub.title,
            contact_person: sub.contact_person,
            contact_number: sub.contact_number,
            description: sub.description,
            venue_id: sub.venue_id,
            venue_detail: sub.venue_detail,
            event_date: calendarDate,
            start_time: sub.start_time,
            end_time: sub.end_time,
            additional_ingress_time: sub.additional_ingress_time,
            additional_egress_time: sub.additional_egress_time,
            night_before_ingress: sub.night_before_ingress,
            medium: sub.medium,
            booking_status: 'reserved',
          }).eq('id', eventId)
        } else {
          const { data: newEvent } = await supabase.from('events').insert({
            title: sub.title,
            org_id: sub.org_id,
            contact_person: sub.contact_person,
            contact_number: sub.contact_number,
            description: sub.description,
            venue_id: sub.venue_id,
            venue_detail: sub.venue_detail,
            event_date: calendarDate,
            start_time: sub.start_time,
            end_time: sub.end_time,
            additional_ingress_time: sub.additional_ingress_time,
            additional_egress_time: sub.additional_egress_time,
            night_before_ingress: sub.night_before_ingress,
            medium: sub.medium,
            booking_status: 'reserved',
            submission_id: sub.id,
            created_by: profile.id,
          }).select().single()
          if (newEvent) {
            eventId = newEvent.id
            await supabase.from('submissions').update({ event_id: eventId }).eq('id', sub.id)
          }
        }

        // Defensive cleanup: if an older pencil-booked row for this same
        // submission is still lingering (e.g. from a resubmission cycle,
        // or created before event_id got linked back to the submission),
        // it would otherwise sit on the calendar right alongside the
        // newly reserved one. Only the row we just reserved should remain.
        if (eventId) {
          await supabase.from('events').delete()
            .eq('submission_id', sub.id)
            .eq('booking_status', 'pencil')
            .neq('id', eventId)
        }

        if (eventId) {
          let deadlineISO
          if (sub.is_continuing) {
            // No single event date to compute from — use the date the
            // SDAO Assistant assigned when forwarding this application.
            deadlineISO = sub.report_submission_date
          } else {
            const deadline = new Date(sub.event_date)
            deadline.setDate(deadline.getDate() + 7)
            deadlineISO = toISODate(deadline)
          }
          await supabase.from('clearances').insert({
            org_id: sub.org_id, event_id: eventId, deadline: deadlineISO, status: 'pending',
          })
          await supabase.from('assignments').insert({
            title: `Post-Activity Report — ${sub.title}`,
            description: 'Submit the PARF, Liquidation, Narrative, and Evaluation reports for this activity.',
            event_id: eventId,
            assigned_to: sub.submitted_by,
            assigned_by: profile.id,
            due_date: deadlineISO,
            status: 'pending',
            auto_generated: true,
          })

          // Requested additional ingress/egress time that falls outside
          // gate hours (before 6:00 AM / after 9:00 PM): now that the
          // Academic Director has approved, automatically assign the org
          // President to submit the Security Office letter, due 3 days
          // before the event, via the Assignments tab.
          const needsSecurityLetter = !sub.is_continuing && (
            (!!sub.additional_ingress_time && sub.additional_ingress_time < '06:00') ||
            (!!sub.additional_egress_time && sub.additional_egress_time > '21:00')
          )
          if (needsSecurityLetter && sub.event_date) {
            const { data: presidentMembership } = await supabase
              .from('org_memberships')
              .select('profile_id')
              .eq('org_id', sub.org_id)
              .eq('position', 'President')
              .maybeSingle()
            const securityDue = new Date(sub.event_date)
            securityDue.setDate(securityDue.getDate() - 3)
            await supabase.from('assignments').insert({
              title: `Security Office Letter — ${sub.title}`,
              description: 'This activity requested ingress before 6:00 AM or egress after 9:00 PM. Submit a letter to the Security Office for approval.',
              event_id: eventId,
              assigned_to: presidentMembership?.profile_id || null,
              assigned_tag: presidentMembership?.profile_id ? null : 'President',
              assigned_org_id: presidentMembership?.profile_id ? null : sub.org_id,
              assigned_by: profile.id,
              due_date: toISODate(securityDue),
              status: 'pending',
              auto_generated: true,
            })
          }

          // Stamp the approval on the event and issue (or reuse) its
          // verification token, then regenerate the ACP Form PDF with a
          // QR code baked in — scanning it opens the public /verify page
          // confirming Event Name, Venue, Date, Approved on, Approved by.
          try {
            const { data: tokenRow } = await ensureEventVerificationToken(eventId)
            if (tokenRow?.verification_token) {
              const { data: fullSub } = await supabase
                .from('submissions')
                .select('*, organizations ( name ), venues ( name )')
                .eq('id', sub.id)
                .single()
              if (fullSub) {
                const venueLabel = fullSub.medium === 'online'
                  ? [ONLINE_PLATFORMS.find((p) => p.value === fullSub.online_platform)?.label, fullSub.online_platform === 'others' ? fullSub.venue_detail : null].filter(Boolean).join(' — ')
                  : fullSub.is_multi_day && fullSub.event_dates?.length
                    ? multiDayVenueLabel(fullSub.event_dates, venues)
                    : singleDayVenueLabel({
                        venueIds: fullSub.venue_ids, venueDetails: fullSub.venue_details,
                        legacyVenueId: fullSub.venue_id, legacyVenueDetail: fullSub.venue_detail, legacyVenueName: fullSub.venues?.name,
                      }, venues)
                const venueLabelLines = fullSub.medium === 'online'
                  ? [venueLabel]
                  : fullSub.is_multi_day && fullSub.event_dates?.length
                    ? multiDayVenueLines(fullSub.event_dates, venues)
                    : singleDayVenueLines({
                        venueIds: fullSub.venue_ids, venueDetails: fullSub.venue_details,
                        legacyVenueId: fullSub.venue_id, legacyVenueDetail: fullSub.venue_detail, legacyVenueName: fullSub.venues?.name,
                      }, venues)
                const timeRange = fullSub.is_multi_day && fullSub.event_dates?.length
                  ? compileMultiDayTimeRange(fullSub.event_dates)
                  : [fullSub.start_time && formatTime(fullSub.start_time), fullSub.end_time && formatTime(fullSub.end_time)].filter(Boolean).join(' – ')
                const activityTypeLabel = fullSub.activity_type === 'other'
                  ? fullSub.activity_type_other
                  : ACTIVITY_TYPES.find((t) => t.value === fullSub.activity_type)?.label
                const acpDateLabel = fullSub.is_continuing
                  ? (fullSub.continuing_type === 'term' ? `Term ${(fullSub.term_label || '').trim()}` : 'Year-Round')
                  : fullSub.is_multi_day && fullSub.event_dates?.length
                    ? formatEventDates(fullSub.event_dates.map((d) => d.event_date))
                    : fullSub.event_date

                const pdfBytes = await generateACPFormPdf({
                  applicationDate: toISODate(new Date(fullSub.submitted_at)),
                  orgName: fullSub.organizations?.name || '',
                  contactPerson: fullSub.contact_person,
                  position: fullSub.position,
                  email: fullSub.email,
                  title: fullSub.title,
                  activityTypeLabel,
                  venueAddress: venueLabel,
        venueAddressLines: venueLabelLines,
                  targetAudience: fullSub.target_audience,
                  targetParticipants: fullSub.target_participants,
                  eventDate: acpDateLabel,
                  timeRange,
                  projectedBudget: fullSub.projected_budget,
                  budgetSource: fullSub.budget_source,
                  sdgs: fullSub.sdgs,
                  sdgRepresentative: fullSub.sdg_representative,
                  learningGoals: fullSub.learning_goals,
                  description: fullSub.description,
                  verification: {
                    token: tokenRow.verification_token,
                    approvedBy: profile?.full_name || 'SDAO',
                    approvedOn: toISODate(new Date(tokenRow.approved_at || new Date())),
                  },
                })
                const acpFile = new File([pdfBytes], `ACP-Form-${sub.id}-approved.pdf`, { type: 'application/pdf' })
                // Replace the pre-approval ACP Form with the QR-stamped
                // one rather than appending a second copy. Grab the old
                // row(s) first so we can also clean up their storage
                // objects — otherwise the file lingers in the bucket
                // even once the DB row is gone.
                const { data: oldAcpRows } = await supabase
                  .from('submission_attachments')
                  .select('id, file_url')
                  .eq('submission_id', sub.id).eq('document_type', 'ACP Form')
                const { error: delErr } = await supabase.from('submission_attachments').delete()
                  .eq('submission_id', sub.id).eq('document_type', 'ACP Form')
                if (delErr) {
                  console.error('Failed to delete pre-approval ACP Form row', delErr)
                } else {
                  for (const row of oldAcpRows || []) {
                    const path = extractStoragePath(row.file_url)
                    if (path) await supabase.storage.from('submission-attachments').remove([path])
                  }
                }
                await uploadAttachment(sub.id, 'ACP Form', acpFile)
              }
            }
          } catch (qrErr) {
            console.error('Failed to regenerate ACP Form with verification QR code', qrErr)
          }
        }
      } else if (sub.type === 'report') {
        await supabase.from('clearances')
          .update({ status: 'cleared', cleared_by: profile.id, cleared_at: new Date().toISOString(), report_submission_id: sub.id })
          .eq('org_id', sub.org_id).eq('event_id', sub.event_id)

        // The Post-Activity Report task is done now that the report has
        // been received — flip it to 'approved' so it stops showing as
        // outstanding on the Assignments page. Match on submission_id
        // (set when the report was submitted) and, as a fallback, on the
        // event it closes out.
        await supabase.from('assignments')
          .update({ status: 'approved', updated_at: new Date().toISOString() })
          .eq('submission_id', sub.id)
          .neq('status', 'approved')
        if (sub.event_id) {
          await supabase.from('assignments')
            .update({ status: 'approved', updated_at: new Date().toISOString() })
            .eq('event_id', sub.event_id)
            .eq('auto_generated', true)
            .neq('status', 'approved')
        }
      }
    } else if (newStage === 'rejected') {
      // Clear the calendar entirely — a rejected application shouldn't
      // still show up as pencil-booked. If it's resubmitted later (as a
      // fresh application), a new pencil booking is created at that point.
      if (sub.type === 'event_application' && sub.event_id) {
        await supabase.from('events').delete().eq('id', sub.event_id)
        await supabase.from('submissions').update({ event_id: null }).eq('id', sub.id)
      }
    } else if (newStage === 'returned') {
      // Keep it pencil-booked, but gray it out to signal "still tentative,
      // waiting on the org to fix and resubmit."
      if (sub.type === 'event_application' && sub.event_id) {
        await supabase.from('events').update({ booking_status: 'returned' }).eq('id', sub.event_id)
      }
    }

    setActing(false)
    setActionMode(null)
    setActionComment('')
    setSelected(null)
    loadSubmissions()
  }

  async function performConditionalApprove(nextAction) {
    if (!conditionalDueDate) {
      setActionError('Please set a deadline for the outstanding task(s).')
      return
    }
    setActing(true)
    setActionError('')

    await Promise.all(
      openTasks.map((t) =>
        supabase.from('assignments')
          .update({ status: 'conditional_approved', due_date: conditionalDueDate, updated_at: new Date().toISOString() })
          .eq('id', t.id)
      )
    )

    await performAction('advance', nextAction, 'conditionally approved (task deadline extended)')
  }

  const visibleSubmissions = search.trim()
    ? submissions.filter((s) => {
        const q = search.trim().toLowerCase()
        const hay = [s.title, s.contact_person, s.organizations?.acronym, s.organizations?.name, s.submitter?.full_name]
          .filter(Boolean).join(' ').toLowerCase()
        return hay.includes(q)
      })
    : submissions

  return (
    <div className="sb-page">
      <div className="sb-toolbar">
        <div className="sb-toolbar__filters">
          <select className="sb-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            <option value="event_application">Event Applications</option>
            <option value="merchandise">Merchandise Proposals</option>
            <option value="report">Reports</option>
          </select>
          <select className="sb-select" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="all">All stages</option>
            {Object.entries(STAGE_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          {admin && (
            <>
              <select className="sb-select" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
                <option value="all">All organizations</option>
                {filterOrgs.map((o) => <option key={o.id} value={o.id}>{o.acronym}</option>)}
              </select>
              <input
                className="sb-select sb-search-input"
                type="text"
                placeholder="Search title, contact, org…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </>
          )}
        </div>

        {!admin && (
          <div className="sb-toolbar__actions">
            <button className="sb-btn sb-btn--outline" onClick={() => openReportModal()}>
              <ClipboardList size={15} /> Submit Report
            </button>
            <button
              className="sb-btn sb-btn--gold"
              onClick={openAppModal}
              disabled={clearanceBlocked}
              title={clearanceBlocked ? 'Settle your organization\'s overdue clearance before applying for a new activity.' : undefined}
            >
              <Plus size={15} /> New Application
            </button>
            {allowMerchandise && (
              <button className="sb-btn sb-btn--outline" onClick={openMerchModal}>
                <Plus size={15} /> New Merchandise Proposal
              </button>
            )}
          </div>
        )}
      </div>

      {!admin && clearanceBlocked && (
        <div className="sb-clearance-notice">
          <ShieldAlert size={16} />
          <span>
            Your organization has {overdueClearances.length} overdue clearance{overdueClearances.length > 1 ? 's' : ''}
            {' '}— settle {overdueClearances.length > 1 ? 'them' : 'it'} before submitting a new Event Application.
          </span>
          <button className="sb-btn sb-btn--outline sb-btn--sm" onClick={() => openReportModal()}>
            Submit Report
          </button>
        </div>
      )}

      <div className="sb-list-wrap">
        {listError && <div className="sb-form-error"><AlertCircle size={14} /> {listError}</div>}
        {loading ? (
          <div className="sb-loading"><Loader2 size={22} className="spin" /></div>
        ) : visibleSubmissions.length === 0 ? (
          <div className="sb-empty">
            <Inbox size={26} strokeWidth={1.6} />
            <p>{submissions.length === 0 ? 'No submissions here yet.' : 'Nothing matches this search.'}</p>
          </div>
        ) : (
          <div className="table-scroll">
          <table className="sb-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                {admin && <th>Organization</th>}
                <th>Stage</th>
                <th>Submitted</th>
                <th />
                {admin && <th />}
              </tr>
            </thead>
            <tbody>
              {visibleSubmissions.map((s) => {
                const meta = STAGE_META[s.stage]
                const isConfirmingDelete = confirmDeleteId === s.id
                return (
                  <tr key={s.id} onClick={() => openDetail(s)}>
                    <td className="sb-table__title">{s.title}</td>
                    <td>{s.type === 'event_application' ? 'Event Application' : s.type === 'merchandise' ? 'Merchandise Proposal' : 'Report'}</td>
                    {admin && <td>{s.organizations?.acronym}</td>}
                    <td><span className={`sb-badge sb-badge--${meta.tone}`}>{meta.label}</span></td>
                    <td>{s.submitted_at?.slice(0, 10)}</td>
                    <td><ChevronRight size={15} color="var(--muted)" /></td>
                    {admin && (
                      <td onClick={(e) => e.stopPropagation()}>
                        {isConfirmingDelete ? (
                          <div className="sb-row-actions">
                            <button
                              className="sb-icon-btn"
                              onClick={() => handleDeleteSubmission(s)}
                              disabled={deletingSubmissionId === s.id}
                              title="Confirm delete"
                            >
                              {deletingSubmissionId === s.id ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                            </button>
                            <button className="sb-icon-btn" onClick={() => setConfirmDeleteId(null)} title="Cancel">
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <button className="sb-icon-btn" onClick={() => setConfirmDeleteId(s.id)} title="Delete permanently">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* ---------- New Event Application ---------- */}
      {showAppModal && (
        <div className="sb-modal-backdrop" onClick={() => setShowAppModal(false)}>
          <form className="sb-modal sb-modal--form" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmitApp}>
            <button type="button" className="sb-modal__close" onClick={() => setShowAppModal(false)}><X size={18} /></button>
            <h3 className="sb-modal__title">New Event Application</h3>

            {formError && <div className="sb-form-error"><AlertCircle size={14} /> {formError}</div>}

            <label className="sb-field">
              Name of Event
              <input value={appForm.title} onChange={(e) => setAppForm({ ...appForm, title: e.target.value })} required />
            </label>

            <label className="sb-field">
              Type of Activity
              <select value={appForm.activity_type} onChange={(e) => setAppForm({ ...appForm, activity_type: e.target.value })} required>
                <option value="">Select</option>
                {ACTIVITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            {appForm.activity_type === 'other' && (
              <label className="sb-field">
                Specify
                <input value={appForm.activity_type_other} onChange={(e) => setAppForm({ ...appForm, activity_type_other: e.target.value })} required />
              </label>
            )}

            <div className="sb-field-row">
              <label className="sb-field">
                Contact Person
                <input value={appForm.contact_person} onChange={(e) => setAppForm({ ...appForm, contact_person: e.target.value })} required />
              </label>
              <label className="sb-field">
                Contact Number
                <input value={appForm.contact_number} onChange={(e) => setAppForm({ ...appForm, contact_number: e.target.value })} />
              </label>
            </div>

            <div className="sb-field-row">
              <label className="sb-field">
                Position
                <input value={appForm.position} onChange={(e) => setAppForm({ ...appForm, position: e.target.value })} required />
              </label>
              <label className="sb-field">
                Email Address
                <input type="email" value={appForm.email} onChange={(e) => setAppForm({ ...appForm, email: e.target.value })} required />
              </label>
            </div>

            <div className="sb-field-row">
              <label className="sb-field">
                Medium
                <select
                  value={appForm.medium}
                  onChange={(e) => setAppForm({
                    ...appForm,
                    medium: e.target.value,
                    // Switching medium clears whichever venue/platform
                    // fields don't apply to the new selection.
                    venue_id: '', venue_ids: [], venue_detail: '', venue_details: {},
                    pencil_booked: '', lab_endorsed: '',
                    room_selections: {}, lab_selections: {},
                    online_platform: '',
                  })}
                  required
                >
                  <option value="f2f">Face-to-Face</option>
                  <option value="online">Online</option>
                  <option value="off_campus">Off-Campus</option>
                </select>
              </label>

              {appForm.medium === 'online' ? (
                <label className="sb-field">
                  Platform
                  <select
                    value={appForm.online_platform}
                    onChange={(e) => setAppForm({ ...appForm, online_platform: e.target.value, venue_detail: '' })}
                    required
                  >
                    <option value="">Select platform</option>
                    {ONLINE_PLATFORMS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </label>
              ) : appForm.is_multi_day ? (
                <div className="sb-field">
                  <span className="sb-hint">Venue is selected per day below, since this is a multi-day event.</span>
                </div>
              ) : (
                <div className="sb-field sb-field--full">
                  Venue(s)
                  <VenueMultiSelect
                    venues={venues}
                    selectedIds={appForm.venue_ids}
                    availability={venueAvailability}
                    onChange={(ids) => setAppForm({
                      ...appForm,
                      venue_ids: ids,
                      venue_id: ids[0] || '',
                      // Drop detail/room/lab state for venues that got
                      // unchecked, keep it for ones still checked.
                      venue_details: Object.fromEntries(Object.entries(appForm.venue_details).filter(([id]) => ids.includes(id))),
                      room_selections: Object.fromEntries(Object.entries(appForm.room_selections).filter(([id]) => ids.includes(id))),
                      lab_selections: Object.fromEntries(Object.entries(appForm.lab_selections).filter(([id]) => ids.includes(id))),
                    })}
                    labelFor={(v) => (v.name === 'Room' ? 'Room (identify room number)'
                      : v.name === 'Laboratory' ? 'Laboratory (identify which lab)'
                      : v.name === 'Others' ? 'Others (specify)'
                      : v.name)}
                  />
                  <span className="sb-hint">Check every venue this event will use on this date.</span>
                </div>
              )}
            </div>

            {appForm.medium === 'online' && appForm.online_platform === 'others' && (
              <label className="sb-field">
                Please specify
                <input
                  value={appForm.venue_detail}
                  onChange={(e) => setAppForm({ ...appForm, venue_detail: e.target.value })}
                  placeholder="e.g. Google Meet"
                  required
                />
              </label>
            )}

            {appForm.medium !== 'online' && appForm.venue_ids.length > 0 && (() => {
              const tags = [...new Set(appForm.venue_ids.map((id) => venueTagFor(venues.find((v) => v.id === id)?.name)).filter(Boolean))]
              const anyLab = appForm.venue_ids.some((id) => venues.find((v) => v.id === id)?.name === 'Laboratory')
              return (
                <div className="sb-venue-booking">
                  <div className="sb-form-notice">
                    <AlertCircle size={14} />
                    Ensure that you have pencil booked every venue above with INSPIRE or Facilities Office before submitting.
                  </div>

                  {appForm.venue_ids.map((venueId) => {
                    const selectedVenue = venues.find((v) => v.id === venueId)
                    const venueName = selectedVenue?.name
                    const detailPrompt = VENUE_DETAIL_PROMPTS[venueName]
                    if (!detailPrompt) return null
                    const roomSel = appForm.room_selections[venueId] || { building: '', floor: '', number: '' }
                    const labId = appForm.lab_selections[venueId] || ''
                    const selectedLab = venueLabs.find((l) => l.id === labId)
                    return (
                      <div className="sb-venue-detail-block" key={venueId}>
                        <div className="sb-venue-detail-heading">{venueName}</div>

                        {venueName === 'Room' && (
                          <div className="sb-field-row">
                            <label className="sb-field">
                              Building
                              <select
                                value={roomSel.building}
                                onChange={(e) => setAppForm({
                                  ...appForm,
                                  room_selections: { ...appForm.room_selections, [venueId]: { building: e.target.value, floor: '', number: '' } },
                                  venue_details: { ...appForm.venue_details, [venueId]: '' },
                                })}
                                required
                              >
                                <option value="">Select building</option>
                                {roomBuildingOptionsFor().map((b) => (
                                  <option key={b} value={b}>{b}</option>
                                ))}
                              </select>
                            </label>
                            <label className="sb-field">
                              Floor
                              <select
                                value={roomSel.floor}
                                onChange={(e) => setAppForm({
                                  ...appForm,
                                  room_selections: { ...appForm.room_selections, [venueId]: { ...roomSel, floor: e.target.value, number: '' } },
                                  venue_details: { ...appForm.venue_details, [venueId]: '' },
                                })}
                                disabled={!roomSel.building}
                                required
                              >
                                <option value="">Select floor</option>
                                {roomFloorOptionsFor(roomSel.building).map((f) => (
                                  <option key={f} value={f}>{f}</option>
                                ))}
                              </select>
                            </label>
                            <label className="sb-field">
                              Room
                              <select
                                value={roomSel.number}
                                onChange={(e) => {
                                  const room = roomNumberOptionsFor(roomSel.building, roomSel.floor).find((r) => r.room_number === e.target.value)
                                  setAppForm({
                                    ...appForm,
                                    room_selections: { ...appForm.room_selections, [venueId]: { ...roomSel, number: e.target.value } },
                                    venue_details: { ...appForm.venue_details, [venueId]: room ? `${room.building}, ${room.floor} Flr — ${room.room_number}` : '' },
                                  })
                                }}
                                disabled={!roomSel.floor}
                                required
                              >
                                <option value="">Select room</option>
                                {roomNumberOptionsFor(roomSel.building, roomSel.floor).map((r) => (
                                  <option key={r.id} value={r.room_number}>{r.room_number}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                        )}

                        {venueName === 'Laboratory' && (
                          <>
                            <label className="sb-field">
                              Laboratory
                              <select
                                value={labId}
                                onChange={(e) => {
                                  const lab = venueLabs.find((l) => l.id === e.target.value)
                                  setAppForm({
                                    ...appForm,
                                    lab_selections: { ...appForm.lab_selections, [venueId]: e.target.value },
                                    venue_details: { ...appForm.venue_details, [venueId]: lab ? `${lab.name} c/o ${lab.care_of}, ${lab.location}` : '' },
                                  })
                                }}
                                required
                              >
                                <option value="">Select laboratory</option>
                                {venueLabs.map((l) => (
                                  <option key={l.id} value={l.id}>{l.name}</option>
                                ))}
                              </select>
                            </label>
                            {selectedLab && (
                              <div className="sb-field-row">
                                <label className="sb-field">
                                  Care of
                                  <input value={selectedLab.care_of} disabled />
                                </label>
                                <label className="sb-field">
                                  Location
                                  <input value={selectedLab.location} disabled />
                                </label>
                              </div>
                            )}
                          </>
                        )}

                        {venueName !== 'Room' && venueName !== 'Laboratory' && (
                          <label className="sb-field">
                            {detailPrompt}
                            <input
                              value={appForm.venue_details[venueId] || ''}
                              onChange={(e) => setAppForm({ ...appForm, venue_details: { ...appForm.venue_details, [venueId]: e.target.value } })}
                              placeholder="e.g. Covered Court"
                              required
                            />
                          </label>
                        )}
                      </div>
                    )
                  })}

                  {tags.length > 0 && (
                    <div className="sb-venue-tag">
                      Tagged as {tags.map((t) => <strong key={t}>{t}</strong>).reduce((a, b) => [a, ', ', b])}
                    </div>
                  )}

                  <label className="sb-field">
                    Pencil Booked? <span className="sb-optional">(all venues above)</span>
                    <select value={appForm.pencil_booked} onChange={(e) => setAppForm({ ...appForm, pencil_booked: e.target.value })} required>
                      <option value="">Select</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>

                  {anyLab && (
                    <label className="sb-field">
                      Endorsed by Laboratory Owner? <span className="sb-optional">(e.g. ComLab — ITSO)</span>
                      <select value={appForm.lab_endorsed} onChange={(e) => setAppForm({ ...appForm, lab_endorsed: e.target.value })} required>
                        <option value="">Select</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </label>
                  )}
                </div>
              )
            })()}

            {appForm.is_multi_day ? (
              <div className="sb-field">
                {appForm.event_dates.map((entry, idx) => (
                  <div className="sb-multiday-card" key={idx}>
                    <div className="sb-field-row sb-multiday-row">
                      <label className="sb-field">
                        {idx === 0 ? 'Date' : `Date ${idx + 1}`}
                        <input
                          type="date"
                          value={entry.event_date}
                          onChange={(e) => setAppForm((f) => {
                            const event_dates = [...f.event_dates]
                            event_dates[idx] = { ...event_dates[idx], event_date: e.target.value }
                            return { ...f, event_dates }
                          })}
                          required
                        />
                      </label>
                      <label className="sb-field">
                        Start Time
                        <input
                          type="time"
                          value={entry.start_time}
                          onChange={(e) => setAppForm((f) => {
                            const event_dates = [...f.event_dates]
                            event_dates[idx] = { ...event_dates[idx], start_time: e.target.value }
                            return { ...f, event_dates }
                          })}
                        />
                      </label>
                      <label className="sb-field">
                        End Time
                        <input
                          type="time"
                          value={entry.end_time}
                          onChange={(e) => setAppForm((f) => {
                            const event_dates = [...f.event_dates]
                            event_dates[idx] = { ...event_dates[idx], end_time: e.target.value }
                            return { ...f, event_dates }
                          })}
                        />
                      </label>

                      {idx === appForm.event_dates.length - 1 ? (
                        <button
                          type="button"
                          className="sb-btn sb-btn--icon sb-multiday-add"
                          title="Add another date"
                          onClick={() => setAppForm((f) => ({
                            ...f,
                            event_dates: [...f.event_dates, {
                              event_date: '', start_time: '', end_time: '',
                              venue_id: '', venue_ids: [], venue_detail: '', venue_details: {},
                              room_selections: {}, lab_selections: {},
                              pencil_booked: '',
                              wants_additional_time: false, additional_ingress_time: '', additional_egress_time: '',
                            }],
                          }))}
                        >
                          <Plus size={16} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="sb-btn sb-btn--icon sb-multiday-remove"
                          title="Remove this date"
                          onClick={() => setAppForm((f) => ({
                            ...f,
                            event_dates: f.event_dates.filter((_, i) => i !== idx),
                          }))}
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>

                    {(() => {
                      const dayGateCappedIngress = !!entry.start_time && entry.start_time < '08:00'
                      const dayGateCappedEgress = !!entry.end_time && entry.end_time > '19:00'
                      if (!dayGateCappedIngress && !dayGateCappedEgress) return null
                      return (
                        <div className="sb-form-notice">
                          <AlertCircle size={14} />
                          {dayGateCappedIngress && dayGateCappedEgress
                            ? 'This day starts before 8:00 AM and ends after 7:00 PM, so ingress is only available from 6:00 AM and egress only until 9:00 PM.'
                            : dayGateCappedIngress
                              ? 'This day starts before 8:00 AM, so ingress is only available from 6:00 AM.'
                              : 'This day ends after 7:00 PM, so egress is only available until 9:00 PM.'}
                          {' '}Need more than that? Use "Request additional ingress/egress time for this day" below.
                        </div>
                      )
                    })()}

                    {appForm.medium !== 'online' && (
                      <div className="sb-multiday-venues">
                        <div className="sb-field sb-field--full">
                          Venue(s) for this day
                          <VenueMultiSelect
                            venues={venues}
                            selectedIds={entry.venue_ids}
                            availability={dayVenueAvailability[idx] || {}}
                            labelFor={(v) => (v.name === 'Room' ? 'Room (identify room number)'
                              : v.name === 'Laboratory' ? 'Laboratory (identify which lab)'
                              : v.name === 'Others' ? 'Others (specify)'
                              : v.name)}
                            onChange={(ids) => setAppForm((f) => {
                              const event_dates = [...f.event_dates]
                              const prev = event_dates[idx]
                              event_dates[idx] = {
                                ...prev,
                                venue_ids: ids,
                                venue_id: ids[0] || '',
                                venue_details: Object.fromEntries(Object.entries(prev.venue_details || {}).filter(([id]) => ids.includes(id))),
                                room_selections: Object.fromEntries(Object.entries(prev.room_selections || {}).filter(([id]) => ids.includes(id))),
                                lab_selections: Object.fromEntries(Object.entries(prev.lab_selections || {}).filter(([id]) => ids.includes(id))),
                              }
                              return { ...f, event_dates }
                            })}
                          />
                        </div>

                        <div className="sb-field-row">
                        {entry.venue_ids.map((venueId) => {
                          const v = venues.find((x) => x.id === venueId)
                          const detailPrompt = VENUE_DETAIL_PROMPTS[v?.name]
                          if (!detailPrompt) return null
                          if (v?.name === 'Room') {
                            const roomSel = entry.room_selections?.[venueId] || { building: '', floor: '', number: '' }
                            return (
                              <div className="sb-field-row" key={venueId}>
                                <label className="sb-field">
                                  {v.name} — Building
                                  <select
                                    value={roomSel.building}
                                    onChange={(e) => setAppForm((f) => {
                                      const event_dates = [...f.event_dates]
                                      const prev = event_dates[idx]
                                      event_dates[idx] = {
                                        ...prev,
                                        room_selections: { ...prev.room_selections, [venueId]: { building: e.target.value, floor: '', number: '' } },
                                        venue_details: { ...prev.venue_details, [venueId]: '' },
                                      }
                                      return { ...f, event_dates }
                                    })}
                                    required
                                  >
                                    <option value="">Select building</option>
                                    {roomBuildingOptionsFor().map((b) => (
                                      <option key={b} value={b}>{b}</option>
                                    ))}
                                  </select>
                                </label>
                                <label className="sb-field">
                                  Floor
                                  <select
                                    value={roomSel.floor}
                                    onChange={(e) => setAppForm((f) => {
                                      const event_dates = [...f.event_dates]
                                      const prev = event_dates[idx]
                                      event_dates[idx] = {
                                        ...prev,
                                        room_selections: { ...prev.room_selections, [venueId]: { ...roomSel, floor: e.target.value, number: '' } },
                                        venue_details: { ...prev.venue_details, [venueId]: '' },
                                      }
                                      return { ...f, event_dates }
                                    })}
                                    disabled={!roomSel.building}
                                    required
                                  >
                                    <option value="">Select floor</option>
                                    {roomFloorOptionsFor(roomSel.building).map((fl) => (
                                      <option key={fl} value={fl}>{fl}</option>
                                    ))}
                                  </select>
                                </label>
                                <label className="sb-field">
                                  Room
                                  <select
                                    value={roomSel.number}
                                    onChange={(e) => setAppForm((f) => {
                                      const room = roomNumberOptionsFor(roomSel.building, roomSel.floor).find((r) => r.room_number === e.target.value)
                                      const event_dates = [...f.event_dates]
                                      const prev = event_dates[idx]
                                      event_dates[idx] = {
                                        ...prev,
                                        room_selections: { ...prev.room_selections, [venueId]: { ...roomSel, number: e.target.value } },
                                        venue_details: { ...prev.venue_details, [venueId]: room ? `${room.building}, ${room.floor} Flr — ${room.room_number}` : '' },
                                      }
                                      return { ...f, event_dates }
                                    })}
                                    disabled={!roomSel.floor}
                                    required
                                  >
                                    <option value="">Select room</option>
                                    {roomNumberOptionsFor(roomSel.building, roomSel.floor).map((r) => (
                                      <option key={r.id} value={r.room_number}>{r.room_number}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                            )
                          }
                          if (v?.name === 'Laboratory') {
                            const labId = entry.lab_selections?.[venueId] || ''
                            return (
                              <label className="sb-field" key={venueId}>
                                Laboratory
                                <select
                                  value={labId}
                                  onChange={(e) => {
                                    const lab = venueLabs.find((l) => l.id === e.target.value)
                                    setAppForm((f) => {
                                      const event_dates = [...f.event_dates]
                                      const prev = event_dates[idx]
                                      event_dates[idx] = {
                                        ...prev,
                                        lab_selections: { ...prev.lab_selections, [venueId]: e.target.value },
                                        venue_details: { ...prev.venue_details, [venueId]: lab ? `${lab.name} c/o ${lab.care_of}, ${lab.location}` : '' },
                                      }
                                      return { ...f, event_dates }
                                    })
                                  }}
                                  required
                                >
                                  <option value="">Select laboratory</option>
                                  {venueLabs.map((l) => (
                                    <option key={l.id} value={l.id}>{l.name}</option>
                                  ))}
                                </select>
                              </label>
                            )
                          }
                          return (
                            <label className="sb-field" key={venueId}>
                              {v.name} — Specify
                              <input
                                value={entry.venue_details?.[venueId] || ''}
                                onChange={(e) => setAppForm((f) => {
                                  const event_dates = [...f.event_dates]
                                  const prev = event_dates[idx]
                                  event_dates[idx] = { ...prev, venue_details: { ...prev.venue_details, [venueId]: e.target.value } }
                                  return { ...f, event_dates }
                                })}
                                required
                              />
                            </label>
                          )
                        })}

                        {entry.venue_ids.length > 0 && (
                          <label className="sb-field">
                            Pencil-Booked? <span className="sb-optional">(all venues this day)</span>
                            <select
                              value={entry.pencil_booked}
                              onChange={(e) => setAppForm((f) => {
                                const event_dates = [...f.event_dates]
                                event_dates[idx] = { ...event_dates[idx], pencil_booked: e.target.value }
                                return { ...f, event_dates }
                              })}
                            >
                              <option value="">Select</option>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </label>
                        )}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      className="sb-btn sb-btn--outline sb-btn--sm"
                      onClick={() => setAppForm((f) => {
                        const event_dates = [...f.event_dates]
                        const wants = !event_dates[idx].wants_additional_time
                        event_dates[idx] = {
                          ...event_dates[idx],
                          wants_additional_time: wants,
                          additional_ingress_time: wants ? event_dates[idx].additional_ingress_time : '',
                          additional_egress_time: wants ? event_dates[idx].additional_egress_time : '',
                        }
                        return { ...f, event_dates }
                      })}
                    >
                      {entry.wants_additional_time ? 'Cancel additional time request for this day' : 'Request additional ingress / egress time for this day'}
                    </button>
                    {entry.wants_additional_time && (
                      <div className="sb-field-row">
                        <label className="sb-field">
                          Requested Ingress Time
                          <input
                            type="time"
                            value={entry.additional_ingress_time}
                            onChange={(e) => setAppForm((f) => {
                              const event_dates = [...f.event_dates]
                              event_dates[idx] = { ...event_dates[idx], additional_ingress_time: e.target.value }
                              return { ...f, event_dates }
                            })}
                            placeholder="Earlier than the default buffer"
                          />
                        </label>
                        <label className="sb-field">
                          Requested Egress Time
                          <input
                            type="time"
                            value={entry.additional_egress_time}
                            onChange={(e) => setAppForm((f) => {
                              const event_dates = [...f.event_dates]
                              event_dates[idx] = { ...event_dates[idx], additional_egress_time: e.target.value }
                              return { ...f, event_dates }
                            })}
                            placeholder="Later than the default buffer"
                          />
                        </label>
                      </div>
                    )}
                    {(() => {
                      const dayIngressNeedsLetter = entry.wants_additional_time && !!entry.additional_ingress_time && entry.additional_ingress_time < '06:00'
                      const dayEgressNeedsLetter = entry.wants_additional_time && !!entry.additional_egress_time && entry.additional_egress_time > '21:00'
                      if (!dayIngressNeedsLetter && !dayEgressNeedsLetter) return null
                      return (
                        <div className="sb-form-error">
                          <AlertCircle size={14} />
                          Your requested {dayIngressNeedsLetter && dayEgressNeedsLetter ? 'ingress and egress times fall' : dayIngressNeedsLetter ? 'ingress time falls' : 'egress time falls'} outside gate hours (before 6:00 AM or after 9:00 PM) for this day. A letter must be submitted to the Security Office for approval. Once approved by the Academic Director, this will be automatically assigned to the org President via the Assignment tab, due 3 days before the event.
                        </div>
                      )
                    })()}
                  </div>
                ))}
                <p className="sb-hint">
                  On the generated ACP Form, these dates will print as{' '}
                  {formatEventDates(appForm.event_dates.map((d) => d.event_date)) || 'the dates you enter above'},
                  {' '}and the Time field will print the earliest time-in through the latest time-out across all days
                  {compileMultiDayTimeRange(appForm.event_dates) ? ` (currently ${compileMultiDayTimeRange(appForm.event_dates)})` : ''}.
                </p>
              </div>
            ) : (
              <div className="sb-field-row">
                <label className="sb-field">
                  Date
                  <input
                    type="date"
                    value={appForm.is_continuing ? '' : appForm.event_date}
                    onChange={(e) => setAppForm({ ...appForm, event_date: e.target.value })}
                    disabled={appForm.is_continuing}
                    required={!appForm.is_continuing}
                  />
                </label>
                <label className="sb-field">
                  Start Time
                  <input type="time" value={appForm.is_continuing ? '' : appForm.start_time} onChange={(e) => setAppForm({ ...appForm, start_time: e.target.value })} disabled={appForm.is_continuing} />
                  {displayIngressTime && <span className="sb-hint">Ingress from {displayIngressTime}</span>}
                </label>
                <label className="sb-field">
                  End Time
                  <input type="time" value={appForm.is_continuing ? '' : appForm.end_time} onChange={(e) => setAppForm({ ...appForm, end_time: e.target.value })} disabled={appForm.is_continuing} />
                  {displayEgressTime && <span className="sb-hint">Egress until {displayEgressTime}</span>}
                </label>
              </div>
            )}

            {(gateCappedIngress || gateCappedEgress) && !appForm.is_continuing && !appForm.is_multi_day && (
              <div className="sb-form-notice">
                <AlertCircle size={14} />
                {gateCappedIngress && gateCappedEgress
                  ? 'This activity starts before 8:00 AM and ends after 7:00 PM, so ingress is only available from 6:00 AM and egress only until 9:00 PM.'
                  : gateCappedIngress
                    ? 'This activity starts before 8:00 AM, so ingress is only available from 6:00 AM.'
                    : 'This activity ends after 7:00 PM, so egress is only available until 9:00 PM.'}
                {' '}Need more than that? Use "Request additional ingress/egress time" below.
              </div>
            )}

            {!appForm.is_continuing && !appForm.is_multi_day && (
              <div className="sb-field">
                <button
                  type="button"
                  className="sb-btn sb-btn--outline sb-btn--sm"
                  onClick={() => setAppForm({
                    ...appForm,
                    wants_additional_time: !appForm.wants_additional_time,
                    additional_ingress_time: appForm.wants_additional_time ? '' : appForm.additional_ingress_time,
                    additional_egress_time: appForm.wants_additional_time ? '' : appForm.additional_egress_time,
                  })}
                >
                  {appForm.wants_additional_time ? 'Cancel additional time request' : 'Request additional ingress / egress time'}
                </button>
                {appForm.wants_additional_time && (
                  <div className="sb-field-row">
                    <label className="sb-field">
                      Requested Ingress Time
                      <input
                        type="time"
                        value={appForm.additional_ingress_time}
                        onChange={(e) => setAppForm({ ...appForm, additional_ingress_time: e.target.value })}
                        placeholder="Earlier than the default buffer"
                      />
                    </label>
                    <label className="sb-field">
                      Requested Egress Time
                      <input
                        type="time"
                        value={appForm.additional_egress_time}
                        onChange={(e) => setAppForm({ ...appForm, additional_egress_time: e.target.value })}
                        placeholder="Later than the default buffer"
                      />
                    </label>
                  </div>
                )}
                {additionalTimeNeedsLetter && (
                  <div className="sb-form-error">
                    <AlertCircle size={14} />
                    Your requested {additionalIngressNeedsLetter && additionalEgressNeedsLetter ? 'ingress and egress times fall' : additionalIngressNeedsLetter ? 'ingress time falls' : 'egress time falls'} outside gate hours (before 6:00 AM or after 9:00 PM). A letter must be submitted to the Security Office for approval. Once approved by the Academic Director, this will be automatically assigned to the org President via the Assignment tab, due 3 days before the event.
                  </div>
                )}
              </div>
            )}

            {nightBeforeEligible && (
              <div className="sb-field sb-night-before">
                <label className="sb-checkbox-label">
                  <input
                    type="checkbox"
                    checked={appForm.night_before_ingress}
                    disabled={!!nightBeforeConflict || checkingNightBefore}
                    onChange={(e) => setAppForm({ ...appForm, night_before_ingress: e.target.checked })}
                  />
                  Request ingress the night before{nightBeforeDateLabel ? ` (${nightBeforeDateLabel}, 7:00–9:00 PM)` : ' (7:00–9:00 PM the day before)'}
                </label>
                {checkingNightBefore && (
                  <div className="sb-form-notice"><Loader2 size={14} className="spin" /> Checking venue availability the night before…</div>
                )}
                {!checkingNightBefore && nightBeforeConflict && (
                  <div className="sb-form-error"><AlertCircle size={14} /> {nightBeforeConflict}</div>
                )}
              </div>
            )}

            {checkingVenue && (
              <div className="sb-form-notice"><Loader2 size={14} className="spin" /> Checking venue availability…</div>
            )}
            {venueConflict && (
              <div className="sb-form-error"><AlertCircle size={14} /> {venueConflict}</div>
            )}
            {!venueConflict && venueAdvisory && (
              <div className="sb-form-notice"><AlertCircle size={14} /> {venueAdvisory}</div>
            )}

            {activeRestrictedPeriod && (
              <div className="sb-restricted-notice">
                <PartyPopper size={15} />
                <div className="sb-restricted-notice__body">
                  <strong>
                    {activeRestrictedPeriod.kind === 'exam_period' ? 'Exam period' : 'Holiday'}: {activeRestrictedPeriod.label}
                  </strong>
                  <span>
                    Booking activities on this date is not recommended and is only allowed under
                    extraordinary circumstances.
                    {activeRestrictedPeriod.note && ` ${activeRestrictedPeriod.note}`}
                  </span>
                  <label className="sb-checkbox-label">
                    <input
                      type="checkbox"
                      checked={appForm.restricted_period_ack}
                      onChange={(e) => setAppForm({ ...appForm, restricted_period_ack: e.target.checked })}
                    />
                    I acknowledge this and confirm this is an extraordinary circumstance.
                  </label>
                  {appForm.restricted_period_ack && (
                    <label className="sb-field">
                      Please briefly explain the extraordinary circumstance
                      <input
                        value={appForm.restricted_period_justification}
                        onChange={(e) => setAppForm({ ...appForm, restricted_period_justification: e.target.value })}
                        placeholder="e.g. Required by an accreditation deadline that can't be moved"
                        required
                      />
                    </label>
                  )}
                </div>
              </div>
            )}

            <div className="sb-field">
              <label className="sb-checkbox-label">
                <input
                  type="checkbox"
                  checked={appForm.is_multi_day}
                  disabled={appForm.is_continuing}
                  onChange={(e) => setAppForm({
                    ...appForm,
                    is_multi_day: e.target.checked,
                    event_dates: e.target.checked
                      ? [{
                          event_date: appForm.event_date, start_time: appForm.start_time, end_time: appForm.end_time,
                          venue_id: appForm.venue_id, venue_ids: appForm.venue_ids,
                          venue_detail: appForm.venue_detail, venue_details: appForm.venue_details,
                          room_selections: appForm.room_selections, lab_selections: appForm.lab_selections,
                          pencil_booked: appForm.pencil_booked,
                          wants_additional_time: appForm.wants_additional_time,
                          additional_ingress_time: appForm.additional_ingress_time,
                          additional_egress_time: appForm.additional_egress_time,
                        }]
                      : appForm.event_dates,
                  })}
                />
                This is a Multi-Day Event
              </label>
              <label className="sb-checkbox-label">
                <input
                  type="checkbox"
                  checked={appForm.is_continuing}
                  disabled={appForm.is_multi_day}
                  onChange={(e) => setAppForm({ ...appForm, is_continuing: e.target.checked, event_date: e.target.checked ? '' : appForm.event_date })}
                />
                This is a Continuing / Year-Round Activity (or Term-based, not a single date)
              </label>
              {appForm.is_continuing && (
                <div className="sb-continuing-options">
                  <label className="sb-radio-label">
                    <input
                      type="radio"
                      name="continuing_type"
                      checked={appForm.continuing_type === 'year_round'}
                      onChange={() => setAppForm({ ...appForm, continuing_type: 'year_round' })}
                    />
                    Year-Round
                  </label>
                  <label className="sb-radio-label">
                    <input
                      type="radio"
                      name="continuing_type"
                      checked={appForm.continuing_type === 'term'}
                      onChange={() => setAppForm({ ...appForm, continuing_type: 'term' })}
                    />
                    Term
                    <input
                      className="sb-term-input"
                      placeholder='e.g. "1, SY 2026-2027"'
                      value={appForm.term_label}
                      onFocus={() => setAppForm((f) => ({ ...f, continuing_type: 'term' }))}
                      onChange={(e) => setAppForm({ ...appForm, continuing_type: 'term', term_label: e.target.value })}
                    />
                  </label>
                  <p className="sb-hint">
                    The ACP Form will print "{appForm.continuing_type === 'term' ? `Term ${appForm.term_label || '__'}` : 'Year-Round'}" in the Date field. Since this activity has no single date, the Date field above is disabled — the SDAO Assistant will assign a report submission date instead before forwarding.
                  </p>
                </div>
              )}
            </div>

            <div className="sb-field-row">
              <label className="sb-field">
                Target Audience
                <input value={appForm.target_audience} onChange={(e) => setAppForm({ ...appForm, target_audience: e.target.value })} placeholder="e.g. All BS IT students" required />
              </label>
              <label className="sb-field">
                Target No. of Participants
                <input type="number" min="1" value={appForm.target_participants} onChange={(e) => setAppForm({ ...appForm, target_participants: e.target.value })} required />
              </label>
            </div>

            <div className="sb-field-row">
              <label className="sb-field">
                Projected Budget (PHP)
                <input type="number" min="0" step="0.01" value={appForm.projected_budget} onChange={(e) => setAppForm({ ...appForm, projected_budget: e.target.value })} required />
              </label>
              <label className="sb-field">
                Source of Budget
                <input value={appForm.budget_source} onChange={(e) => setAppForm({ ...appForm, budget_source: e.target.value })} placeholder="e.g. Org funds" required />
              </label>
            </div>

            <label className="sb-field">
              Description
              <textarea rows={2} value={appForm.description} onChange={(e) => setAppForm({ ...appForm, description: e.target.value })} />
            </label>

            {canTagCOLEvents && (
              <div className="sb-field">
                <span>Flagship Event Tag(s)</span>
                <div className="sb-col-event-grid">
                  {[...COL_EVENT_OPTIONS, 'Others'].map((opt) => (
                    <label key={opt} className="sb-checkbox-label">
                      <input
                        type="checkbox"
                        checked={appForm.col_event_tags.includes(opt)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...appForm.col_event_tags, opt]
                            : appForm.col_event_tags.filter((t) => t !== opt)
                          setAppForm({ ...appForm, col_event_tags: next })
                        }}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
                {appForm.col_event_tags.includes('Others') && (
                  <input
                    value={appForm.col_event_other}
                    onChange={(e) => setAppForm({ ...appForm, col_event_other: e.target.value })}
                    placeholder="Specify the event"
                  />
                )}
              </div>
            )}

            <div className="sb-form-notice">
              <ShieldAlert size={14} />
              <span>
                Sustainable Development Goals aren't marked here — {myOrgIsCOL
                  ? 'the SDG Representative reviews this application directly and marks'
                  : "after your Adviser (and Dean, if applicable) approve, the SDG Representative reviews this application and marks"}
                {' '}which SDGs it counts toward. You'll see it reflected
                on the ACP Form once they've signed off.
              </span>
            </div>

            <div className="sb-field">
              <span>Learning Goals/Objectives of the Activity</span>
              <input
                className="sb-sdg-goal"
                value={appForm.learning_goal_1}
                onChange={(e) => setAppForm({ ...appForm, learning_goal_1: e.target.value })}
                placeholder="1.)"
                required
              />
              <input
                className="sb-sdg-goal"
                value={appForm.learning_goal_2}
                onChange={(e) => setAppForm({ ...appForm, learning_goal_2: e.target.value })}
                placeholder="2.) (optional)"
              />
              <input
                className="sb-sdg-goal"
                value={appForm.learning_goal_3}
                onChange={(e) => setAppForm({ ...appForm, learning_goal_3: e.target.value })}
                placeholder="3.) (optional)"
              />
            </div>

            <div className="sb-form-notice">
              <FileText size={14} />
              The Activity Concept Paper (ACP Form) is generated automatically from the fields above and attached to this application — no need to upload it separately.
            </div>

            <div className="sb-attach-group">
              <span className="sb-attach-group__label">Attachments</span>
              {EVENT_APP_DOCS.map((doc) => (
                <AttachmentRow
                  key={doc}
                  label={doc}
                  entry={appFiles[doc]}
                  onChange={(v) => setAppFiles({ ...appFiles, [doc]: v })}
                  template={templateFor(doc)}
                  accept={acceptAttrFor(doc)}
                  formatHint={formatHintFor(doc)}
                />
              ))}
            </div>

            <button
              type="submit"
              className="sb-btn sb-btn--gold sb-btn--full"
              disabled={
                saving || !!venueConflict || checkingVenue || clearanceBlocked || anyVenueUnavailable ||
                (!!activeRestrictedPeriod && (!appForm.restricted_period_ack || !appForm.restricted_period_justification.trim()))
              }
              title={clearanceBlocked ? 'Settle your organization\'s overdue clearance before submitting.' : undefined}
            >
              {saving ? <Loader2 size={15} className="spin" /> : 'Submit Application'}
            </button>
          </form>
        </div>
      )}

      {/* ---------- New Report ---------- */}
      {showReportModal && (
        <div className="sb-modal-backdrop" onClick={() => setShowReportModal(false)}>
          <form className="sb-modal sb-modal--form" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmitReport}>
            <button type="button" className="sb-modal__close" onClick={() => setShowReportModal(false)}><X size={18} /></button>
            <h3 className="sb-modal__title">Submit Activity Report</h3>

            {formError && <div className="sb-form-error"><AlertCircle size={14} /> {formError}</div>}

            {openClearances.length === 0 ? (
              <p className="sb-empty-note">Your organization has no outstanding report obligations right now.</p>
            ) : (
              <>
                <label className="sb-field">
                  Activity being reported on
                  <select value={reportClearanceId} onChange={(e) => setReportClearanceId(e.target.value)} required>
                    <option value="">Select activity</option>
                    {openClearances.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.events?.title} — {c.events?.event_date}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="sb-attach-group">
                  <span className="sb-attach-group__label">Report Documents</span>
                  {REPORT_DOCS.map((doc) => (
                    <AttachmentRow
                      key={doc}
                      label={doc}
                      entry={reportFiles[doc]}
                      onChange={(v) => setReportFiles({ ...reportFiles, [doc]: v })}
                      template={templateFor(doc)}
                      accept={acceptAttrFor(doc)}
                      formatHint={formatHintFor(doc)}
                    />
                  ))}
                </div>

                <button type="submit" className="sb-btn sb-btn--gold sb-btn--full" disabled={saving}>
                  {saving ? <Loader2 size={15} className="spin" /> : 'Submit Report'}
                </button>
              </>
            )}
          </form>
        </div>
      )}

      {/* ---------- New Merchandise Proposal ---------- */}
      {showMerchModal && (
        <div className="sb-modal-backdrop" onClick={() => setShowMerchModal(false)}>
          <form className="sb-modal sb-modal--form" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmitMerch}>
            <button type="button" className="sb-modal__close" onClick={() => setShowMerchModal(false)}><X size={18} /></button>
            <h3 className="sb-modal__title">New Merchandise Proposal</h3>

            {formError && <div className="sb-form-error"><AlertCircle size={14} /> {formError}</div>}

            <p className="sb-empty-note">
              Activity title will be automatically set to "[Your Org] Merchandise Proposal".
            </p>

            <div className="sb-field-row">
              <label className="sb-field">
                Contact Person
                <input value={merchForm.contact_person} onChange={(e) => setMerchForm({ ...merchForm, contact_person: e.target.value })} required />
              </label>
              <label className="sb-field">
                Contact Number
                <input value={merchForm.contact_number} onChange={(e) => setMerchForm({ ...merchForm, contact_number: e.target.value })} />
              </label>
            </div>

            <div className="sb-field-row">
              <label className="sb-field">
                Position
                <input value={merchForm.position} onChange={(e) => setMerchForm({ ...merchForm, position: e.target.value })} required />
              </label>
              <label className="sb-field">
                Email Address
                <input type="email" value={merchForm.email} onChange={(e) => setMerchForm({ ...merchForm, email: e.target.value })} required />
              </label>
            </div>

            <div className="sb-field-row">
              <label className="sb-field">
                Release Date
                <input type="date" value={merchForm.event_date} onChange={(e) => setMerchForm({ ...merchForm, event_date: e.target.value })} required />
              </label>
            </div>

            <div className="sb-field">
              <span>Merchandise is:</span>
              {MERCH_DURATIONS.map((d) => (
                <label key={d.value} className="sb-radio-label">
                  <input
                    type="radio"
                    name="merchandise_duration"
                    checked={merchForm.merchandise_duration === d.value}
                    onChange={() => setMerchForm({ ...merchForm, merchandise_duration: d.value })}
                  />
                  {d.label}
                </label>
              ))}
            </div>

            <div className="sb-field-row">
              <label className="sb-field">
                Target Audience
                <input value={merchForm.target_audience} onChange={(e) => setMerchForm({ ...merchForm, target_audience: e.target.value })} placeholder="e.g. All BS IT students" required />
              </label>
              <label className="sb-field">
                Target No. of Participants
                <input type="number" min="1" value={merchForm.target_participants} onChange={(e) => setMerchForm({ ...merchForm, target_participants: e.target.value })} required />
              </label>
            </div>

            <div className="sb-field-row">
              <label className="sb-field">
                Projected Budget (PHP)
                <input type="number" min="0" step="0.01" value={merchForm.projected_budget} onChange={(e) => setMerchForm({ ...merchForm, projected_budget: e.target.value })} required />
              </label>
              <label className="sb-field">
                Source of Budget
                <input value={merchForm.budget_source} onChange={(e) => setMerchForm({ ...merchForm, budget_source: e.target.value })} placeholder="e.g. Org funds" required />
              </label>
            </div>

            <label className="sb-field">
              Description
              <textarea rows={2} value={merchForm.description} onChange={(e) => setMerchForm({ ...merchForm, description: e.target.value })} />
            </label>

            <div className="sb-field">
              <span>Learning Goals/Objectives of the Activity</span>
              <input
                className="sb-sdg-goal"
                value={merchForm.learning_goal_1}
                onChange={(e) => setMerchForm({ ...merchForm, learning_goal_1: e.target.value })}
                placeholder="1.)"
                required
              />
              <input
                className="sb-sdg-goal"
                value={merchForm.learning_goal_2}
                onChange={(e) => setMerchForm({ ...merchForm, learning_goal_2: e.target.value })}
                placeholder="2.) (optional)"
              />
              <input
                className="sb-sdg-goal"
                value={merchForm.learning_goal_3}
                onChange={(e) => setMerchForm({ ...merchForm, learning_goal_3: e.target.value })}
                placeholder="3.) (optional)"
              />
            </div>

            <div className="sb-attach-group">
              <span className="sb-attach-group__label">Types of Merchandise</span>
              {MERCHANDISE_TYPES.map((t) => {
                const checked = merchTypes.includes(t)
                return (
                  <label key={t} className="sb-sdg-goal" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setMerchTypes((prev) => (
                        e.target.checked ? [...prev, t] : prev.filter((v) => v !== t)
                      ))}
                    />
                    {t}
                  </label>
                )
              })}
              {merchTypes.includes('Others') && (
                <input
                  className="sb-sdg-goal"
                  value={merchOtherText}
                  onChange={(e) => setMerchOtherText(e.target.value)}
                  placeholder="Please specify"
                  required
                />
              )}
            </div>

            <div className="sb-form-notice">
              <FileText size={14} />
              The Merchandise Request Form is generated automatically from the fields above and attached to this proposal — no need to upload it separately.
            </div>

            <div className="sb-attach-group">
              <span className="sb-attach-group__label">Attachments</span>
              {MERCH_DOCS.map((doc) => (
                <AttachmentRow
                  key={doc}
                  label={doc === 'Design Concept' ? 'Design Concept (all designs compiled in one PDF)' : 'Quotation from Supplier (all quotations compiled in one PDF)'}
                  entry={merchFiles[doc]}
                  onChange={(v) => setMerchFiles({ ...merchFiles, [doc]: v })}
                  accept={acceptAttrFor(doc)}
                  formatHint={formatHintFor(doc)}
                />
              ))}
            </div>

            <button
              type="submit"
              className="sb-btn sb-btn--gold sb-btn--full"
              disabled={saving || clearanceBlocked}
              title={clearanceBlocked ? 'Settle your organization\'s overdue clearance before submitting.' : undefined}
            >
              {saving ? <Loader2 size={15} className="spin" /> : 'Submit Proposal'}
            </button>
          </form>
        </div>
      )}

      {/* ---------- Detail / Review Workspace ---------- */}
      {selected && (() => {
        const isOwnerOrg = !admin && myOrgId === selected.org_id
        const canResubmit = isOwnerOrg && selected.stage === 'returned'
        const activeAttachment = attachments.find((a) => a.id === viewerAttachmentId) || null

        return (
          <div className="sb-modal-backdrop" onClick={() => setSelected(null)}>
            <div className="sb-modal sb-modal--review" onClick={(e) => e.stopPropagation()}>
              <button className="sb-modal__close" onClick={() => setSelected(null)}><X size={18} /></button>

              <div className="sb-review">
                {/* ---------- Left: review panel ---------- */}
                <div className="sb-review__left">
                  <span className="sb-type-tag">
                    {selected.type === 'event_application' ? 'Event Application Review' : selected.type === 'merchandise' ? 'Merchandise Proposal Review' : 'Activity Report Review'}
                  </span>
                  <h3 className="sb-modal__title">{selected.title}</h3>
                  {(admin || canReview) && (
                    <p className="sb-modal__org"><Building2 size={14} /> {selected.organizations?.acronym} — {selected.organizations?.name}</p>
                  )}

                  {(selected.stage === 'returned' || selected.stage === 'rejected') ? (
                    <div className={`sb-outcome sb-outcome--${selected.stage === 'returned' ? 'warn' : 'danger'}`}>
                      {selected.stage === 'returned' ? <Undo2 size={15} /> : <Ban size={15} />}
                      This submission was {selected.stage}.
                    </div>
                  ) : (
                    <div className="sb-stepper">
                      {(() => {
                        const steps = stepsFor(selected.type)
                        const chainComplete = (selected.type === 'event_application' || selected.type === 'merchandise')
                          ? externalApprovalState(approvalLinks, selected.organizations?.category, selected.type).complete
                          : true
                        const current = stepIndexFor(selected.type, selected.stage, chainComplete)
                        return steps.map((step, i) => {
                          const state = i < current ? 'done' : i === current ? 'active' : 'pending'
                          return (
                            <div key={step.key} className={`sb-step sb-step--${state}`}>
                              <div className="sb-step__dot">{state === 'done' ? <Check size={11} /> : i + 1}</div>
                              <span className="sb-step__label">{step.label}</span>
                              {i < steps.length - 1 && <div className="sb-step__line" />}
                            </div>
                          )
                        })
                      })()}
                    </div>
                  )}

                  {selected.type === 'event_application' && (
                    <div className="sb-detail-grid">
                      <div className="sb-detail-row">
                        <MapPin size={13} />
                        {selected.online_platform
                          ? (ONLINE_PLATFORMS.find((p) => p.value === selected.online_platform)?.label || selected.online_platform)
                          : (selected.venues?.name || '—')}
                        {selected.venue_detail && ` — ${selected.venue_detail}`}
                        {selected.venue_tag && ` (${selected.venue_tag})`}
                      </div>
                      {selected.pencil_booked !== null && selected.pencil_booked !== undefined && (
                        <div className="sb-detail-row">
                          <Check size={13} /> Pencil Booked: {selected.pencil_booked ? 'Yes' : 'No'}
                        </div>
                      )}
                      {selected.lab_endorsed !== null && selected.lab_endorsed !== undefined && (
                        <div className="sb-detail-row">
                          <Check size={13} /> Lab Owner Endorsed: {selected.lab_endorsed ? 'Yes' : 'No'}
                        </div>
                      )}
                      {selected.restricted_period_ack && (
                        <div className="sb-detail-row sb-detail-row--warn">
                          <PartyPopper size={13} /> Submitted despite holiday/exam period notice
                          {selected.restricted_period_justification && `: "${selected.restricted_period_justification}"`}
                        </div>
                      )}
                      {selected.col_event_tags?.length > 0 && (
                        <div className="sb-detail-row">
                          <Tag size={13} /> Flagship Event: {selected.col_event_tags.join(', ')}
                        </div>
                      )}
                      <div className="sb-detail-row">
                        <Clock size={13} /> {selected.event_date}
                        {selected.start_time && ` · ${formatTime(selected.start_time)}`}
                        {selected.end_time && ` – ${formatTime(selected.end_time)}`}
                      </div>
                      <div className="sb-detail-row"><Video size={13} /> {MEDIUM_LABELS[selected.medium] || '—'}</div>
                      <div className="sb-detail-row"><User size={13} /> {selected.contact_person}{selected.contact_number && ` · ${selected.contact_number}`}</div>
                    </div>
                  )}

                  {selected.type === 'report' && selected.events?.title && (
                    <div className="sb-detail-grid">
                      <div className="sb-detail-row"><ClipboardList size={13} /> Reporting on: {selected.events.title}</div>
                    </div>
                  )}

                  {selected.type === 'merchandise' && (
                    <div className="sb-detail-grid">
                      <div className="sb-detail-row">
                        <Clock size={13} /> Release Date: {selected.event_date || '—'}
                      </div>
                      <div className="sb-detail-row"><User size={13} /> {selected.contact_person || '—'}{selected.contact_number && ` · ${selected.contact_number}`}</div>
                      <div className="sb-detail-row">
                        <ClipboardList size={13} /> {MERCH_DURATIONS.find((d) => d.value === selected.merchandise_duration)?.label || '—'}
                      </div>
                      <div className="sb-detail-row sb-detail-row--wrap">
                        <ClipboardList size={13} /> Types of Merchandise: {(selected.merchandise_types || []).join(', ') || '—'}
                      </div>
                      {selected.marketing_representative && (
                        <div className="sb-detail-row"><Check size={13} /> Reviewed by Marketing: {selected.marketing_representative}</div>
                      )}
                    </div>
                  )}

                  {/* ---------- Additional Requirements checklist ---------- */}
                  <div className="sb-detail-section">
                    <div className="sb-detail-section__head">
                      <span className="sb-detail-section__label">Additional Requirements</span>
                      {canReview && (
                        <button type="button" className="sb-icon-btn" onClick={() => setAddingChecklistItem((v) => !v)} title="Add requirement">
                          <Plus size={13} />
                        </button>
                      )}
                    </div>

                    {checklist.length === 0 && !addingChecklistItem ? (
                      <p className="sb-empty-note">No additional requirements yet.</p>
                    ) : (
                      <ul className="sb-checklist">
                        {checklist.map((item) => (
                          <li key={item.id} className="sb-checklist__item">
                            <button
                              type="button"
                              className={`sb-checkbox ${item.is_checked ? 'sb-checkbox--checked' : ''}`}
                              onClick={() => canReview && toggleChecklistItem(item)}
                              disabled={!canReview}
                              aria-label={item.is_checked ? 'Mark incomplete' : 'Mark complete'}
                            >
                              {item.is_checked && <Check size={12} />}
                            </button>
                            <span className={item.is_checked ? 'sb-checklist__label sb-checklist__label--done' : 'sb-checklist__label'}>
                              {item.label}
                            </span>
                            {canReview && (
                              <button type="button" className="sb-checklist__remove" onClick={() => removeChecklistItem(item)} title="Remove">
                                <X size={12} />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {addingChecklistItem && (
                      <div className="sb-inline-add">
                        <input
                          autoFocus
                          placeholder="e.g. ITSO Endorsement"
                          value={newChecklistLabel}
                          onChange={(e) => setNewChecklistLabel(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addChecklistItem()}
                        />
                        <button type="button" className="sb-btn sb-btn--outline sb-btn--sm" onClick={addChecklistItem}>Add</button>
                      </div>
                    )}
                  </div>

                  {/* ---------- Comments ---------- */}
                  <div className="sb-detail-section">
                    <div className="sb-detail-section__head">
                      <span className="sb-detail-section__label">Comments</span>
                      {canReview && (
                        <button type="button" className="sb-icon-btn" onClick={() => setShowNewComment((v) => !v)} title="Add comment">
                          <Plus size={13} />
                        </button>
                      )}
                    </div>

                    {comments.length === 0 && !showNewComment ? (
                      <p className="sb-empty-note">No comments yet.</p>
                    ) : comments.length > 0 && !showNewComment ? (
                      <div className="sb-comment-card">
                        {comments[commentIndex]?.page_number && (
                          <div className="sb-comment-card__page">Page Number: <strong>{comments[commentIndex].page_number}</strong></div>
                        )}
                        <p className="sb-comment-card__body">{comments[commentIndex]?.body}</p>
                        <div className="sb-comment-card__meta">
                          <span>{comments[commentIndex]?.author?.full_name || 'Reviewer'}</span>
                          <span>{new Date(comments[commentIndex]?.created_at).toLocaleString()}</span>
                        </div>
                        <div className="sb-comment-card__footer">
                          {canReview && comments[commentIndex]?.author_id === profile.id && (
                            <button type="button" className="sb-comment-card__delete" onClick={() => deleteComment(comments[commentIndex])}>
                              <X size={11} /> Delete
                            </button>
                          )}
                          <div className="sb-comment-nav">
                            <button
                              type="button"
                              className="sb-icon-btn"
                              onClick={() => setCommentIndex((i) => Math.max(0, i - 1))}
                              disabled={commentIndex === 0}
                            >
                              <ChevronLeft size={14} />
                            </button>
                            <span>Comment {commentIndex + 1} of {comments.length}</span>
                            <button
                              type="button"
                              className="sb-icon-btn"
                              onClick={() => setCommentIndex((i) => Math.min(comments.length - 1, i + 1))}
                              disabled={commentIndex === comments.length - 1}
                            >
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {showNewComment && (
                      <div className="sb-comment-card sb-comment-card--edit">
                        <label className="sb-field">
                          Page Number
                          <input
                            placeholder="e.g. 2"
                            value={newCommentPage}
                            onChange={(e) => setNewCommentPage(e.target.value)}
                          />
                        </label>
                        <label className="sb-field">
                          Details
                          <textarea
                            rows={3}
                            placeholder="What needs attention on this page..."
                            value={newCommentBody}
                            onChange={(e) => setNewCommentBody(e.target.value)}
                          />
                        </label>
                        <div className="sb-review-actions__row">
                          <button type="button" className="sb-btn sb-btn--outline" onClick={() => setShowNewComment(false)} disabled={savingComment}>Cancel</button>
                          <button type="button" className="sb-btn sb-btn--gold" onClick={addComment} disabled={savingComment || !newCommentBody.trim()}>
                            {savingComment ? <Loader2 size={14} className="spin" /> : 'Post Comment'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ---------- Adviser / Dean / SDG Rep external approvals ---------- */}
                  {(selected.type === 'event_application' || selected.type === 'merchandise') && (selected.stage !== 'rejected' || approvalLinks.length > 0) && (() => {
                    const category = selected.organizations?.category
                    const state = externalApprovalState(approvalLinks, category, selected.type)
                    const { chain } = state
                    const linkByRole = state.byRole
                    const canManage = (isOwnerOrg || admin) && selected.stage === 'submitted'

                    function badgeFor(link) {
                      if (!link) return <span className="sb-badge sb-badge--muted">Not sent yet</span>
                      if (link.status === 'pending' && new Date(link.expires_at) < new Date()) {
                        return <span className="sb-badge sb-badge--danger"><Hourglass size={11} /> Expired</span>
                      }
                      if (link.status === 'approved') return <span className="sb-badge sb-badge--ok"><CheckCircle2 size={11} /> Approved</span>
                      if (link.status === 'rejected') return <span className="sb-badge sb-badge--danger"><Ban size={11} /> Rejected</span>
                      return <span className="sb-badge sb-badge--warn"><Hourglass size={11} /> Awaiting response</span>
                    }

                    return (
                      <div className="sb-detail-section">
                        <span className="sb-detail-section__label"><Link2 size={12} style={{ verticalAlign: -2 }} /> External Sign-off ({chain.map((role) => ROLE_LABELS[role]).join(' → ')})</span>
                        {linkError && <div className="sb-form-error"><AlertCircle size={14} /> {linkError}</div>}
                        {chain.map((role, idx) => {
                          const link = linkByRole[role]
                          const prevRole = chain[idx - 1]
                          const locked = idx > 0 && linkByRole[prevRole]?.status !== 'approved'
                          const url = link && link.status !== 'rejected' ? approvalLinkUrl(link.token) : null
                          return (
                            <div key={role} className="sb-approval-row">
                              <div className="sb-approval-row__head">
                                <strong>{ROLE_LABELS[role]}</strong>
                                {badgeFor(link)}
                              </div>
                              {locked && <p className="sb-empty-note">Unlocks once the {ROLE_LABELS[prevRole]} approves.</p>}
                              {!locked && link && (
                                <>
                                  <p className="sb-approval-row__person">{link.person_name}{link.person_email ? ` · ${link.person_email}` : ''}</p>
                                  {url && (
                                    <div className="sb-approval-row__link">
                                      <input readOnly value={url} onFocus={(e) => e.target.select()} />
                                      <button
                                        type="button"
                                        className="sb-icon-btn"
                                        title="Copy link"
                                        onClick={() => {
                                          navigator.clipboard?.writeText(url)
                                          setCopiedRole(role)
                                          setTimeout(() => setCopiedRole(null), 1500)
                                        }}
                                      >
                                        {copiedRole === role ? <Check size={14} /> : <Copy size={14} />}
                                      </button>
                                    </div>
                                  )}
                                  {role === 'sdg_rep' && link.status === 'approved' && (
                                    <p className="sb-approval-row__person">
                                      Marked: {(link.sdg_selections || []).length
                                        ? link.sdg_selections.map((v) => SDG_OPTIONS[Number(v) - 1]).join(', ')
                                        : '—'}
                                    </p>
                                  )}
                                  {link.comment && <p className="sb-history-list__comment">"{link.comment}"</p>}
                                  <span className="sb-history-list__time">Expires {new Date(link.expires_at).toLocaleString()}</span>
                                  {admin && link.status === 'approved' && link.signature_data && (
                                    <div className="sb-signature-view">
                                      <span className="sb-signature-view__label">Signature</span>
                                      <img src={link.signature_data} alt={`${role} signature`} className="sb-signature-view__img" />
                                    </div>
                                  )}
                                </>
                              )}
                              {!locked && canManage && (!link || link.status === 'rejected' || (link.status === 'pending' && new Date(link.expires_at) < new Date())) && (
                                <div className="sb-approval-row__form">
                                  {role === 'sdg_rep' ? (
                                    <select
                                      value={linkForm.sdg_rep.name}
                                      onChange={(e) => setLinkForm((f) => ({ ...f, sdg_rep: { ...f.sdg_rep, name: e.target.value } }))}
                                    >
                                      <option value="">Select SDG Representative…</option>
                                      {SDG_REP_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
                                    </select>
                                  ) : (
                                    <input
                                      placeholder={`${ROLE_LABELS[role]} full name`}
                                      value={linkForm[role].name}
                                      onChange={(e) => setLinkForm((f) => ({ ...f, [role]: { ...f[role], name: e.target.value } }))}
                                    />
                                  )}
                                  <input
                                    placeholder="Email (optional)"
                                    value={linkForm[role].email}
                                    onChange={(e) => setLinkForm((f) => ({ ...f, [role]: { ...f[role], email: e.target.value } }))}
                                  />
                                  <button
                                    type="button"
                                    className="sb-btn sb-btn--gold"
                                    disabled={generatingLinkRole === role}
                                    onClick={() => generateAndSetLink(
                                      selected.id, role, linkForm[role].name, linkForm[role].email,
                                      setApprovalLinks, setLinkError, setGeneratingLinkRole,
                                    )}
                                  >
                                    {generatingLinkRole === role ? <Loader2 size={14} className="spin" /> : <><Send size={13} /> Generate Link</>}
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}

                  {/* ---------- Attachments ---------- */}
                  <div className="sb-detail-section">
                    <span className="sb-detail-section__label">Attachments</span>
                    {detailLoading ? (
                      <Loader2 size={15} className="spin" />
                    ) : attachments.length === 0 ? (
                      <p className="sb-empty-note">No attachments found.</p>
                    ) : (
                      <ul className="sb-attach-list">
                        {attachments.map((a) => (
                          <li key={a.id} className={a.id === viewerAttachmentId ? 'sb-attach-list__item--active' : ''}>
                            <FileText size={13} />
                            <button type="button" className="sb-attach-list__view" onClick={() => setViewerAttachmentId(a.id)}>
                              {a.document_type}
                            </button>
                            <a href={a.file_url} target="_blank" rel="noreferrer"><Download size={13} /></a>
                          </li>
                        ))}
                      </ul>
                    )}

                    {(isOwnerOrg || admin) && selected.stage === 'returned' && (
                      <div className="sb-extra-attach">
                        <input
                          className="sb-extra-attach__label"
                          placeholder="Document name (e.g. Dean Endorsement Letter)"
                          value={extraDocLabel}
                          onChange={(e) => setExtraDocLabel(e.target.value)}
                        />
                        <AttachmentRow
                          label="Additional Attachment"
                          entry={extraDocEntry}
                          onChange={setExtraDocEntry}
                          accept=".pdf,.xlsx,.xls,.doc,.docx,.jpg,.jpeg,.png"
                          formatHint="PDF, Excel, Word, or image"
                        />
                        <button
                          type="button"
                          className="sb-btn sb-btn--outline sb-btn--sm sb-btn--full"
                          onClick={addExtraAttachment}
                          disabled={!extraDocEntry || uploadingExtra}
                        >
                          {uploadingExtra ? <Loader2 size={14} className="spin" /> : <><Plus size={13} /> Add Attachment</>}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="sb-detail-section">
                    <span className="sb-detail-section__label">History</span>
                    {history.length === 0 ? (
                      <p className="sb-empty-note">No activity yet.</p>
                    ) : (
                      <ul className="sb-history-list">
                        {history.map((h) => (
                          <li key={h.id}>
                            <CheckCircle2 size={13} />
                            <div>
                              <span className="sb-history-list__action">
                                {h.actor?.full_name || h.actor_name || 'Someone'} {h.action} this submission
                              </span>
                              {h.comment && <p className="sb-history-list__comment">"{h.comment}"</p>}
                              <span className="sb-history-list__time">{new Date(h.created_at).toLocaleString()}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {openTasks.length > 0 && (
                    <div className="sb-detail-section">
                      <span className="sb-detail-section__label"><ListChecks size={12} style={{ verticalAlign: -2 }} /> Linked Tasks</span>
                      <ul className="sb-task-list">
                        {openTasks.map((t) => (
                          <li key={t.id}>
                            <span className={`sb-badge sb-badge--${t.status === 'submitted' ? 'warn' : t.status === 'conditional_approved' ? 'muted' : 'danger'}`}>
                              {t.status.replace('_', ' ')}
                            </span>
                            <span className="sb-task-list__title">{t.title}</span>
                            {t.assignee?.full_name && <span className="sb-task-list__assignee">{t.assignee.full_name}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* ---------- Return & Resubmit (owning org) ---------- */}
                  {canResubmit && (
                    <div className="sb-detail-section">
                      <span className="sb-detail-section__label">Resubmit</span>
                      {actionError && <div className="sb-form-error"><AlertCircle size={14} /> {actionError}</div>}
                      <p className="sb-empty-note">
                        Address the reviewer's comments above, attach any additional documents needed, then resubmit
                        this {selected.type === 'event_application' ? 'application' : selected.type === 'merchandise' ? 'proposal' : 'report'} for review.
                      </p>
                      <textarea
                        className="sb-comment-box"
                        rows={2}
                        placeholder="Optional note to the reviewer about what changed..."
                        value={resubmitNote}
                        onChange={(e) => setResubmitNote(e.target.value)}
                      />
                      <button type="button" className="sb-btn sb-btn--gold sb-btn--full" onClick={handleResubmit} disabled={resubmitting}>
                        {resubmitting ? <Loader2 size={15} className="spin" /> : <><Undo2 size={14} /> Resubmit for Review</>}
                      </button>
                    </div>
                  )}

                  {/* ---------- Reviewer actions ---------- */}
                  {canReview && !['approved', 'returned', 'rejected'].includes(selected.stage) && (() => {
                    const nextAction = nextActionFor(profile.role, selected.stage, selected.type)
                    if (!nextAction) return null

                    const assistantTurn = ['sdao_assistant', 'system_admin'].includes(profile.role)
                      && (selected.stage === 'submitted' || selected.stage === 'assistant_review')
                    const blocked = assistantTurn && openTasks.length > 0

                    const externalGate = assistantTurn && (selected.type === 'event_application' || selected.type === 'merchandise')
                      ? externalApprovalState(approvalLinks, selected.organizations?.category, selected.type)
                      : null
                    if (externalGate && !externalGate.complete) {
                      const linkByRole = externalGate.byRole
                      const waitingOnRole = externalGate.chain.find((role) => linkByRole[role]?.status !== 'approved')
                      return (
                        <div className="sb-review-actions">
                          <div className="sb-note sb-note--warn">
                            <ShieldAlert size={15} />
                            <span>
                              Waiting on the {ROLE_LABELS[waitingOnRole]} to approve before this can be forwarded.
                              {' '}Generate their link above if you haven't already sent one.
                            </span>
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div className="sb-review-actions">
                        {actionMode === 'return' || actionMode === 'reject' ? (
                          <>
                            {actionError && <div className="sb-form-error"><AlertCircle size={14} /> {actionError}</div>}
                            <textarea
                              className="sb-comment-box"
                              rows={2}
                              placeholder={`Reason for ${actionMode === 'return' ? 'returning' : 'rejecting'} this submission...`}
                              value={actionComment}
                              onChange={(e) => setActionComment(e.target.value)}
                            />
                            <div className="sb-review-actions__row">
                              <button className="sb-btn sb-btn--outline" onClick={() => setActionMode(null)} disabled={acting}>Cancel</button>
                              <button
                                className={`sb-btn ${actionMode === 'return' ? 'sb-btn--warn' : 'sb-btn--danger'}`}
                                onClick={() => performAction(actionMode, nextAction)}
                                disabled={acting}
                              >
                                {acting ? <Loader2 size={15} className="spin" /> : `Confirm ${actionMode === 'return' ? 'Return' : 'Reject'}`}
                              </button>
                            </div>
                          </>
                        ) : actionMode === 'conditional' ? (
                          <>
                            {actionError && <div className="sb-form-error"><AlertCircle size={14} /> {actionError}</div>}
                            <p className="sb-empty-note">
                              Forward this to the SDAO Supervisor now, but the outstanding task(s) above still need
                              completing by this deadline:
                            </p>
                            <label className="sb-field">
                              Task Deadline
                              <input type="date" value={conditionalDueDate} onChange={(e) => setConditionalDueDate(e.target.value)} required />
                            </label>
                            {assistantTurn && selected.type === 'event_application' && selected.is_continuing && (
                              <label className="sb-field">
                                Report Submission Date <span className="sb-optional">(this is a Year-Round/Term activity — assign when the report is due)</span>
                                <input
                                  type="date"
                                  value={reportSubmissionDate}
                                  onChange={(e) => setReportSubmissionDate(e.target.value)}
                                  required
                                />
                              </label>
                            )}
                            <div className="sb-review-actions__row">
                              <button className="sb-btn sb-btn--outline" onClick={() => setActionMode(null)} disabled={acting}>Cancel</button>
                              <button
                                className="sb-btn sb-btn--gold"
                                onClick={() => performConditionalApprove(nextAction)}
                                disabled={acting || (assistantTurn && selected.is_continuing && !reportSubmissionDate)}
                              >
                                {acting ? <Loader2 size={15} className="spin" /> : 'Confirm & Forward'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            {assistantTurn && selected.type === 'event_application' && selected.is_continuing && (
                              <>
                                {actionError && <div className="sb-form-error"><AlertCircle size={14} /> {actionError}</div>}
                                <label className="sb-field">
                                  Report Submission Date <span className="sb-optional">(this is a Year-Round/Term activity — assign when the report is due)</span>
                                  <input
                                    type="date"
                                    value={reportSubmissionDate}
                                    onChange={(e) => setReportSubmissionDate(e.target.value)}
                                    required
                                  />
                                </label>
                              </>
                            )}
                            <div className="sb-review-actions__row">
                              <button className="sb-btn sb-btn--warn-outline" onClick={() => setActionMode('return')}>
                                <Undo2 size={14} /> Return for Revision
                              </button>
                              <button className="sb-btn sb-btn--danger" onClick={() => setActionMode('reject')}>
                                <Ban size={14} /> Reject
                              </button>
                              {blocked ? (
                                <button className="sb-btn sb-btn--gold" onClick={() => setActionMode('conditional')}>
                                  <CalendarClock size={14} /> Conditional Approve
                                </button>
                              ) : (
                                <button
                                  className="sb-btn sb-btn--success"
                                  onClick={() => performAction('advance', nextAction)}
                                  disabled={acting || (assistantTurn && selected.is_continuing && !reportSubmissionDate)}
                                >
                                  {acting ? <Loader2 size={15} className="spin" /> : <><CheckCircle2 size={14} /> {nextAction.label}</>}
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })()}
                </div>

                {/* ---------- Right: file viewer ---------- */}
                <div className="sb-review__right">
                  <div className="sb-viewer">
                    {attachments.length > 0 && (
                      <div className="sb-viewer__tabs">
                        {attachments.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            className={`sb-viewer__tab ${a.id === viewerAttachmentId ? 'sb-viewer__tab--active' : ''}`}
                            onClick={() => setViewerAttachmentId(a.id)}
                          >
                            {a.document_type}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="sb-viewer__frame">
                      {activeAttachment ? (
                        isPreviewable(activeAttachment.file_url, activeAttachment.document_type) ? (
                          <iframe src={activeAttachment.file_url} title={activeAttachment.document_type} />
                        ) : (
                          <div className="sb-viewer__placeholder">
                            <FileText size={30} strokeWidth={1.4} />
                            <p>Preview isn't available for this file type.</p>
                            <a href={activeAttachment.file_url} target="_blank" rel="noreferrer" className="sb-btn sb-btn--outline sb-btn--sm">
                              <Download size={13} /> Open File
                            </a>
                          </div>
                        )
                      ) : (
                        <div className="sb-viewer__empty">
                          <span className="sb-viewer__watermark">FILE VIEWER</span>
                          <p>No attachments to preview yet.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function isPreviewable(url, docType) {
  if (!url) return false
  if (['Liquidation Report'].includes(docType)) return false
  const lower = url.toLowerCase().split('?')[0]
  if (/\.(xlsx|xls|doc|docx|ppt|pptx|zip|rar)$/.test(lower)) return false
  return true
}

function AttachmentRow({ label, entry, onChange, template, accept, formatHint }) {
  const mode = entry?.type === 'link' ? 'link' : 'file'

  function setMode(next) {
    if (next === mode) return
    onChange(next === 'link' ? { type: 'link', url: '' } : null)
  }

  return (
    <div className="sb-attach-row">
      <div className="sb-attach-row__top">
        <div className="sb-attach-row__label">
          <span>{label} <span className="sb-attach-row__hint">({formatHint})</span></span>
          {template && (
            <a href={template.file_url} target="_blank" rel="noreferrer" className="sb-attach-row__template">
              Get template
            </a>
          )}
        </div>
        <div className="sb-attach-row__mode-tabs">
          <button
            type="button"
            className={`sb-attach-row__mode-tab ${mode === 'file' ? 'sb-attach-row__mode-tab--active' : ''}`}
            onClick={() => setMode('file')}
          >
            Upload File
          </button>
          <button
            type="button"
            className={`sb-attach-row__mode-tab ${mode === 'link' ? 'sb-attach-row__mode-tab--active' : ''}`}
            onClick={() => setMode('link')}
          >
            Paste Link
          </button>
        </div>
      </div>

      {mode === 'file' ? (
        <label className="sb-attach-row__input">
          {entry?.name || 'Choose file'}
          <input type="file" accept={accept} onChange={(e) => onChange(e.target.files?.[0] || null)} hidden />
        </label>
      ) : (
        <input
          type="url"
          className="sb-attach-row__link-input"
          placeholder="https://drive.google.com/..."
          value={entry?.url || ''}
          onChange={(e) => onChange({ type: 'link', url: e.target.value })}
        />
      )}
    </div>
  )
}
