import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  CheckCircle2, XCircle, Clock, Loader2, AlertTriangle, ShieldCheck, FileText, Download,
} from 'lucide-react'
import SignaturePad from '../components/SignaturePad'
import {
  getCurricularApproval, submitCurricularDecision, getCurricularApprovalAttachment,
  downloadBase64File, formatFileSize,
} from '../lib/curricularActivities'
import './ExternalApproval.css'

const STATUS_META = {
  pending: { label: 'Pending your review', tone: 'warn' },
  approved: { label: 'Approved', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'danger' },
  expired: { label: 'Link expired', tone: 'danger' },
}

const ROLE_LABELS = { dean: 'Dean', sdg_rep: 'SDG Representative' }

function fmtDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function CurricularApproval() {
  const { token } = useParams()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [payload, setPayload] = useState(null)

  const [decisionMode, setDecisionMode] = useState(null)
  const [comment, setComment] = useState('')
  const [signature, setSignature] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [doneDecision, setDoneDecision] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function load() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await getCurricularApproval(token)
    setLoading(false)
    if (error || !data || data.error) {
      setLoadError('This link is invalid. Please ask SDAO for a new one.')
      return
    }
    setPayload(data)
  }

  function requestDecision(decision) {
    setActionError('')
    if (decision === 'approved' && !signature) {
      setActionError('Please sign above before approving.')
      return
    }
    if (decision === 'rejected' && !comment.trim()) {
      setActionError('Please provide a reason for rejecting.')
      return
    }
    submitDecision(decision)
  }

  async function submitDecision(decision) {
    setActionError('')
    setSubmitting(true)
    const { error } = await submitCurricularDecision(token, decision, comment.trim() || null, signature)
    setSubmitting(false)
    if (error) {
      setActionError(error.message || 'Something went wrong. Please try again.')
      return
    }
    setDoneDecision(decision)
  }

  if (loading) {
    return <div className="xap xap--center"><Loader2 className="xap__spin" size={28} /></div>
  }

  if (loadError) {
    return (
      <div className="xap xap--center">
        <div className="xap-card xap-card--narrow">
          <AlertTriangle size={30} color="#c23b3b" />
          <h2>Link not found</h2>
          <p>{loadError}</p>
        </div>
      </div>
    )
  }

  const { link, activity, dean_status: deanStatus, sdg_status: sdgStatus, attachments = [] } = payload
  const roleLabel = ROLE_LABELS[link.role] || 'Reviewer'
  const counterpartRole = link.role === 'dean' ? 'sdg_rep' : 'dean'
  const counterpartLabel = ROLE_LABELS[counterpartRole]
  const counterpartStatus = link.role === 'dean' ? sdgStatus : deanStatus
  const effectiveStatus = doneDecision ? (doneDecision === 'approved' ? 'approved' : 'rejected') : link.status
  const meta = STATUS_META[effectiveStatus] || STATUS_META.pending
  const isDecided = effectiveStatus !== 'pending'

  async function handleDownload(att) {
    const { data } = await getCurricularApprovalAttachment(token, att.id)
    if (data?.data) downloadBase64File(data.data, data.file_name || att.file_name, data.file_type || att.file_type)
  }

  return (
    <div className="xap">
      <header className="xap__header">
        <img src="/pawrtal-logo.png" alt="PAWrtal" className="xap__logo" />
        <div>
          <h1>Curricular Activity Review</h1>
          <p>You've been asked to review this as the <strong>{roleLabel}</strong>.</p>
        </div>
        <span className={`xap-badge xap-badge--${meta.tone}`}>{meta.label}</span>
      </header>

      <div className="xap__body">
        <section className="xap-card">
          <h2>{activity.title}</h2>
          <div className="xap-grid">
            <div><span>Event Code</span><strong>{activity.event_code}</strong></div>
            <div><span>Submitted By</span><strong>{activity.faculty_name}</strong></div>
            <div><span>Department</span><strong>{activity.department || '—'}</strong></div>
            <div><span>Activity Type</span><strong>{activity.activity_type || '—'}</strong></div>
            <div><span>Date</span><strong>{fmtDate(activity.event_date)}</strong></div>
            <div><span>Time</span><strong>{activity.start_time || '—'} – {activity.end_time || '—'}</strong></div>
            <div><span>Medium</span><strong>{activity.medium || '—'}</strong></div>
            <div>
              <span>Venue / Platform</span>
              <strong>{activity.medium === 'online' ? (activity.online_platform || '—') : (activity.venue || activity.venue_detail || '—')}</strong>
            </div>
            <div><span>Target Audience</span><strong>{activity.target_audience || '—'}</strong></div>
            <div><span>Target Participants</span><strong>{activity.target_participants ?? '—'}</strong></div>
            <div><span>Projected Budget</span><strong>{activity.projected_budget != null ? `₱${Number(activity.projected_budget).toLocaleString()}` : '—'}</strong></div>
            <div><span>Budget Source</span><strong>{activity.budget_source || '—'}</strong></div>
          </div>
          {activity.description && (
            <div className="xap-desc">
              <span>Description</span>
              <p>{activity.description}</p>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="xap-desc">
              <span>Attachments</span>
              <ul className="xap-attachment-list">
                {attachments.map((att) => (
                  <li key={att.id}>
                    <FileText size={14} />
                    <span className="xap-attachment-list__name">{att.file_name}</span>
                    <span className="xap-attachment-list__size">{formatFileSize(att.file_size)}</span>
                    <button type="button" onClick={() => handleDownload(att)}><Download size={14} /> Download</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <div className={`xap-note ${counterpartStatus === 'approved' ? 'xap-note--ok' : 'xap-note--warn'}`}>
          {counterpartStatus === 'approved'
            ? `The ${counterpartLabel} has also approved this activity.`
            : counterpartStatus === 'rejected'
              ? `The ${counterpartLabel} rejected this activity — it won't proceed regardless of your decision.`
              : `The ${counterpartLabel} is reviewing separately, in parallel. You don't need to wait for them — decide whenever you're ready.`}
        </div>

        {isDecided ? (
          <section className={`xap-card xap-outcome xap-outcome--${effectiveStatus === 'approved' ? 'ok' : 'danger'}`}>
            {effectiveStatus === 'approved' ? <CheckCircle2 size={28} /> : <XCircle size={28} />}
            <h3>{effectiveStatus === 'approved' ? 'You approved this activity.' : 'You rejected this activity.'}</h3>
            <p>Thank you — SDAO has been notified.</p>
          </section>
        ) : effectiveStatus === 'expired' ? (
          <section className="xap-card xap-outcome xap-outcome--danger">
            <Clock size={28} />
            <h3>This link has expired.</h3>
            <p>Please ask SDAO to send you a new one.</p>
          </section>
        ) : (
          <section className="xap-card xap-decision">
            <h3><ShieldCheck size={16} /> Your Decision</h3>
            <textarea
              placeholder="Add a comment (required if rejecting)…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
            {decisionMode === 'approve' && (
              <div className="xap-sig">
                <label>Sign to approve <span className="xap-muted">(draw your signature, or attach an image)</span></label>
                <SignaturePad onChange={setSignature} />
              </div>
            )}
            {actionError && <p className="xap-error">{actionError}</p>}
            <div className="xap-decision__actions">
              {decisionMode !== 'approve' && (
                <button className="xap-btn xap-btn--ok" onClick={() => setDecisionMode('approve')}>
                  <CheckCircle2 size={16} /> Approve
                </button>
              )}
              {decisionMode === 'approve' && (
                <button className="xap-btn xap-btn--ok" disabled={submitting} onClick={() => requestDecision('approved')}>
                  {submitting ? <Loader2 size={16} className="xap__spin" /> : <CheckCircle2 size={16} />} Confirm Approval
                </button>
              )}
              <button className="xap-btn xap-btn--danger" disabled={submitting} onClick={() => requestDecision('rejected')}>
                <XCircle size={16} /> Reject
              </button>
            </div>
          </section>
        )}
      </div>

      <footer className="xap__footer">
        Link expires {fmtDateTime(link.expires_at)} · NU Laguna SDAO — RSO PAWrtal
      </footer>
    </div>
  )
}
