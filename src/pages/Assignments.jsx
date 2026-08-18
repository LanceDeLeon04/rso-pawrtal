import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ClipboardList, Plus, X, Loader2, AlertCircle, Building2, User, Tag,
  CalendarClock, Undo2, CheckCircle2, Download, FileText, ArrowRight,
  Link2, Trash2, Check, ShieldAlert, RotateCcw, Paperclip,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier, isSHSReviewer } from '../context/AuthContext'
import { toISODate } from '../lib/dateUtils'
import './Assignments.css'

const STATUS_META = {
  pending: { label: 'Pending', tone: 'warn' },
  submitted: { label: 'Submitted', tone: 'blue' },
  returned: { label: 'Returned', tone: 'danger' },
  approved: { label: 'Approved', tone: 'ok' },
  conditional_approved: { label: 'Conditionally Approved', tone: 'muted' },
}

const EMPTY_FORM = {
  title: '', description: '', targetType: 'user', assigned_to: '',
  assigned_tag: '', assigned_tag_custom: false, assigned_org_id: '',
  submission_id: '', event_id: '', due_date: '',
}

export default function Assignments() {
  const { profile } = useAuth()
  // SDAO-SHS gets the same reviewer-side UI as College admins — RLS
  // (migration 052) already restricts which rows come back to SHS-only,
  // so "admin" here just means "reviewer view" rather than "org's own view".
  const admin = isAdminTier(profile?.role) || isSHSReviewer(profile?.role)
  const shsReviewer = isSHSReviewer(profile?.role)
  // SDAO-SHS can create assignments too, scoped to SHS Faculty/RSO
  // targets only (enforced both here — no cross-org "Tagged Group"
  // option, org picker limited to SHS orgs — and at the RLS level,
  // migration 061).
  const canManage = ['sdao_assistant', 'sdao_supervisor', 'academic_director', 'system_admin', 'sdao_shs'].includes(profile?.role)
  const navigate = useNavigate()

  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [orgFilter, setOrgFilter] = useState('all')
  const [targetTypeFilter, setTargetTypeFilter] = useState('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [search, setSearch] = useState('')

  const [people, setPeople] = useState([])
  const [orgs, setOrgs] = useState([])
  const [positions, setPositions] = useState([])
  const [pendingSubmissions, setPendingSubmissions] = useState([])
  const [events, setEvents] = useState([])
  const [profileOrgMap, setProfileOrgMap] = useState({}) // profile_id -> Set(org_id)
  const [tagOrgMap, setTagOrgMap] = useState({}) // position -> Set(org_id)

  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [selected, setSelected] = useState(null)
  const [deliverables, setDeliverables] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [deliverableEntry, setDeliverableEntry] = useState(null) // File | { type: 'link', url }
  const [deliverableNote, setDeliverableNote] = useState('')
  const [submittingDeliverable, setSubmittingDeliverable] = useState(false)
  const [deliverableError, setDeliverableError] = useState('')
  const [undoing, setUndoing] = useState(false)
  const [reviewMode, setReviewMode] = useState(null)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [clearanceInfo, setClearanceInfo] = useState([])

  useEffect(() => {
    loadAssignments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, profile?.id])

  useEffect(() => {
    if (!canManage) return
    async function loadStatics() {
      const [{ data: p }, { data: m }, { data: s }, { data: e }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role').order('full_name'),
        supabase.from('org_memberships').select('position'),
        supabase.from('submissions')
          .select('id, title, organizations ( acronym )')
          .in('stage', ['submitted', 'assistant_review']),
        supabase.from('events').select('id, title, event_date').order('event_date', { ascending: false }).limit(50),
      ])
      setPeople(p || [])
      setPositions([...new Set((m || []).map((r) => r.position).filter(Boolean))].sort())
      setPendingSubmissions(s || [])
      setEvents(e || [])
    }
    loadStatics()
  }, [canManage])

  // Org list + org lookup maps are needed for the org filter for any
  // admin-tier viewer, not just those who can create assignments — a
  // CRSO Chairperson or QMO reviewing this page still needs to be able
  // to narrow the list down to a single org.
  useEffect(() => {
    if (!admin) return
    async function loadOrgFilterData() {
      const [{ data: o }, { data: m }] = await Promise.all([
        supabase.from('organizations').select('id, acronym, department').eq('is_active', true).order('acronym'),
        supabase.from('org_memberships').select('profile_id, org_id, position'),
      ])
      // organizations has no RLS restriction (every role can browse it
      // for dropdowns), so SDAO-SHS needs an explicit department filter
      // here, same as Dashboard/AnalyticsSection — otherwise the org
      // filter and the "Whole Org" assignment target would both list
      // College orgs too.
      setOrgs(shsReviewer ? (o || []).filter((org) => org.department === 'shs') : (o || []))
      const pMap = {}
      const tMap = {}
      ;(m || []).forEach((row) => {
        if (!pMap[row.profile_id]) pMap[row.profile_id] = new Set()
        pMap[row.profile_id].add(row.org_id)
        if (!tMap[row.position]) tMap[row.position] = new Set()
        tMap[row.position].add(row.org_id)
      })
      setProfileOrgMap(pMap)
      setTagOrgMap(tMap)
    }
    loadOrgFilterData()
  }, [admin, shsReviewer])

  async function loadAssignments() {
    if (!profile) return
    setLoading(true)
    setError('')
    let q = supabase
      .from('assignments')
      .select(`
        id, title, description, submission_id, event_id, assigned_to, assigned_tag,
        assigned_org_id, due_date, status, review_comment, auto_generated, created_at,
        assignee:profiles!assignments_assigned_to_fkey ( full_name ),
        org:organizations!assignments_assigned_org_id_fkey ( acronym ),
        submissions ( title, org_id, organizations ( acronym ) ),
        events ( title, event_date, org_id )
      `)
      .order('created_at', { ascending: false })

    if (statusFilter !== 'all') q = q.eq('status', statusFilter)

    const { data, error: err } = await q
    if (err) {
      setError('Could not load assignments. Please try again.')
      setAssignments([])
    } else {
      setAssignments(data || [])
      if (admin) reconcileClearanceIssues(data || [])
    }
    setLoading(false)
  }

  // A non-event assignment (no event_id) that's past its due_date turns
  // into a clearance issue for the org(s) it targets — same blocking
  // effect on new event applications as an unresolved activity report.
  // There's no server cron, so (like Clearance.jsx's overdue self-heal)
  // this reconciles on page load. Gated to admin-tier because resolving
  // "which orgs does this tag/user belong to" needs cross-org visibility
  // that RLS only grants admins.
  async function reconcileClearanceIssues(list) {
    const today = toISODate(new Date())
    const overdue = (list || []).filter(
      (a) =>
        !a.event_id &&
        a.due_date &&
        a.due_date < today &&
        ['pending', 'returned', 'conditional_approved'].includes(a.status)
    )
    if (overdue.length === 0) return

    for (const a of overdue) {
      let orgIds = []
      if (a.assigned_org_id) {
        orgIds = [a.assigned_org_id]
      } else if (a.assigned_to) {
        const { data: m } = await supabase.from('org_memberships').select('org_id').eq('profile_id', a.assigned_to)
        orgIds = (m || []).map((r) => r.org_id)
      } else if (a.assigned_tag) {
        const { data: m } = await supabase.from('org_memberships').select('org_id').eq('position', a.assigned_tag)
        orgIds = (m || []).map((r) => r.org_id)
      }
      if (orgIds.length === 0) continue

      const { data: existing } = await supabase.from('clearances').select('org_id').eq('assignment_id', a.id)
      const existingOrgIds = new Set((existing || []).map((c) => c.org_id))
      const toCreate = [...new Set(orgIds)].filter((id) => !existingOrgIds.has(id))
      if (toCreate.length === 0) continue

      await Promise.all(
        toCreate.map((orgId) =>
          supabase.from('clearances').insert({
            org_id: orgId,
            assignment_id: a.id,
            status: 'overdue',
            deadline: a.due_date,
            reason: `Overdue task: ${a.title}`,
          })
        )
      )
    }
  }

  function targetLabel(a) {
    if (a.assignee?.full_name) return { icon: User, text: a.assignee.full_name }
    if (a.assigned_tag) return { icon: Tag, text: `All ${a.assigned_tag}s` }
    if (a.org?.acronym) return { icon: Building2, text: a.org.acronym }
    return { icon: User, text: '—' }
  }

  function isMyAssignment(a) {
    if (a.assigned_to === profile.id) return true
    if (a.assigned_org_id && profile.org_memberships?.some((m) => m.org_id === a.assigned_org_id)) return true
    if (a.assigned_tag && profile.org_memberships?.some((m) => m.position === a.assigned_tag)) return true
    return false
  }

  // The auto-generated "Generate Evaluation form for: ..." task is
  // assigned_to ONE specific SDAO Supervisor/Assistant (whoever
  // existed at approval time), but any SDAO Assistant, Supervisor, or
  // Admin should be able to pick it up and fill it in — not just that
  // one person. Detected by title since these tasks share the same
  // auto_generated + event_id shape as the Post-Activity Report task
  // (see canActOnAssignment below).
  function isEvaluationFormTask(a) {
    return !!a?.auto_generated && !!a?.title?.startsWith('Generate Evaluation form for:')
  }

  function canActOnAssignment(a) {
    return isMyAssignment(a) || (canManage && isEvaluationFormTask(a))
  }

  function openNewModal() {
    setForm(EMPTY_FORM)
    setFormError('')
    setShowModal(true)
  }

  async function handleCreate(e) {
    e.preventDefault()
    setFormError('')

    if (!form.title) {
      setFormError('Please give the task a title.')
      return
    }
    if (form.targetType === 'user' && !form.assigned_to) {
      setFormError('Please select who this is assigned to.')
      return
    }
    if (form.targetType === 'tag' && !form.assigned_tag) {
      setFormError('Please enter a position tag, e.g. Treasurer.')
      return
    }
    if (form.targetType === 'org' && !form.assigned_org_id) {
      setFormError('Please select an organization.')
      return
    }

    setSaving(true)
    const { error: err } = await supabase.from('assignments').insert({
      title: form.title,
      description: form.description || null,
      submission_id: form.submission_id || null,
      event_id: form.event_id || null,
      assigned_to: form.targetType === 'user' ? form.assigned_to : null,
      assigned_tag: form.targetType === 'tag' ? form.assigned_tag : null,
      assigned_org_id: form.targetType === 'org' ? form.assigned_org_id : null,
      assigned_by: profile.id,
      due_date: form.due_date || null,
    })
    setSaving(false)

    if (err) {
      setFormError('Could not create the assignment. Please try again.')
      return
    }

    setShowModal(false)
    loadAssignments()
  }

  async function openDetail(a) {
    setSelected(a)
    setDeliverableEntry(null)
    setDeliverableNote('')
    setDeliverableError('')
    setReviewMode(null)
    setReviewComment('')
    setReviewError('')
    setClearanceInfo([])
    setDetailLoading(true)
    const [{ data }, { data: clr }] = await Promise.all([
      supabase
        .from('assignment_deliverables')
        .select('*, uploader:profiles ( full_name )')
        .eq('assignment_id', a.id)
        .order('uploaded_at', { ascending: true }),
      admin
        ? supabase.from('clearances').select('id, org_id, status, deadline, reason, organizations ( acronym )').eq('assignment_id', a.id)
        : Promise.resolve({ data: [] }),
    ])
    setDeliverables(data || [])
    setClearanceInfo(clr || [])
    setDetailLoading(false)
  }

  async function handleDelete(assignmentId) {
    setError('')
    setDeletingId(assignmentId)
    const { error: err } = await supabase.from('assignments').delete().eq('id', assignmentId)
    setDeletingId(null)
    setConfirmDeleteId(null)
    if (err) {
      setError('Could not delete this record. Please try again.')
      return
    }
    if (selected?.id === assignmentId) setSelected(null)
    loadAssignments()
  }

  function goSubmitReport() {
    navigate('/submissions', { state: { autoOpenReportForEventId: selected.event_id } })
  }

  async function handleSubmitDeliverable(e) {
    e.preventDefault()
    setDeliverableError('')
    if (!deliverableEntry) {
      setDeliverableError('Attach a file or paste a link before turning this in.')
      return
    }
    setSubmittingDeliverable(true)

    if (deliverableEntry.type === 'link') {
      const url = (deliverableEntry.url || '').trim()
      if (!/^https?:\/\/\S+$/i.test(url)) {
        setSubmittingDeliverable(false)
        setDeliverableError('That link doesn\'t look valid — it should start with http:// or https://')
        return
      }
      const { error: insErr } = await supabase.from('assignment_deliverables').insert({
        assignment_id: selected.id,
        file_url: url,
        note: deliverableNote || null,
        uploaded_by: profile.id,
      })
      if (insErr) {
        setSubmittingDeliverable(false)
        setDeliverableError(`Could not save the link: ${insErr.message}`)
        return
      }
    } else {
      const file = deliverableEntry
      const ext = file.name.split('.').pop()
      const path = `${selected.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error: upErr } = await supabase.storage.from('assignment-deliverables').upload(path, file)
      if (upErr) {
        setSubmittingDeliverable(false)
        setDeliverableError(`Upload failed: ${upErr.message}. Ask a system admin to confirm the "assignment-deliverables" storage bucket exists.`)
        return
      }
      const { data: signed, error: signErr } = await supabase.storage
        .from('assignment-deliverables')
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 5)

      const { error: insErr } = await supabase.from('assignment_deliverables').insert({
        assignment_id: selected.id,
        file_url: signed?.signedUrl || path,
        note: deliverableNote || null,
        uploaded_by: profile.id,
      })
      if (signErr) console.warn('Could not sign deliverable URL, stored raw path instead:', signErr)
      if (insErr) {
        setSubmittingDeliverable(false)
        setDeliverableError(`Uploaded, but could not record the deliverable: ${insErr.message}`)
        return
      }
    }

    const { error: statusErr } = await supabase.from('assignments')
      .update({ status: 'submitted', updated_at: new Date().toISOString() })
      .eq('id', selected.id)

    setSubmittingDeliverable(false)
    if (statusErr) {
      setDeliverableError(`Deliverable saved, but the status update failed: ${statusErr.message}`)
      // Refresh the deliverables list in place instead of closing, so the
      // person can see their file went through even though status is stale.
      const { data } = await supabase
        .from('assignment_deliverables')
        .select('*, uploader:profiles ( full_name )')
        .eq('assignment_id', selected.id)
        .order('uploaded_at', { ascending: true })
      setDeliverables(data || [])
      setDeliverableEntry(null)
      setDeliverableNote('')
      return
    }

    setSelected(null)
    loadAssignments()
  }

  // MS Teams-style "Undo turn in": while a submission is still awaiting
  // review, the assignee can pull it back to Pending to attach more
  // files or fix a mistake, without needing the reviewer to Return it.
  async function handleUndoTurnIn() {
    setUndoing(true)
    setDeliverableError('')
    const { error: err } = await supabase.from('assignments')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', selected.id)
    setUndoing(false)
    if (err) {
      setDeliverableError(`Could not undo turn-in: ${err.message}`)
      return
    }
    setSelected((s) => (s ? { ...s, status: 'pending' } : s))
    loadAssignments()
  }

  async function handleReview(kind) {
    setReviewError('')
    if (kind === 'return' && !reviewComment.trim()) {
      setReviewError('Please provide a short reason.')
      return
    }
    setReviewing(true)
    const { error: updErr } = await supabase.from('assignments').update({
      status: kind === 'approve' ? 'approved' : 'returned',
      review_comment: reviewComment || null,
      updated_at: new Date().toISOString(),
    }).eq('id', selected.id)

    if (updErr) {
      setReviewing(false)
      setReviewError(`Could not ${kind === 'approve' ? 'approve' : 'return'} this task: ${updErr.message}`)
      return
    }

    if (kind === 'approve') {
      // Clear any clearance issue this overdue, non-event assignment opened.
      const { error: clrErr } = await supabase.from('clearances')
        .update({ status: 'cleared', cleared_by: profile.id, cleared_at: new Date().toISOString() })
        .eq('assignment_id', selected.id)
        .neq('status', 'cleared')
      if (clrErr) console.warn('Assignment approved, but clearing linked clearance issue failed:', clrErr)
    }

    setReviewing(false)
    setSelected(null)
    loadAssignments()
  }

  function matchesOrg(a, orgId) {
    if (orgId === 'all') return true
    if (a.assigned_org_id === orgId) return true
    if (a.assigned_to && profileOrgMap[a.assigned_to]?.has(orgId)) return true
    if (a.assigned_tag && tagOrgMap[a.assigned_tag]?.has(orgId)) return true
    if (a.submissions?.org_id === orgId) return true
    if (a.events?.org_id === orgId) return true
    return false
  }

  function isOverdueTask(a) {
    return (
      !a.event_id &&
      a.due_date &&
      a.due_date < toISODate(new Date()) &&
      ['pending', 'returned', 'conditional_approved'].includes(a.status)
    )
  }

  const baseList = admin ? assignments : assignments.filter(isMyAssignment)
  const list = baseList.filter((a) => {
    if (admin && orgFilter !== 'all' && !matchesOrg(a, orgFilter)) return false
    if (admin && targetTypeFilter !== 'all') {
      const kind = a.assigned_to ? 'user' : a.assigned_tag ? 'tag' : a.assigned_org_id ? 'org' : null
      if (kind !== targetTypeFilter) return false
    }
    if (admin && overdueOnly && !isOverdueTask(a)) return false
    if (admin && search.trim()) {
      const q = search.trim().toLowerCase()
      const hay = [a.title, a.description, a.assignee?.full_name, a.org?.acronym, a.assigned_tag]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  return (
    <div className="asg-page">
      <div className="asg-toolbar">
        <div>
          <h2 className="asg-toolbar__title"><ClipboardList size={17} color="var(--nu-blue-700)" /> Assignments</h2>
          <p className="asg-toolbar__sub">
            {admin ? 'Tasks routed to reviewers, orgs, and tagged positions.' : 'Tasks and reports assigned to you or your org.'}
          </p>
        </div>
        <div className="asg-toolbar__actions">
          <select className="asg-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {admin && (
            <>
              <select className="asg-select" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
                <option value="all">All organizations</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.acronym}</option>)}
              </select>
              <select className="asg-select" value={targetTypeFilter} onChange={(e) => setTargetTypeFilter(e.target.value)}>
                <option value="all">All target types</option>
                <option value="user">Specific User</option>
                <option value="tag">Tagged Group</option>
                <option value="org">Whole Org</option>
              </select>
              <label className="asg-checkbox-filter">
                <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
                Overdue / clearance issue
              </label>
              <input
                className="asg-select asg-search-input"
                type="text"
                placeholder="Search title, assignee, org…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </>
          )}
          {canManage && (
            <button className="asg-btn asg-btn--gold" onClick={openNewModal}>
              <Plus size={15} /> New Assignment
            </button>
          )}
        </div>
      </div>

      {error && <div className="asg-error"><AlertCircle size={15} /> {error}</div>}

      <div className="asg-list-wrap">
        {loading ? (
          <div className="asg-loading"><Loader2 size={22} className="spin" /></div>
        ) : list.length === 0 ? (
          <div className="asg-empty">
            <ClipboardList size={26} strokeWidth={1.6} />
            <p>No assignments here yet.</p>
          </div>
        ) : (
          <div className="table-scroll">
          <table className="asg-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Assigned To</th>
                <th>Linked</th>
                <th>Due</th>
                <th>Status</th>
                <th />
                {admin && <th />}
              </tr>
            </thead>
            <tbody>
              {list.map((a) => {
                const meta = STATUS_META[a.status]
                const t = targetLabel(a)
                const TIcon = t.icon
                const isOverdueTask =
                  !a.event_id &&
                  a.due_date &&
                  a.due_date < toISODate(new Date()) &&
                  ['pending', 'returned', 'conditional_approved'].includes(a.status)
                const isConfirmingDelete = confirmDeleteId === a.id
                return (
                  <tr key={a.id} onClick={() => openDetail(a)}>
                    <td className="asg-table__title">
                      {a.title}
                      {a.auto_generated && <span className="asg-auto-tag">auto</span>}
                    </td>
                    <td><span className="asg-target"><TIcon size={13} /> {t.text}</span></td>
                    <td>
                      {a.submissions?.title && <span className="asg-link-chip"><Link2 size={11} /> {a.submissions.title}</span>}
                      {a.events?.title && <span className="asg-link-chip"><Link2 size={11} /> {a.events.title}</span>}
                      {!a.submissions?.title && !a.events?.title && '—'}
                    </td>
                    <td>
                      {a.due_date || '—'}
                      {isOverdueTask && <span className="asg-badge asg-badge--danger asg-overdue-tag">overdue · clearance issue</span>}
                    </td>
                    <td><span className={`asg-badge asg-badge--${meta.tone}`}>{meta.label}</span></td>
                    <td><ArrowRight size={14} color="var(--muted)" /></td>
                    {admin && (
                      <td onClick={(e) => e.stopPropagation()}>
                        {isConfirmingDelete ? (
                          <div className="asg-row-actions">
                            <button
                              className="asg-icon-btn"
                              onClick={() => handleDelete(a.id)}
                              disabled={deletingId === a.id}
                              title="Confirm delete"
                            >
                              {deletingId === a.id ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                            </button>
                            <button className="asg-icon-btn" onClick={() => setConfirmDeleteId(null)} title="Cancel">
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <button className="asg-icon-btn" onClick={() => setConfirmDeleteId(a.id)} title="Delete record">
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

      {showModal && (
        <div className="asg-modal-backdrop" onClick={() => setShowModal(false)}>
          <form className="asg-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleCreate}>
            <button type="button" className="asg-modal__close" onClick={() => setShowModal(false)}><X size={18} /></button>
            <h3 className="asg-modal__title">New Assignment</h3>

            {formError && <div className="asg-form-error"><AlertCircle size={14} /> {formError}</div>}

            <label className="asg-field">
              Title
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </label>

            <label className="asg-field">
              Description
              <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>

            <div className="asg-target-tabs">
              {(shsReviewer ? ['user', 'org'] : ['user', 'tag', 'org']).map((t) => (
                <button
                  type="button"
                  key={t}
                  className={`asg-target-tab ${form.targetType === t ? 'asg-target-tab--active' : ''}`}
                  onClick={() => setForm({ ...form, targetType: t })}
                >
                  {t === 'user' ? 'Specific User' : t === 'tag' ? 'Tagged Group' : 'Whole Org'}
                </button>
              ))}
            </div>

            {form.targetType === 'user' && (
              <label className="asg-field">
                User
                <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} required>
                  <option value="">Select person</option>
                  {shsReviewer ? (
                    <>
                      <optgroup label="SHS Faculty">
                        {people.filter((p) => p.role === 'shs_faculty').map((p) => (
                          <option key={p.id} value={p.id}>{p.full_name}</option>
                        ))}
                      </optgroup>
                      <optgroup label="RSO Officers">
                        {people.filter((p) => p.role !== 'shs_faculty').map((p) => (
                          <option key={p.id} value={p.id}>{p.full_name} ({p.role.replace('_', ' ')})</option>
                        ))}
                      </optgroup>
                    </>
                  ) : (
                    people.map((p) => <option key={p.id} value={p.id}>{p.full_name} ({p.role.replace('_', ' ')})</option>)
                  )}
                </select>
                {shsReviewer && <span className="asg-hint">Includes SHS Faculty and officers of any SHS-department org.</span>}
              </label>
            )}

            {form.targetType === 'tag' && (
              <label className="asg-field">
                Position Tag
                {form.assigned_tag_custom || positions.length === 0 ? (
                  <input
                    placeholder="e.g. Treasurer"
                    value={form.assigned_tag}
                    onChange={(e) => setForm({ ...form, assigned_tag: e.target.value })}
                    required
                  />
                ) : (
                  <select
                    value={form.assigned_tag}
                    onChange={(e) => setForm({ ...form, assigned_tag: e.target.value })}
                    required
                  >
                    <option value="">Select a position</option>
                    {positions.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
                {positions.length > 0 && (
                  <button
                    type="button"
                    className="asg-inline-toggle"
                    onClick={() => setForm({ ...form, assigned_tag_custom: !form.assigned_tag_custom, assigned_tag: '' })}
                  >
                    {form.assigned_tag_custom ? 'Choose from existing positions instead' : "Position not listed? Type it manually"}
                  </button>
                )}
                <span className="asg-hint">Reaches everyone holding this position, across all orgs.</span>
              </label>
            )}

            {form.targetType === 'org' && (
              <label className="asg-field">
                Organization
                <select value={form.assigned_org_id} onChange={(e) => setForm({ ...form, assigned_org_id: e.target.value })} required>
                  <option value="">Select organization</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.acronym}</option>)}
                </select>
              </label>
            )}

            <div className="asg-field-row">
              <label className="asg-field">
                Link to Submission <span className="asg-optional">(optional)</span>
                <select value={form.submission_id} onChange={(e) => setForm({ ...form, submission_id: e.target.value })}>
                  <option value="">None</option>
                  {pendingSubmissions.map((s) => (
                    <option key={s.id} value={s.id}>{s.organizations?.acronym} — {s.title}</option>
                  ))}
                </select>
              </label>
              <label className="asg-field">
                Link to Event <span className="asg-optional">(optional)</span>
                <select value={form.event_id} onChange={(e) => setForm({ ...form, event_id: e.target.value })}>
                  <option value="">None</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>{ev.title} — {ev.event_date}</option>
                  ))}
                </select>
              </label>
            </div>

            {form.submission_id && (
              <p className="asg-hint">
                This task blocks the SDAO Assistant from forwarding that submission until it's approved — or the
                Assistant can Conditionally Approve with a new deadline.
              </p>
            )}

            <label className="asg-field">
              Due Date
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </label>

            <button type="submit" className="asg-btn asg-btn--gold asg-btn--full" disabled={saving}>
              {saving ? <Loader2 size={15} className="spin" /> : 'Create Assignment'}
            </button>
          </form>
        </div>
      )}

      {selected && (
        <div className="asg-modal-backdrop" onClick={() => setSelected(null)}>
          <div className="asg-modal asg-modal--detail" onClick={(e) => e.stopPropagation()}>
            <button className="asg-modal__close" onClick={() => setSelected(null)}><X size={18} /></button>

            <span className={`asg-badge asg-badge--${STATUS_META[selected.status].tone}`}>{STATUS_META[selected.status].label}</span>
            <h3 className="asg-modal__title">{selected.title}</h3>
            {selected.description && <p className="asg-modal__desc">{selected.description}</p>}

            <div className="asg-detail-grid">
              <div className="asg-detail-row"><User size={13} /> {targetLabel(selected).text}</div>
              {selected.due_date && <div className="asg-detail-row"><CalendarClock size={13} /> Due {selected.due_date}</div>}
              {selected.submissions?.title && <div className="asg-detail-row"><Link2 size={13} /> {selected.submissions.title}</div>}
              {selected.events?.title && <div className="asg-detail-row"><Link2 size={13} /> {selected.events.title} — {selected.events.event_date}</div>}
            </div>

            {selected.review_comment && (
              <div className="asg-review-note">"{selected.review_comment}"</div>
            )}

            {admin && clearanceInfo.length > 0 && (
              <div className="asg-clearance-note">
                <ShieldAlert size={14} />
                <div>
                  <strong>Clearance issue attached.</strong>{' '}
                  {clearanceInfo.map((c) => (
                    <span key={c.id} className="asg-clearance-chip">
                      {c.organizations?.acronym || 'Org'} — {c.status}
                      {c.deadline && ` (was due ${c.deadline})`}
                    </span>
                  ))}
                  <button type="button" className="asg-inline-toggle" onClick={() => navigate('/clearance')}>
                    View in Clearance <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            )}

            <div className="asg-detail-section">
              <span className="asg-detail-section__label">Deliverables</span>
              {detailLoading ? (
                <Loader2 size={15} className="spin" />
              ) : deliverables.length === 0 ? (
                <p className="asg-empty-note">Nothing submitted yet.</p>
              ) : (
                <ul className="asg-deliverable-list">
                  {deliverables.map((d) => (
                    <li key={d.id}>
                      <FileText size={13} />
                      <span>{d.note || 'Deliverable'} — {d.uploader?.full_name}</span>
                      <a href={d.file_url} target="_blank" rel="noreferrer"><Download size={13} /></a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {isMyAssignment(selected) && selected.status === 'submitted' && !selected.auto_generated && (
              <div className="asg-undo-row">
                <p className="asg-hint">Turned in. You can still fix or add something before it's reviewed.</p>
                <button type="button" className="asg-btn asg-btn--outline" onClick={handleUndoTurnIn} disabled={undoing}>
                  {undoing ? <Loader2 size={15} className="spin" /> : <><RotateCcw size={14} /> Undo Turn-in</>}
                </button>
                {deliverableError && <div className="asg-form-error"><AlertCircle size={14} /> {deliverableError}</div>}
              </div>
            )}

            {canActOnAssignment(selected) && ['pending', 'returned', 'conditional_approved'].includes(selected.status) && (
              selected.auto_generated && selected.event_id && !isEvaluationFormTask(selected) ? (
                <button className="asg-btn asg-btn--gold asg-btn--full" onClick={goSubmitReport}>
                  <ArrowRight size={15} /> Go to Report Submission
                </button>
              ) : (
                <form className="asg-deliverable-form" onSubmit={handleSubmitDeliverable}>
                  {isEvaluationFormTask(selected) && (
                    <p className="asg-hint">
                      Upload the QR code image as the file, and paste the Evaluation Form link in the note field below.
                    </p>
                  )}
                  {deliverableError && <div className="asg-form-error"><AlertCircle size={14} /> {deliverableError}</div>}
                  <div className="asg-target-tabs">
                    <button
                      type="button"
                      className={`asg-target-tab ${deliverableEntry?.type !== 'link' ? 'asg-target-tab--active' : ''}`}
                      onClick={() => { setDeliverableEntry(null); setDeliverableError('') }}
                    >
                      <Paperclip size={13} /> Upload File
                    </button>
                    <button
                      type="button"
                      className={`asg-target-tab ${deliverableEntry?.type === 'link' ? 'asg-target-tab--active' : ''}`}
                      onClick={() => { setDeliverableEntry({ type: 'link', url: '' }); setDeliverableError('') }}
                    >
                      <Link2 size={13} /> Paste Link
                    </button>
                  </div>

                  {deliverableEntry?.type === 'link' ? (
                    <label className="asg-field">
                      Link
                      <input
                        type="url"
                        placeholder="https://drive.google.com/..."
                        value={deliverableEntry.url}
                        onChange={(e) => setDeliverableEntry({ type: 'link', url: e.target.value })}
                        required
                      />
                    </label>
                  ) : (
                    <label className="asg-field">
                      File <span className="asg-optional">{isEvaluationFormTask(selected) ? '(QR code image)' : '(PDF or Excel)'}</span>
                      <input
                        type="file"
                        accept={isEvaluationFormTask(selected) ? '.png,.jpg,.jpeg' : '.pdf,.xlsx,.xls'}
                        onChange={(e) => setDeliverableEntry(e.target.files?.[0] || null)}
                        required
                      />
                    </label>
                  )}

                  <label className="asg-field">
                    Note
                    <input value={deliverableNote} onChange={(e) => setDeliverableNote(e.target.value)} placeholder="Optional note" />
                  </label>
                  <button type="submit" className="asg-btn asg-btn--gold asg-btn--full" disabled={submittingDeliverable}>
                    {submittingDeliverable ? <Loader2 size={15} className="spin" /> : 'Submit Deliverable'}
                  </button>
                </form>
              )
            )}

            {canManage && selected.status === 'submitted' && (
              <div className="asg-review-actions">
                {reviewMode === 'return' ? (
                  <>
                    {reviewError && <div className="asg-form-error"><AlertCircle size={14} /> {reviewError}</div>}
                    <textarea
                      className="asg-comment-box"
                      rows={2}
                      placeholder="Reason for returning this deliverable..."
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                    />
                    <div className="asg-review-actions__row">
                      <button className="asg-btn asg-btn--outline" onClick={() => setReviewMode(null)} disabled={reviewing}>Cancel</button>
                      <button className="asg-btn asg-btn--warn" onClick={() => handleReview('return')} disabled={reviewing}>
                        {reviewing ? <Loader2 size={15} className="spin" /> : 'Confirm Return'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="asg-review-actions__row">
                    <button className="asg-btn asg-btn--outline" onClick={() => setReviewMode('return')}>
                      <Undo2 size={14} /> Return
                    </button>
                    <button className="asg-btn asg-btn--gold" onClick={() => handleReview('approve')} disabled={reviewing}>
                      {reviewing ? <Loader2 size={15} className="spin" /> : <><CheckCircle2 size={14} /> Approve</>}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
