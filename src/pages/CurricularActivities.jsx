import { useEffect, useState } from 'react'
import {
  Link2, Plus, Copy, Check, Loader2, ChevronLeft, GraduationCap,
  CheckCircle2, XCircle, RotateCcw, Send, ToggleLeft, ToggleRight,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  fetchCurricularApplyLinks, generateCurricularApplyLink, setCurricularApplyLinkActive,
  fetchCurricularActivities, fetchCurricularApprovals, fetchCurricularHistory,
  generateCurricularApproval, decideCurricularActivity,
  curricularApplyUrl, curricularApproveUrl, CURRICULAR_STATUS_LABELS,
} from '../lib/curricularActivities'
import './CurricularActivities.css'

function fmtDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="ca-copy-btn"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800) }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy link'}
    </button>
  )
}

function ApplyLinksTab() {
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await fetchCurricularApplyLinks()
    setLinks(data)
    setLoading(false)
  }

  async function create() {
    setCreating(true)
    await generateCurricularApplyLink(label.trim())
    setLabel('')
    setCreating(false)
    load()
  }

  async function toggle(id, active) {
    await setCurricularApplyLinkActive(id, !active)
    load()
  }

  return (
    <div className="ca-panel">
      <div className="ca-new-link">
        <input
          placeholder="Optional label, e.g. College of Engineering"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button className="btn-primary" onClick={create} disabled={creating}>
          {creating ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} Generate Link
        </button>
      </div>

      {loading ? (
        <div className="ca-loading"><Loader2 className="spin" size={20} /></div>
      ) : links.length === 0 ? (
        <p className="ca-empty">No application links generated yet.</p>
      ) : (
        <ul className="ca-link-list">
          {links.map((l) => (
            <li key={l.id} className={l.is_active ? '' : 'ca-link--inactive'}>
              <div className="ca-link__main">
                <span className="ca-link__label">{l.label || 'Untitled link'}</span>
                <span className="ca-link__meta">Created {fmtDateTime(l.created_at)}{!l.is_active ? ' · Deactivated' : ''}</span>
              </div>
              <div className="ca-link__actions">
                <CopyButton text={curricularApplyUrl(l.token)} />
                <button type="button" className="ca-toggle-btn" onClick={() => toggle(l.id, l.is_active)}>
                  {l.is_active ? <ToggleRight size={20} color="#16a34a" /> : <ToggleLeft size={20} color="#94a3b8" />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ApproverRow({ role, roleLabel, approval, activityStatus, onGenerate }) {
  const [name, setName] = useState(approval?.person_name || '')
  const [email, setEmail] = useState(approval?.person_email || '')
  const [busy, setBusy] = useState(false)

  const canGenerate = role === 'dean' ? activityStatus === 'dean_review' : (activityStatus === 'dean_review' || activityStatus === 'sdg_review')

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    await onGenerate(role, name.trim(), email.trim())
    setBusy(false)
  }

  return (
    <div className="ca-approver-row">
      <div className="ca-approver-row__head">
        <strong>{roleLabel}</strong>
        {approval && <span className={`ca-status-pill ca-status-pill--${approval.status}`}>{approval.status}</span>}
      </div>
      {approval ? (
        <div className="ca-approver-row__body">
          <span>{approval.person_name}{approval.person_email ? ` · ${approval.person_email}` : ''}</span>
          <CopyButton text={curricularApproveUrl(approval.token)} />
          {approval.status === 'pending' && canGenerate && (
            <button type="button" className="ca-reissue-btn" onClick={submit} disabled={busy}>
              <Send size={13} /> Reissue
            </button>
          )}
        </div>
      ) : canGenerate ? (
        <div className="ca-approver-row__form">
          <input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="ca-generate-btn" onClick={submit} disabled={busy || !name.trim()}>
            {busy ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />} Generate Link
          </button>
        </div>
      ) : (
        <p className="ca-muted">Not yet reached.</p>
      )}
    </div>
  )
}

function ActivityDetail({ activity, onBack, onChanged, canDecideAsDirector }) {
  const [approvals, setApprovals] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [deciding, setDeciding] = useState(false)

  useEffect(() => { load() }, [activity.id])

  async function load() {
    setLoading(true)
    const [{ data: a }, { data: h }] = await Promise.all([
      fetchCurricularApprovals(activity.id), fetchCurricularHistory(activity.id),
    ])
    setApprovals(a)
    setHistory(h)
    setLoading(false)
  }

  async function handleGenerate(role, name, email) {
    await generateCurricularApproval(activity.id, role, name, email)
    load()
    onChanged()
  }

  async function decide(decision) {
    setDeciding(true)
    await decideCurricularActivity(activity.id, decision, comment.trim() || null)
    setDeciding(false)
    onChanged()
    onBack()
  }

  const dean = approvals.find((a) => a.role === 'dean')
  const sdg = approvals.find((a) => a.role === 'sdg_rep')

  return (
    <div className="ca-panel">
      <button type="button" className="ca-back-btn" onClick={onBack}><ChevronLeft size={16} /> Back to list</button>

      <div className="ca-detail-head">
        <h2>{activity.title}</h2>
        <span className={`ca-status-pill ca-status-pill--big ca-status-pill--${activity.status}`}>
          {CURRICULAR_STATUS_LABELS[activity.status]}
        </span>
      </div>
      <p className="ca-detail-code">{activity.event_code}</p>

      <div className="ca-detail-grid">
        <div><span>Submitted By</span><strong>{activity.faculty_name}</strong></div>
        <div><span>Email</span><strong>{activity.faculty_email}</strong></div>
        <div><span>Department</span><strong>{activity.department || '—'}</strong></div>
        <div><span>Date</span><strong>{fmtDate(activity.event_date)}</strong></div>
        <div><span>Time</span><strong>{activity.start_time || '—'} – {activity.end_time || '—'}</strong></div>
        <div><span>Medium</span><strong>{activity.medium || '—'}</strong></div>
        <div><span>Target Audience</span><strong>{activity.target_audience || '—'}</strong></div>
        <div><span>Target Participants</span><strong>{activity.target_participants ?? '—'}</strong></div>
        <div><span>Projected Budget</span><strong>{activity.projected_budget != null ? `₱${Number(activity.projected_budget).toLocaleString()}` : '—'}</strong></div>
        <div><span>Budget Source</span><strong>{activity.budget_source || '—'}</strong></div>
      </div>
      {activity.description && (
        <div className="ca-detail-desc"><span>Description</span><p>{activity.description}</p></div>
      )}

      {loading ? (
        <div className="ca-loading"><Loader2 className="spin" size={20} /></div>
      ) : (
        <>
          <h3 className="ca-section-title">Approval Chain</h3>
          <ApproverRow role="dean" roleLabel="Dean" approval={dean} activityStatus={activity.status} onGenerate={handleGenerate} />
          <ApproverRow role="sdg_rep" roleLabel="SDG Representative" approval={sdg} activityStatus={activity.status} onGenerate={handleGenerate} />

          <div className="ca-approver-row">
            <div className="ca-approver-row__head">
              <strong>Academic Director</strong>
              {activity.status === 'approved' && <span className="ca-status-pill ca-status-pill--approved">approved</span>}
              {activity.status === 'returned' && <span className="ca-status-pill ca-status-pill--rejected">returned</span>}
            </div>
            {activity.status === 'director_review' ? (
              canDecideAsDirector ? (
                <div className="ca-director-form">
                  <textarea placeholder="Comment (required if returning)" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
                  <div className="ca-director-form__actions">
                    <button className="ca-btn ca-btn--ok" disabled={deciding} onClick={() => decide('approved')}>
                      <CheckCircle2 size={14} /> Approve
                    </button>
                    <button className="ca-btn ca-btn--danger" disabled={deciding || !comment.trim()} onClick={() => decide('returned')}>
                      <RotateCcw size={14} /> Return
                    </button>
                  </div>
                </div>
              ) : (
                <p className="ca-muted">Awaiting Academic Director decision inside the app.</p>
              )
            ) : (
              <p className="ca-muted">Not yet reached.</p>
            )}
          </div>

          <h3 className="ca-section-title">History</h3>
          <ul className="ca-history">
            {history.map((h) => (
              <li key={h.id}>
                <span className="ca-history__dot" />
                <div>
                  <strong>{h.actor_name || '—'}</strong> {h.action} <span className="ca-muted">({h.step})</span>
                  {h.comment && <p className="ca-history__comment">{h.comment}</p>}
                  <span className="ca-history__time">{fmtDateTime(h.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function ActivitiesTab({ canDecideAsDirector }) {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await fetchCurricularActivities()
    setActivities(data)
    setLoading(false)
  }

  if (selected) {
    return (
      <ActivityDetail
        activity={selected}
        onBack={() => setSelected(null)}
        onChanged={load}
        canDecideAsDirector={canDecideAsDirector}
      />
    )
  }

  return (
    <div className="ca-panel">
      {loading ? (
        <div className="ca-loading"><Loader2 className="spin" size={20} /></div>
      ) : activities.length === 0 ? (
        <p className="ca-empty">No curricular activities submitted yet.</p>
      ) : (
        <ul className="ca-activity-list">
          {activities.map((a) => (
            <li key={a.id} onClick={() => setSelected(a)}>
              <div className="ca-activity-list__main">
                <strong>{a.title}</strong>
                <span className="ca-muted">{a.event_code} · {a.faculty_name}{a.department ? ` · ${a.department}` : ''}</span>
              </div>
              <div className="ca-activity-list__meta">
                <span className={`ca-status-pill ca-status-pill--${a.status}`}>{CURRICULAR_STATUS_LABELS[a.status]}</span>
                <span className="ca-muted">{fmtDate(a.event_date)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function CurricularActivities() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('activities')
  const canDecideAsDirector = ['academic_director', 'system_admin'].includes(profile?.role)

  return (
    <div className="ca-page">
      <div className="ca-page__header">
        <div className="ca-page__title">
          <GraduationCap size={22} />
          <div>
            <h1>Curricular Activities</h1>
            <p>Faculty applications routed through Dean, SDG Representative, then Academic Director.</p>
          </div>
        </div>
      </div>

      <div className="ca-tabs">
        <button className={tab === 'activities' ? 'active' : ''} onClick={() => setTab('activities')}>Submissions</button>
        <button className={tab === 'links' ? 'active' : ''} onClick={() => setTab('links')}>Apply Links</button>
      </div>

      {tab === 'activities' ? <ActivitiesTab canDecideAsDirector={canDecideAsDirector} /> : <ApplyLinksTab />}
    </div>
  )
}
