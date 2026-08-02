import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ClipboardList, Plus, X, Loader2, AlertCircle, Building2, User, Tag,
  CalendarClock, Undo2, CheckCircle2, Download, FileText, ArrowRight,
  Link2,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier } from '../context/AuthContext'
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
  assigned_tag: '', assigned_org_id: '', submission_id: '', event_id: '', due_date: '',
}

export default function Assignments() {
  const { profile } = useAuth()
  const admin = isAdminTier(profile?.role)
  const canManage = ['sdao_assistant', 'sdao_supervisor', 'academic_director', 'system_admin'].includes(profile?.role)
  const navigate = useNavigate()

  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [people, setPeople] = useState([])
  const [orgs, setOrgs] = useState([])
  const [positions, setPositions] = useState([])
  const [pendingSubmissions, setPendingSubmissions] = useState([])
  const [events, setEvents] = useState([])

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
  const [reviewMode, setReviewMode] = useState(null)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState('')

  useEffect(() => {
    loadAssignments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, profile?.id])

  useEffect(() => {
    if (!canManage) return
    async function loadStatics() {
      const [{ data: p }, { data: o }, { data: m }, { data: s }, { data: e }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role').order('full_name'),
        supabase.from('organizations').select('id, acronym').eq('is_active', true).order('acronym'),
        supabase.from('org_memberships').select('position'),
        supabase.from('submissions')
          .select('id, title, organizations ( acronym )')
          .in('stage', ['submitted', 'assistant_review']),
        supabase.from('events').select('id, title, event_date').order('event_date', { ascending: false }).limit(50),
      ])
      setPeople(p || [])
      setOrgs(o || [])
      setPositions([...new Set((m || []).map((r) => r.position))])
      setPendingSubmissions(s || [])
      setEvents(e || [])
    }
    loadStatics()
  }, [canManage])

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
        submissions ( title, organizations ( acronym ) ),
        events ( title, event_date )
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
    setReviewMode(null)
    setReviewComment('')
    setReviewError('')
    setDetailLoading(true)
    const { data } = await supabase
      .from('assignment_deliverables')
      .select('*, uploader:profiles ( full_name )')
      .eq('assignment_id', a.id)
      .order('uploaded_at', { ascending: true })
    setDeliverables(data || [])
    setDetailLoading(false)
  }

  function goSubmitReport() {
    navigate('/submissions', { state: { autoOpenReportForEventId: selected.event_id } })
  }

  async function handleSubmitDeliverable(e) {
    e.preventDefault()
    if (!deliverableEntry) return
    setSubmittingDeliverable(true)

    if (deliverableEntry.type === 'link') {
      if (!/^https?:\/\/\S+$/i.test((deliverableEntry.url || '').trim())) {
        setSubmittingDeliverable(false)
        return
      }
      await supabase.from('assignment_deliverables').insert({
        assignment_id: selected.id,
        file_url: deliverableEntry.url.trim(),
        note: deliverableNote || null,
        uploaded_by: profile.id,
      })
    } else {
      const file = deliverableEntry
      const ext = file.name.split('.').pop()
      const path = `${selected.id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('assignment-deliverables').upload(path, file)
      if (upErr) {
        setSubmittingDeliverable(false)
        return
      }
      const { data: signed } = await supabase.storage
        .from('assignment-deliverables')
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 5)

      await supabase.from('assignment_deliverables').insert({
        assignment_id: selected.id,
        file_url: signed?.signedUrl || path,
        note: deliverableNote || null,
        uploaded_by: profile.id,
      })
    }

    await supabase.from('assignments')
      .update({ status: 'submitted', updated_at: new Date().toISOString() })
      .eq('id', selected.id)

    setSubmittingDeliverable(false)
    setSelected(null)
    loadAssignments()
  }

  async function handleReview(kind) {
    if (kind === 'return' && !reviewComment.trim()) {
      setReviewError('Please provide a short reason.')
      return
    }
    setReviewing(true)
    await supabase.from('assignments').update({
      status: kind === 'approve' ? 'approved' : 'returned',
      review_comment: reviewComment || null,
      updated_at: new Date().toISOString(),
    }).eq('id', selected.id)

    if (kind === 'approve') {
      // Clear any clearance issue this overdue, non-event assignment opened.
      await supabase.from('clearances')
        .update({ status: 'cleared', cleared_by: profile.id, cleared_at: new Date().toISOString() })
        .eq('assignment_id', selected.id)
        .neq('status', 'cleared')
    }

    setReviewing(false)
    setSelected(null)
    loadAssignments()
  }

  const list = admin ? assignments : assignments.filter(isMyAssignment)

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
          <table className="asg-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Assigned To</th>
                <th>Linked</th>
                <th>Due</th>
                <th>Status</th>
                <th />
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
                  </tr>
                )
              })}
            </tbody>
          </table>
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
              {['user', 'tag', 'org'].map((t) => (
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
                  {people.map((p) => <option key={p.id} value={p.id}>{p.full_name} ({p.role.replace('_', ' ')})</option>)}
                </select>
              </label>
            )}

            {form.targetType === 'tag' && (
              <label className="asg-field">
                Position Tag
                <input
                  list="asg-positions"
                  placeholder="e.g. Treasurer"
                  value={form.assigned_tag}
                  onChange={(e) => setForm({ ...form, assigned_tag: e.target.value })}
                  required
                />
                <datalist id="asg-positions">
                  {positions.map((p) => <option key={p} value={p} />)}
                </datalist>
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

            {isMyAssignment(selected) && ['pending', 'returned', 'conditional_approved'].includes(selected.status) && (
              selected.auto_generated && selected.event_id ? (
                <button className="asg-btn asg-btn--gold asg-btn--full" onClick={goSubmitReport}>
                  <ArrowRight size={15} /> Go to Report Submission
                </button>
              ) : (
                <form className="asg-deliverable-form" onSubmit={handleSubmitDeliverable}>
                  <div className="asg-target-tabs">
                    <button
                      type="button"
                      className={`asg-target-tab ${deliverableEntry?.type !== 'link' ? 'asg-target-tab--active' : ''}`}
                      onClick={() => setDeliverableEntry(null)}
                    >
                      Upload File
                    </button>
                    <button
                      type="button"
                      className={`asg-target-tab ${deliverableEntry?.type === 'link' ? 'asg-target-tab--active' : ''}`}
                      onClick={() => setDeliverableEntry({ type: 'link', url: '' })}
                    >
                      Paste Link
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
                      File <span className="asg-optional">(PDF or Excel)</span>
                      <input
                        type="file"
                        accept=".pdf,.xlsx,.xls"
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
