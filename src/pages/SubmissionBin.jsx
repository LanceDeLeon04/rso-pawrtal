import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Inbox, Plus, X, Loader2, AlertCircle, FileText, ClipboardList,
  Check, Undo2, Ban, Download, MapPin, Clock, Video, Building2, User,
  CheckCircle2, ChevronRight, ListChecks, CalendarClock,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier } from '../context/AuthContext'
import { toISODate, formatTime, MEDIUM_LABELS } from '../lib/dateUtils'
import './SubmissionBin.css'

const EVENT_APP_DOCS = ['ACP Form', 'Attachments Template']
const REPORT_DOCS = ['PARF Template', 'Liquidation Report', 'Narrative Report', 'Evaluation Report']

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

function stepIndexFor(type, stage) {
  const steps = stepsFor(type)
  if (stage === 'assistant_review') return 0
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

const EMPTY_APP_FORM = {
  title: '', contact_person: '', contact_number: '', venue_id: '',
  venue_detail: '', pencil_booked: '', lab_endorsed: '',
  event_date: '', start_time: '', end_time: '', medium: 'f2f', description: '',
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
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState('')

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
        venue_id, venue_detail, venue_tag, pencil_booked, lab_endorsed,
        event_date, start_time, end_time, medium, description,
        stage, submitted_by, submitted_at,
        organizations ( name, acronym ),
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

  function openAppModal() {
    setAppForm(EMPTY_APP_FORM)
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

    if (!appForm.title || !appForm.contact_person || !appForm.venue_id || !appForm.event_date || !appForm.medium) {
      setFormError('Please fill in the event name, contact person, venue, date, and medium.')
      return
    }

    const selectedVenue = venues.find((v) => v.id === appForm.venue_id)
    const venueName = selectedVenue?.name
    const detailPrompt = VENUE_DETAIL_PROMPTS[venueName]
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
      venue_id: appForm.venue_id,
      venue_detail: detailPrompt ? appForm.venue_detail.trim() : null,
      venue_tag: venueTagFor(venueName),
      pencil_booked: appForm.pencil_booked === 'yes',
      lab_endorsed: venueName === 'Laboratory' ? appForm.lab_endorsed === 'yes' : null,
      event_date: appForm.event_date,
      start_time: appForm.start_time || null,
      end_time: appForm.end_time || null,
      medium: appForm.medium,
      description: appForm.description || null,
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

    try {
      for (const doc of EVENT_APP_DOCS) await uploadAttachment(sub.id, doc, appFiles[doc])
      await supabase.from('submission_status_history').insert({
        submission_id: sub.id, stage: 'submitted', action: 'submitted', actor_id: profile.id,
      })
    } catch {
      setFormError('Application saved, but a file failed to upload — reopen it from the list to re-attach.')
    }

    setSaving(false)
    setShowAppModal(false)
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

    try {
      for (const doc of REPORT_DOCS) await uploadAttachment(sub.id, doc, reportFiles[doc])
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
    } catch {
      setFormError('Report saved, but a file failed to upload — reopen it from the list to re-attach.')
    }

    setSaving(false)
    setShowReportModal(false)
    loadSubmissions()
  }

  async function openDetail(sub) {
    setSelected(sub)
    setActionMode(null)
    setActionComment('')
    setActionError('')
    setConditionalDueDate('')
    setDetailLoading(true)
    const [{ data: att }, { data: hist }, { data: tasks }] = await Promise.all([
      supabase.from('submission_attachments').select('*').eq('submission_id', sub.id),
      supabase.from('submission_status_history')
        .select('*, actor:profiles ( full_name )')
        .eq('submission_id', sub.id)
        .order('created_at', { ascending: true }),
      supabase.from('assignments')
        .select('id, title, status, due_date, assigned_to, assignee:profiles!assignments_assigned_to_fkey ( full_name )')
        .eq('submission_id', sub.id),
    ])
    setAttachments(att || [])
    setHistory(hist || [])
    setOpenTasks((tasks || []).filter((t) => t.status !== 'approved'))
    setDetailLoading(false)
  }

  async function performAction(kind, nextAction, overrideLabel) {
    if ((kind === 'return' || kind === 'reject') && !actionComment.trim()) {
      setActionError('Please provide a short reason.')
      return
    }
    setActing(true)
    setActionError('')

    const sub = selected
    const newStage = kind === 'return' ? 'returned' : kind === 'reject' ? 'rejected' : nextAction.to
    const actionLabel = overrideLabel || (kind === 'return' ? 'returned' : kind === 'reject' ? 'rejected' : nextAction.action)

    await supabase.from('submissions').update({ stage: newStage, updated_at: new Date().toISOString() }).eq('id', sub.id)
    await supabase.from('submission_status_history').insert({
      submission_id: sub.id, stage: newStage, action: actionLabel, actor_id: profile.id, comment: actionComment || null,
    })

    if (newStage === 'approved') {
      if (sub.type === 'event_application') {
        const { data: newEvent } = await supabase.from('events').insert({
          title: sub.title,
          org_id: sub.org_id,
          contact_person: sub.contact_person,
          contact_number: sub.contact_number,
          description: sub.description,
          venue_id: sub.venue_id,
          event_date: sub.event_date,
          start_time: sub.start_time,
          end_time: sub.end_time,
          medium: sub.medium,
          booking_status: 'reserved',
          submission_id: sub.id,
          created_by: profile.id,
        }).select().single()

        if (newEvent) {
          await supabase.from('submissions').update({ event_id: newEvent.id }).eq('id', sub.id)
          const deadline = new Date(sub.event_date)
          deadline.setDate(deadline.getDate() + 7)
          await supabase.from('clearances').insert({
            org_id: sub.org_id, event_id: newEvent.id, deadline: toISODate(deadline), status: 'pending',
          })
          await supabase.from('assignments').insert({
            title: `Post-Activity Report — ${sub.title}`,
            description: 'Submit the PARF, Liquidation, Narrative, and Evaluation reports for this activity.',
            event_id: newEvent.id,
            assigned_to: sub.submitted_by,
            assigned_by: profile.id,
            due_date: toISODate(deadline),
            status: 'pending',
            auto_generated: true,
          })
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
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => {
                const meta = STAGE_META[s.stage]
                return (
                  <tr key={s.id} onClick={() => openDetail(s)}>
                    <td className="sb-table__title">{s.title}</td>
                    <td>{s.type === 'event_application' ? 'Event Application' : 'Report'}</td>
                    {admin && <td>{s.organizations?.acronym}</td>}
                    <td><span className={`sb-badge sb-badge--${meta.tone}`}>{meta.label}</span></td>
                    <td>{s.submitted_at?.slice(0, 10)}</td>
                    <td><ChevronRight size={15} color="var(--muted)" /></td>
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
              <label className="sb-field">
                Medium
                <select value={appForm.medium} onChange={(e) => setAppForm({ ...appForm, medium: e.target.value })} required>
                  <option value="f2f">Face-to-Face</option>
                  <option value="online">Online</option>
                  <option value="off_campus">Off-Campus</option>
                </select>
              </label>
            </div>

            {appForm.venue_id && (() => {
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
                <input type="date" value={appForm.event_date} onChange={(e) => setAppForm({ ...appForm, event_date: e.target.value })} required />
              </label>
              <label className="sb-field">
                Start Time
                <input type="time" value={appForm.start_time} onChange={(e) => setAppForm({ ...appForm, start_time: e.target.value })} />
              </label>
              <label className="sb-field">
                End Time
                <input type="time" value={appForm.end_time} onChange={(e) => setAppForm({ ...appForm, end_time: e.target.value })} />
              </label>
            </div>

            <label className="sb-field">
              Description
              <textarea rows={2} value={appForm.description} onChange={(e) => setAppForm({ ...appForm, description: e.target.value })} />
            </label>

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

      {/* ---------- Detail / Status Tracker ---------- */}
      {selected && (
        <div className="sb-modal-backdrop" onClick={() => setSelected(null)}>
          <div className="sb-modal sb-modal--detail" onClick={(e) => e.stopPropagation()}>
            <button className="sb-modal__close" onClick={() => setSelected(null)}><X size={18} /></button>

            <span className="sb-type-tag">{selected.type === 'event_application' ? 'Event Application' : 'Activity Report'}</span>
            <h3 className="sb-modal__title">{selected.title}</h3>
            {admin && (
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
                  const current = stepIndexFor(selected.type, selected.stage)
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
                  {selected.venues?.name || '—'}
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

            <div className="sb-detail-section">
              <span className="sb-detail-section__label">Attachments</span>
              {detailLoading ? (
                <Loader2 size={15} className="spin" />
              ) : attachments.length === 0 ? (
                <p className="sb-empty-note">No attachments found.</p>
              ) : (
                <ul className="sb-attach-list">
                  {attachments.map((a) => (
                    <li key={a.id}>
                      <FileText size={13} />
                      <span>{a.document_type}</span>
                      <a href={a.file_url} target="_blank" rel="noreferrer"><Download size={13} /></a>
                    </li>
                  ))}
                </ul>
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
                          {h.actor?.full_name || 'Someone'} {h.action} this submission
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

            {canReview && !['approved', 'returned', 'rejected'].includes(selected.stage) && (() => {
              const nextAction = nextActionFor(profile.role, selected.stage, selected.type)
              if (!nextAction) return null

              const assistantTurn = ['sdao_assistant', 'system_admin'].includes(profile.role)
                && (selected.stage === 'submitted' || selected.stage === 'assistant_review')
              const blocked = assistantTurn && openTasks.length > 0

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
                      <div className="sb-review-actions__row">
                        <button className="sb-btn sb-btn--outline" onClick={() => setActionMode(null)} disabled={acting}>Cancel</button>
                        <button className="sb-btn sb-btn--gold" onClick={() => performConditionalApprove(nextAction)} disabled={acting}>
                          {acting ? <Loader2 size={15} className="spin" /> : 'Confirm & Forward'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="sb-review-actions__row">
                      <button className="sb-btn sb-btn--outline" onClick={() => setActionMode('return')}>
                        <Undo2 size={14} /> Return
                      </button>
                      <button className="sb-btn sb-btn--danger-outline" onClick={() => setActionMode('reject')}>
                        <Ban size={14} /> Reject
                      </button>
                      {blocked ? (
                        <button className="sb-btn sb-btn--gold" onClick={() => setActionMode('conditional')}>
                          <CalendarClock size={14} /> Conditional Approve
                        </button>
                      ) : (
                        <button className="sb-btn sb-btn--gold" onClick={() => performAction('advance', nextAction)} disabled={acting}>
                          {acting ? <Loader2 size={15} className="spin" /> : nextAction.label}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
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
