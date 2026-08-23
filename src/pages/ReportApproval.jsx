import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  CheckCircle2, XCircle, Clock, Loader2, AlertTriangle, ShieldCheck, FileText,
  KeyRound, Eye, EyeOff, Lock,
} from 'lucide-react'
import SignaturePad from '../components/SignaturePad'
import { getReportApproval, submitReportDecision, REPORT_ROLE_LABELS } from '../lib/reportApprovals'
import './ExternalApproval.css'

const STATUS_META = {
  pending: { label: 'Pending your signature', tone: 'warn' },
  approved: { label: 'Signed', tone: 'ok' },
  rejected: { label: 'Returned', tone: 'danger' },
  expired: { label: 'Link expired', tone: 'danger' },
}

const OFFICER_ORDER = ['treasurer', 'auditor', 'secretary', 'adviser', 'dean']

export default function ReportApproval() {
  const { token } = useParams()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [payload, setPayload] = useState(null)

  const [comment, setComment] = useState('')
  const [signature, setSignature] = useState(null)
  const [signMode, setSignMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [doneDecision, setDoneDecision] = useState(null)
  const [pin, setPin] = useState('')
  const [pinVisible, setPinVisible] = useState(false)
  const [pendingDecision, setPendingDecision] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function load() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await getReportApproval(token)
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
      setActionError('Please sign above before confirming.')
      return
    }
    if (decision === 'rejected' && !comment.trim()) {
      setActionError('Please provide a reason for returning this report.')
      return
    }
    if (payload.link.pin_required) {
      setPin('')
      setPendingDecision(decision)
      return
    }
    submitDecision(decision)
  }

  async function submitDecision(decision) {
    setActionError('')
    if (payload.link.pin_required && !/^[0-9]{4}$/.test(pin)) {
      setActionError('Please enter your 4-digit security PIN.')
      return
    }
    setSubmitting(true)
    const { error } = await submitReportDecision(
      token, decision, comment.trim() || null, signature, payload.link.pin_required ? pin : null,
    )
    setSubmitting(false)
    if (error) {
      setActionError(error.message || 'Something went wrong. Please try again.')
      return
    }
    setPendingDecision(null)
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

  const { link, report, attachments = [] } = payload
  const roleLabel = REPORT_ROLE_LABELS[link.role] || 'Reviewer'
  const effectiveStatus = doneDecision ? (doneDecision === 'approved' ? 'approved' : 'rejected') : link.status
  const meta = STATUS_META[effectiveStatus] || STATUS_META.pending
  const isDecided = effectiveStatus !== 'pending'
  const isLocked = !link.unlocked && !isDecided && effectiveStatus !== 'expired'

  function waitingOnLabel() {
    if (link.role === 'auditor') return 'the Treasurer/Finance officer'
    if (link.role === 'adviser') return 'the Treasurer, Auditor, and Secretary'
    if (link.role === 'dean') return 'the Adviser'
    return null
  }

  return (
    <div className="xap">
      <header className="xap__header">
        <img src="/pawrtal-logo.png" alt="PAWrtal" className="xap__logo" />
        <div>
          <h1>Post-Activity Report — Signature</h1>
          <p>You've been asked to sign this as the <strong>{roleLabel}</strong>.</p>
        </div>
        <span className={`xap-badge xap-badge--${meta.tone}`}>{meta.label}</span>
      </header>

      <div className="xap__body">
        <section className="xap-card">
          <h2>{report.event_title || report.title}</h2>
          <div className="xap-grid">
            <div><span>Organization</span><strong>{report.org_name || '—'}</strong></div>
            <div><span>Event Date</span><strong>{report.event_date || '—'}</strong></div>
          </div>

          {attachments.length > 0 && (
            <div className="xap-desc">
              <span>Documents for your review</span>
              <ul className="xap-attachment-list">
                {attachments.map((att) => (
                  <li key={att.id}>
                    <FileText size={14} />
                    <span className="xap-attachment-list__name">{att.document_type}</span>
                    <a href={att.file_url} target="_blank" rel="noreferrer">View / Download</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <div className="xap-note xap-note--warn">
          Sign-off order: {OFFICER_ORDER.map((r) => REPORT_ROLE_LABELS[r]).join(' → ')}.
          {' '}Auditor cannot sign until Finance has; Secretary can sign independently; Adviser needs all three
          officers done; Dean is last.
        </div>

        {isLocked ? (
          <section className="xap-card xap-outcome">
            <Lock size={28} />
            <h3>Not your turn yet.</h3>
            <p>This report is still waiting on {waitingOnLabel()} to sign. You'll be able to act once they have — check back later, or re-open this same link.</p>
          </section>
        ) : isDecided ? (
          <section className={`xap-card xap-outcome xap-outcome--${effectiveStatus === 'approved' ? 'ok' : 'danger'}`}>
            {effectiveStatus === 'approved' ? <CheckCircle2 size={28} /> : <XCircle size={28} />}
            <h3>{effectiveStatus === 'approved' ? 'You signed this report.' : 'You returned this report.'}</h3>
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
              placeholder="Add a comment (required if returning)…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
            {signMode && (
              <div className="xap-sig">
                <label>Sign to confirm <span className="xap-muted">(draw your signature, or attach an image)</span></label>
                <SignaturePad onChange={setSignature} />
              </div>
            )}
            {actionError && <p className="xap-error">{actionError}</p>}
            <div className="xap-decision__actions">
              {!signMode && (
                <button className="xap-btn xap-btn--ok" onClick={() => setSignMode(true)}>
                  <CheckCircle2 size={16} /> Sign
                </button>
              )}
              {signMode && (
                <button className="xap-btn xap-btn--ok" disabled={submitting} onClick={() => requestDecision('approved')}>
                  {submitting ? <Loader2 size={16} className="xap__spin" /> : <CheckCircle2 size={16} />} Confirm Signature
                </button>
              )}
              <button className="xap-btn xap-btn--danger" disabled={submitting} onClick={() => requestDecision('rejected')}>
                <XCircle size={16} /> Return for Revisions
              </button>
            </div>
          </section>
        )}
      </div>

      <footer className="xap__footer">
        Link expires {link.expires_at ? new Date(link.expires_at).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'} · NU Laguna SDAO — RSO PAWrtal
      </footer>

      {pendingDecision && (
        <div className="xap-modal-backdrop" onClick={() => !submitting && setPendingDecision(null)}>
          <div className="xap-modal" onClick={(e) => e.stopPropagation()}>
            <KeyRound size={26} color="var(--nu-navy, #0b2545)" />
            <h3>Confirm your Security PIN</h3>
            <p>
              Enter the 4-digit PIN SDAO assigned to you as {roleLabel} to {pendingDecision === 'approved' ? 'confirm your signature' : "confirm you're returning this report"}.
            </p>
            <div className="xap-pin__input xap-pin__input--modal">
              <input
                type={pinVisible ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={4}
                autoFocus
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onKeyDown={(e) => e.key === 'Enter' && submitDecision(pendingDecision)}
              />
              <button type="button" onClick={() => setPinVisible((v) => !v)} aria-label={pinVisible ? 'Hide PIN' : 'Show PIN'}>
                {pinVisible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {actionError && <p className="xap-error">{actionError}</p>}
            <div className="xap-modal__actions">
              <button className="xap-btn xap-btn--ghost" disabled={submitting} onClick={() => setPendingDecision(null)}>
                Cancel
              </button>
              <button
                className={pendingDecision === 'approved' ? 'xap-btn xap-btn--ok' : 'xap-btn xap-btn--danger'}
                disabled={submitting}
                onClick={() => submitDecision(pendingDecision)}
              >
                {submitting ? <Loader2 size={16} className="xap__spin" /> : <CheckCircle2 size={16} />} Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
