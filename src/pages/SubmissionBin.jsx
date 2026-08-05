import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Inbox, Plus, X, Loader2, AlertCircle, FileText, ClipboardList,
  Check, Undo2, Ban, Download, MapPin, Clock, Video, Building2, User,
  CheckCircle2, ChevronRight, ChevronLeft, ListChecks, CalendarClock, Trash2,
  Link2, Copy, Send, ShieldAlert, Hourglass,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier } from '../context/AuthContext'
import { toISODate, formatTime, MEDIUM_LABELS } from '../lib/dateUtils'
import { generateACPFormPdf } from '../lib/acpPdf'
import {
  approvalLinkUrl, generateApprovalLink, fetchApprovalLinks, externalApprovalState,
} from '../lib/approvalLinks'
import { ensureEventVerificationToken } from '../lib/eventVerification'
import { SDG_OPTIONS } from '../lib/sdgOptions'
import './SubmissionBin.css'

// 'ACP Form' used to be a manual upload — it's now auto-generated from
// the fields below and attached on submit, so it's no longer in this list.
const EVENT_APP_DOCS = ['Attachments Template']
const REPORT_DOCS = ['PARF Template', 'Liquidation Report', 'Narrative Report', 'Evaluation Report']

const ACTIVITY_TYPES = [
  { value: 'org_activity', label: 'Student Organization Activity' },
  { value: 'university_activity', label: 'University/School Activity' },
  { value: 'special_event', label: 'Special Event' },
  { value: 'other', label: 'Others' },
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
// Venues that need a free-text specific (room number / which lab / what).
const VENUE_DETAIL_PROMPTS = {
  Room: 'Identify room number',
  Laboratory: 'Identify which lab (e.g. ComLab)',
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
  if (type === 'event_application') {
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

const ROLE_LABELS = { adviser: 'Adviser', dean: 'Dean', sdg_rep: 'SDG Representative' }

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

const EMPTY_APP_FORM = {
  title: '', contact_person: '', contact_number: '', venue_id: '',
  venue_detail: '', pencil_booked: '', lab_endorsed: '',
  online_platform: '',
  event_date: '', start_time: '', end_time: '', medium: 'f2f', description: '',
  position: '', email: '', activity_type: '', activity_type_other: '',
  target_audience: '', target_participants: '', projected_budget: '', budget_source: '',
  learning_goal_1: '', learning_goal_2: '', learning_goal_3: '',
  is_continuing: false, continuing_type: 'year_round', term_label: '',
}

export default function SubmissionBin() {
  const { profile } = useAuth()
  const admin = isAdminTier(profile?.role)
  const canReview = REVIEWER_ROLES.includes(profile?.role)
  const myOrgId = profile?.org_memberships?.[0]?.org_id
  const location = useLocation()
  const navigate = useNavigate()

  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deletingSubmissionId, setDeletingSubmissionId] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [stageFilter, setStageFilter] = useState('all')
  const [venues, setVenues] = useState([])
  const [templates, setTemplates] = useState([])
  const [openClearances, setOpenClearances] = useState([])

  const [showAppModal, setShowAppModal] = useState(false)
  const [appForm, setAppForm] = useState(EMPTY_APP_FORM)
  const [appFiles, setAppFiles] = useState({})

  const [showReportModal, setShowReportModal] = useState(false)
  const [reportClearanceId, setReportClearanceId] = useState('')
  const [reportFiles, setReportFiles] = useState({})

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
  const [linkForm, setLinkForm] = useState({ adviser: { name: '', email: '' }, dean: { name: '', email: '' }, sdg_rep: { name: '', email: '' } })
  const [generatingLinkRole, setGeneratingLinkRole] = useState(null)
  const [linkError, setLinkError] = useState('')
  const [copiedRole, setCopiedRole] = useState(null)

  useEffect(() => {
    loadSubmissions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, stageFilter, profile?.id])

  useEffect(() => {
    async function loadStatics() {
      const [{ data: v }, { data: t }] = await Promise.all([
        supabase.from('venues').select('id, name').eq('is_active', true).order('name'),
        supabase.from('templates').select('id, name, category, file_url'),
      ])
      setVenues(v || [])
      setTemplates(t || [])
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
        event_date, start_time, end_time, medium, description,
        is_continuing, continuing_type, term_label, report_submission_date,
        sdgs, sdg_representative, sdg_marked_acp_generated,
        stage, submitted_by, submitted_at,
        organizations ( name, acronym, category ),
        venues ( name ),
        events ( title ),
        submitter:profiles!submissions_submitted_by_fkey ( full_name )
      `)
      .order('submitted_at', { ascending: false })

    if (!admin && myOrgId) q = q.eq('org_id', myOrgId)
    if (!admin && !myOrgId) q = q.eq('org_id', '00000000-0000-0000-0000-000000000000')
    if (typeFilter !== 'all') q = q.eq('type', typeFilter)
    if (stageFilter !== 'all') q = q.eq('stage', stageFilter)

    const { data, error } = await q
    setSubmissions(error ? [] : data || [])
    setLoading(false)
  }

  async function loadOpenClearances() {
    if (!myOrgId) return
    const { data } = await supabase
      .from('clearances')
      .select('id, event_id, deadline, status, events ( title, event_date )')
      .eq('org_id', myOrgId)
      .in('status', ['pending', 'overdue', 'extended'])
    setOpenClearances(data || [])
    return data || []
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
        : fullSub.venues?.name === 'Others' ? fullSub.venue_detail : [fullSub.venues?.name, fullSub.venue_detail].filter(Boolean).join(' — ')
      const timeRange = [fullSub.start_time && formatTime(fullSub.start_time), fullSub.end_time && formatTime(fullSub.end_time)].filter(Boolean).join(' – ')
      const activityTypeLabel = fullSub.activity_type === 'other'
        ? fullSub.activity_type_other
        : ACTIVITY_TYPES.find((t) => t.value === fullSub.activity_type)?.label
      const acpDateLabel = fullSub.is_continuing
        ? (fullSub.continuing_type === 'term' ? `Term ${(fullSub.term_label || '').trim()}` : 'Year-Round')
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

  function openAppModal() {
    const myMembership = profile?.org_memberships?.find((m) => m.org_id === myOrgId)
    setAppForm({ ...EMPTY_APP_FORM, position: myMembership?.position || '' })
    setAppFiles({})
    setFormError('')
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
    } else if (!appForm.venue_id) {
      setFormError('Please select the venue.')
      return
    }
    if (!appForm.is_continuing && !appForm.event_date) {
      setFormError('Please fill in the date.')
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

    const isOnline = appForm.medium === 'online'
    const selectedVenue = isOnline ? null : venues.find((v) => v.id === appForm.venue_id)
    const venueName = selectedVenue?.name
    const detailPrompt = VENUE_DETAIL_PROMPTS[venueName]
    if (!isOnline) {
      if (detailPrompt && !appForm.venue_detail.trim()) {
        setFormError(`Please ${detailPrompt.toLowerCase()}.`)
        return
      }
      if (!appForm.pencil_booked) {
        setFormError('Please confirm whether this has been pencil booked with INSPIRE or Facilities Office.')
        return
      }
      if (venueName === 'Laboratory' && !appForm.lab_endorsed) {
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
      venue_id: isOnline ? null : appForm.venue_id,
      venue_detail: isOnline
        ? (appForm.online_platform === 'others' ? appForm.venue_detail.trim() : null)
        : (detailPrompt ? appForm.venue_detail.trim() : null),
      venue_tag: isOnline ? null : venueTagFor(venueName),
      online_platform: isOnline ? appForm.online_platform : null,
      pencil_booked: isOnline ? null : appForm.pencil_booked === 'yes',
      lab_endorsed: !isOnline && venueName === 'Laboratory' ? appForm.lab_endorsed === 'yes' : null,
      event_date: appForm.is_continuing ? null : appForm.event_date,
      start_time: appForm.is_continuing ? null : (appForm.start_time || null),
      end_time: appForm.is_continuing ? null : (appForm.end_time || null),
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
      submitted_by: profile.id,
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
        event_date: sub.event_date || toISODate(new Date()),
        start_time: sub.start_time,
        end_time: sub.end_time,
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
        : selectedVenue?.name === 'Others' ? appForm.venue_detail : [selectedVenue?.name, appForm.venue_detail].filter(Boolean).join(' — ')
      const timeRange = [appForm.start_time && formatTime(appForm.start_time), appForm.end_time && formatTime(appForm.end_time)].filter(Boolean).join(' – ')
      const activityTypeLabel = appForm.activity_type === 'other'
        ? appForm.activity_type_other
        : ACTIVITY_TYPES.find((t) => t.value === appForm.activity_type)?.label
      const acpDateLabel = appForm.is_continuing
        ? (appForm.continuing_type === 'term' ? `Term ${appForm.term_label.trim()}` : 'Year-Round')
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
    setLinkForm({ adviser: { name: '', email: '' }, dean: { name: '', email: '' }, sdg_rep: { name: '', email: '' } })
    setLinkError('')
    setApprovalLinks([])
    setDetailLoading(true)
    if (sub.type === 'event_application') {
      const { data: links } = await fetchApprovalLinks(sub.id)
      setApprovalLinks(links)
      const sdgRepLink = links.find((l) => l.role === 'sdg_rep')
      if (sdgRepLink?.status === 'approved' && !sub.sdg_marked_acp_generated) {
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
          event_date: selected.event_date,
          start_time: selected.start_time,
          end_time: selected.end_time,
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
          event_date: reportSubmissionDate,
          start_time: selected.start_time,
          end_time: selected.end_time,
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
            event_date: calendarDate,
            start_time: sub.start_time,
            end_time: sub.end_time,
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
            event_date: calendarDate,
            start_time: sub.start_time,
            end_time: sub.end_time,
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
                  : fullSub.venues?.name === 'Others' ? fullSub.venue_detail : [fullSub.venues?.name, fullSub.venue_detail].filter(Boolean).join(' — ')
                const timeRange = [fullSub.start_time && formatTime(fullSub.start_time), fullSub.end_time && formatTime(fullSub.end_time)].filter(Boolean).join(' – ')
                const activityTypeLabel = fullSub.activity_type === 'other'
                  ? fullSub.activity_type_other
                  : ACTIVITY_TYPES.find((t) => t.value === fullSub.activity_type)?.label
                const acpDateLabel = fullSub.is_continuing
                  ? (fullSub.continuing_type === 'term' ? `Term ${(fullSub.term_label || '').trim()}` : 'Year-Round')
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

  return (
    <div className="sb-page">
      <div className="sb-toolbar">
        <div className="sb-toolbar__filters">
          <select className="sb-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            <option value="event_application">Event Applications</option>
            <option value="report">Reports</option>
          </select>
          <select className="sb-select" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="all">All stages</option>
            {Object.entries(STAGE_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        {!admin && (
          <div className="sb-toolbar__actions">
            <button className="sb-btn sb-btn--outline" onClick={() => openReportModal()}>
              <ClipboardList size={15} /> Submit Report
            </button>
            <button className="sb-btn sb-btn--gold" onClick={openAppModal}>
              <Plus size={15} /> New Application
            </button>
          </div>
        )}
      </div>

      <div className="sb-list-wrap">
        {listError && <div className="sb-form-error"><AlertCircle size={14} /> {listError}</div>}
        {loading ? (
          <div className="sb-loading"><Loader2 size={22} className="spin" /></div>
        ) : submissions.length === 0 ? (
          <div className="sb-empty">
            <Inbox size={26} strokeWidth={1.6} />
            <p>No submissions here yet.</p>
          </div>
        ) : (
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
              {submissions.map((s) => {
                const meta = STAGE_META[s.stage]
                const isConfirmingDelete = confirmDeleteId === s.id
                return (
                  <tr key={s.id} onClick={() => openDetail(s)}>
                    <td className="sb-table__title">{s.title}</td>
                    <td>{s.type === 'event_application' ? 'Event Application' : 'Report'}</td>
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
                    venue_id: '', venue_detail: '', pencil_booked: '', lab_endorsed: '',
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
              ) : (
                <label className="sb-field">
                  Venue
                  <select
                    value={appForm.venue_id}
                    onChange={(e) => setAppForm({ ...appForm, venue_id: e.target.value, venue_detail: '', pencil_booked: '', lab_endorsed: '' })}
                    required
                  >
                    <option value="">Select venue</option>
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name === 'Room' ? 'Room (identify room number)'
                          : v.name === 'Laboratory' ? 'Laboratory (identify which lab)'
                          : v.name === 'Others' ? 'Others (specify)'
                          : v.name}
                      </option>
                    ))}
                  </select>
                </label>
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

            {appForm.medium !== 'online' && appForm.venue_id && (() => {
              const selectedVenue = venues.find((v) => v.id === appForm.venue_id)
              const venueName = selectedVenue?.name
              const detailPrompt = VENUE_DETAIL_PROMPTS[venueName]
              const tag = venueTagFor(venueName)
              return (
                <div className="sb-venue-booking">
                  <div className="sb-form-notice">
                    <AlertCircle size={14} />
                    Ensure that you have pencil booked this with INSPIRE or Facilities Office before submitting.
                  </div>

                  {detailPrompt && (
                    <label className="sb-field">
                      {detailPrompt}
                      <input
                        value={appForm.venue_detail}
                        onChange={(e) => setAppForm({ ...appForm, venue_detail: e.target.value })}
                        placeholder={venueName === 'Room' ? 'e.g. Room 301' : venueName === 'Laboratory' ? 'e.g. ComLab (ITSO)' : 'e.g. Covered Court'}
                        required
                      />
                    </label>
                  )}

                  {tag && <div className="sb-venue-tag">Tagged as <strong>{tag}</strong></div>}

                  <label className="sb-field">
                    Pencil Booked?
                    <select value={appForm.pencil_booked} onChange={(e) => setAppForm({ ...appForm, pencil_booked: e.target.value })} required>
                      <option value="">Select</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>

                  {venueName === 'Laboratory' && (
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
              </label>
              <label className="sb-field">
                End Time
                <input type="time" value={appForm.is_continuing ? '' : appForm.end_time} onChange={(e) => setAppForm({ ...appForm, end_time: e.target.value })} disabled={appForm.is_continuing} />
              </label>
            </div>

            <div className="sb-field">
              <label className="sb-checkbox-label">
                <input
                  type="checkbox"
                  checked={appForm.is_continuing}
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

            <div className="sb-form-notice">
              <ShieldAlert size={14} />
              <span>
                Sustainable Development Goals aren't marked here — after your Adviser
                {' '}(and Dean, if applicable) approve, the SDG Representative reviews this
                application and marks which SDGs it counts toward. You'll see it reflected
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

            <button type="submit" className="sb-btn sb-btn--gold sb-btn--full" disabled={saving}>
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
                  <span className="sb-type-tag">{selected.type === 'event_application' ? 'Event Application Review' : 'Activity Report Review'}</span>
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
                        const chainComplete = selected.type === 'event_application'
                          ? externalApprovalState(approvalLinks, selected.organizations?.category).complete
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
                  {selected.type === 'event_application' && (selected.stage !== 'rejected' || approvalLinks.length > 0) && (() => {
                    const category = selected.organizations?.category
                    const state = externalApprovalState(approvalLinks, category)
                    const { chain } = state
                    const linkByRole = { adviser: state.adviser, dean: state.dean, sdg_rep: state.sdgRep }
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
                        <span className="sb-detail-section__label"><Link2 size={12} style={{ verticalAlign: -2 }} /> External Sign-off (Adviser → {state.needsDean ? 'Dean → ' : ''}SDG Representative)</span>
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
                        this {selected.type === 'event_application' ? 'application' : 'report'} for review.
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

                    const externalGate = assistantTurn && selected.type === 'event_application'
                      ? externalApprovalState(approvalLinks, selected.organizations?.category)
                      : null
                    if (externalGate && !externalGate.complete) {
                      const linkByRole = { adviser: externalGate.adviser, dean: externalGate.dean, sdg_rep: externalGate.sdgRep }
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
