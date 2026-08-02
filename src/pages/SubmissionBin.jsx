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

const STEPS = [
  { key: 'submitted', label: 'SDAO Assistant' },
  { key: 'supervisor_endorsement', label: 'SDAO Supervisor' },
  { key: 'director_approval', label: 'Academic Director' },
  { key: 'approved', label: 'Approved' },
]

const REVIEWER_ROLES = ['sdao_assistant', 'sdao_supervisor', 'academic_director', 'system_admin']

function stepIndexFor(stage) {
  if (stage === 'assistant_review') return 0
  const i = STEPS.findIndex((s) => s.key === stage)
  return i === -1 ? 0 : i
}

function nextActionFor(role, stage) {
  const assistantTurn = stage === 'submitted' || stage === 'assistant_review'
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
        venue_id, event_date, start_time, end_time, medium, description,
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

  async function uploadAttachment(submissionId, docType, file) {
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
    if (!appFiles['ACP Form'] || !appFiles['Attachments Template']) {
      setFormError('Both the ACP Form and Attachments Template are required.')
      return
    }

    setSaving(true)
    const { data: sub, error: err } = await supabase.from('submissions').insert({
      type: 'event_application',
      org_id: myOrgId,
      title: appForm.title,
      contact_person: appForm.contact_person,
      contact_number: appForm.contact_number || null,
      venue_id: appForm.venue_id,
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
    if (REPORT_DOCS.some((d) => !reportFiles[d])) {
      setFormError('All four report documents are required.')
      return
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
        await supabase.from('assignments')
          .update({ status: 'submitted', submission_id: sub.id, updated_at: new Date().toISOString() })
          .eq('event_id', clearance.event_id)
          .eq('auto_generated', true)
          .in('status', ['pending', 'returned', 'conditional_approved'])
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
                <select value={appForm.venue_id} onChange={(e) => setAppForm({ ...appForm, venue_id: e.target.value })} required>
                  <option value="">Select venue</option>
                  {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
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
                  file={appFiles[doc]}
                  onChange={(f) => setAppFiles({ ...appFiles, [doc]: f })}
                  template={templateFor(doc)}
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
                      file={reportFiles[doc]}
                      onChange={(f) => setReportFiles({ ...reportFiles, [doc]: f })}
                      template={templateFor(doc)}
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
                {STEPS.map((step, i) => {
                  const current = stepIndexFor(selected.stage)
                  const state = i < current ? 'done' : i === current ? 'active' : 'pending'
                  return (
                    <div key={step.key} className={`sb-step sb-step--${state}`}>
                      <div className="sb-step__dot">{state === 'done' ? <Check size={11} /> : i + 1}</div>
                      <span className="sb-step__label">{step.label}</span>
                      {i < STEPS.length - 1 && <div className="sb-step__line" />}
                    </div>
                  )
                })}
              </div>
            )}

            {selected.type === 'event_application' && (
              <div className="sb-detail-grid">
                <div className="sb-detail-row"><MapPin size={13} /> {selected.venues?.name || '—'}</div>
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
              const nextAction = nextActionFor(profile.role, selected.stage)
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

function AttachmentRow({ label, file, onChange, template }) {
  return (
    <div className="sb-attach-row">
      <div className="sb-attach-row__label">
        <span>{label}</span>
        {template && (
          <a href={template.file_url} target="_blank" rel="noreferrer" className="sb-attach-row__template">
            Get template
          </a>
        )}
      </div>
      <label className="sb-attach-row__input">
        {file ? file.name : 'Choose file'}
        <input type="file" onChange={(e) => onChange(e.target.files?.[0] || null)} hidden />
      </label>
    </div>
  )
}
