import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  CheckCircle2, XCircle, Clock, FileText, ExternalLink,
  Loader2, AlertTriangle, MessageSquare, Send, ShieldCheck,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import SignaturePad from '../components/SignaturePad'
import { SDG_OPTIONS } from '../lib/sdgOptions'
import './ExternalApproval.css'

const STATUS_META = {
  pending: { label: 'Pending your review', tone: 'warn' },
  approved: { label: 'Approved', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'danger' },
  expired: { label: 'Link expired', tone: 'danger' },
}

const ROLE_LABELS = { adviser: 'Adviser', dean: 'Dean', sdg_rep: 'SDG Representative' }

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function ExternalApproval() {
  const { token } = useParams()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [payload, setPayload] = useState(null)

  const [decisionMode, setDecisionMode] = useState(null) // 'approve' | 'reject'
  const [comment, setComment] = useState('')
  const [signature, setSignature] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [doneDecision, setDoneDecision] = useState(null)
  const [sdgSelections, setSdgSelections] = useState([])

  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [sendingMessage, setSendingMessage] = useState(false)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function load() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase.rpc('get_approval_link', { p_token: token })
    setLoading(false)
    if (error || !data || data.error) {
      setLoadError('This link is invalid. Please ask for a new one.')
      return
    }
    setPayload(data)
    setMessages(data.messages || [])
    // Pre-fill with whatever was previously marked (re-issued link, or
    // navigating back after a partial fill) so nothing is lost.
    setSdgSelections(data.link?.sdg_selections || [])
  }

  async function sendMessage() {
    if (!newMessage.trim()) return
    setSendingMessage(true)
    const { data, error } = await supabase.rpc('add_approval_comment', {
      p_token: token, p_body: newMessage.trim(),
    })
    setSendingMessage(false)
    if (!error && data) {
      setMessages((prev) => [...prev, data])
      setNewMessage('')
    }
  }

  async function submitDecision(decision) {
    setActionError('')
    if (decision === 'approved' && !signature) {
      setActionError('Please sign above before approving.')
      return
    }
    if (decision === 'approved' && payload.link.role === 'sdg_rep' && sdgSelections.length === 0) {
      setActionError('Please mark at least one SDG before approving.')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.rpc('submit_approval_decision', {
      p_token: token,
      p_decision: decision,
      p_comment: comment.trim() || null,
      p_signature: signature,
      p_sdgs: payload.link.role === 'sdg_rep' ? sdgSelections : null,
    })
    setSubmitting(false)
    if (error) {
      setActionError(error.message || 'Something went wrong. Please try again.')
      return
    }
    setDoneDecision(decision)
  }

  if (loading) {
    return (
      <div className="xap xap--center">
        <Loader2 className="xap__spin" size={28} />
      </div>
    )
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

  const { link, submission, organization, attachments, prior_chain_complete: priorChainComplete } = payload
  const roleLabel = ROLE_LABELS[link.role] || 'Reviewer'
  const effectiveStatus = doneDecision ? (doneDecision === 'approved' ? 'approved' : 'rejected') : link.status
  const meta = STATUS_META[effectiveStatus] || STATUS_META.pending
  const isDecided = effectiveStatus !== 'pending'
  const roleBlocked = (link.role === 'dean' || link.role === 'sdg_rep') && !priorChainComplete && !isDecided

  return (
    <div className="xap">
      <header className="xap__header">
        <img src="/pawrtal-logo.png" alt="PAWrtal" className="xap__logo" />
        <div>
          <h1>Application Review</h1>
          <p>You've been asked to review this as the <strong>{roleLabel}</strong> for {organization.acronym || organization.name}.</p>
        </div>
        <span className={`xap-badge xap-badge--${meta.tone}`}>{meta.label}</span>
      </header>

      <div className="xap__body">
        <section className="xap-card">
          <h2>{submission.title}</h2>
          <div className="xap-grid">
            <div><span>Organization</span><strong>{organization.name}</strong></div>
            <div><span>Category</span><strong>{organization.category || '—'}</strong></div>
            <div><span>Contact Person</span><strong>{submission.contact_person || '—'}</strong></div>
            <div><span>Contact Number</span><strong>{submission.contact_number || '—'}</strong></div>
            <div>
              <span>Date</span>
              <strong>
                {submission.is_continuing
                  ? (submission.continuing_type === 'year_round' ? 'Year-Round' : `Term: ${submission.term_label || '—'}`)
                  : fmtDate(submission.event_date)}
              </strong>
            </div>
            <div><span>Time</span><strong>{submission.start_time || '—'} – {submission.end_time || '—'}</strong></div>
            <div><span>Medium</span><strong>{submission.medium || '—'}</strong></div>
            <div>
              <span>Venue / Platform</span>
              <strong>{submission.medium === 'online' ? (submission.online_platform || '—') : (submission.venue || submission.venue_detail || '—')}</strong>
            </div>
            <div><span>Target Audience</span><strong>{submission.target_audience || '—'}</strong></div>
            <div><span>Target Participants</span><strong>{submission.target_participants ?? '—'}</strong></div>
            <div><span>Projected Budget</span><strong>{submission.projected_budget != null ? `₱${Number(submission.projected_budget).toLocaleString()}` : '—'}</strong></div>
            <div><span>Budget Source</span><strong>{submission.budget_source || '—'}</strong></div>
          </div>
          {submission.description && (
            <div className="xap-desc">
              <span>Description</span>
              <p>{submission.description}</p>
            </div>
          )}
        </section>

        <section className="xap-card">
          <h3><FileText size={16} /> Attached Documents</h3>
          {attachments.length === 0 && <p className="xap-muted">No documents attached.</p>}
          <ul className="xap-doclist">
            {attachments.map((a, i) => (
              <li key={i}>
                <a href={a.file_url} target="_blank" rel="noreferrer">
                  {a.document_type} <ExternalLink size={13} />
                </a>
              </li>
            ))}
          </ul>
        </section>

        {(link.role === 'dean' || link.role === 'sdg_rep') && (
          <div className={`xap-note ${priorChainComplete ? 'xap-note--ok' : 'xap-note--warn'}`}>
            {priorChainComplete
              ? 'Everyone ahead of you in the review chain has approved. You may proceed.'
              : 'Waiting on earlier reviewers (Adviser, and Dean if required) to approve first. You will be able to decide once they do.'}
          </div>
        )}

        <section className="xap-card">
          <h3><MessageSquare size={16} /> Comments</h3>
          <div className="xap-thread">
            {messages.length === 0 && <p className="xap-muted">No comments yet.</p>}
            {messages.map((m, i) => (
              <div key={i} className={`xap-msg xap-msg--${m.author}`}>
                <div className="xap-msg__meta">{m.author === 'reviewer' ? roleLabel : 'SDAO'} · {fmtDateTime(m.created_at)}</div>
                <div className="xap-msg__body">{m.body}</div>
              </div>
            ))}
          </div>
          {!isDecided && (
            <div className="xap-thread__input">
              <input
                type="text"
                placeholder="Leave a comment…"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              />
              <button onClick={sendMessage} disabled={sendingMessage || !newMessage.trim()}>
                <Send size={15} />
              </button>
            </div>
          )}
        </section>

        {isDecided ? (
          <section className={`xap-card xap-outcome xap-outcome--${effectiveStatus === 'approved' ? 'ok' : 'danger'}`}>
            {effectiveStatus === 'approved' ? <CheckCircle2 size={28} /> : <XCircle size={28} />}
            <h3>{effectiveStatus === 'approved' ? 'You approved this application.' : 'You rejected this application.'}</h3>
            <p>Thank you — {organization.acronym || organization.name} and SDAO have been notified.</p>
          </section>
        ) : effectiveStatus === 'expired' ? (
          <section className="xap-card xap-outcome xap-outcome--danger">
            <Clock size={28} />
            <h3>This link has expired.</h3>
            <p>Please ask {organization.acronym || organization.name} to send you a new one.</p>
          </section>
        ) : (
          <section className="xap-card xap-decision">
            <h3><ShieldCheck size={16} /> Your Decision</h3>
            {roleBlocked ? (
              <p className="xap-muted">Decision controls will unlock once earlier reviewers approve.</p>
            ) : (
              <>
                {link.role === 'sdg_rep' && (
                  <div className="xap-sdg">
                    <label>Sustainable Development Goals <span className="xap-muted">(mark all that this activity counts toward)</span></label>
                    <div className="xap-sdg-grid">
                      {SDG_OPTIONS.map((optLabel, i) => {
                        const val = String(i + 1)
                        const checked = sdgSelections.includes(val)
                        return (
                          <label key={val} className="xap-sdg-item">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => setSdgSelections((prev) => (
                                e.target.checked ? [...prev, val] : prev.filter((v) => v !== val)
                              ))}
                            />
                            {optLabel}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
                <textarea
                  placeholder="Add a comment (required if rejecting)…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                />
                {decisionMode === 'approve' && (
                  <div className="xap-sig">
                    <label>Draw your signature to approve</label>
                    <SignaturePad onChange={setSignature} />
                  </div>
                )}
                {actionError && <p className="xap-error">{actionError}</p>}
                <div className="xap-decision__actions">
                  {decisionMode !== 'approve' && (
                    <button
                      className="xap-btn xap-btn--ok"
                      onClick={() => setDecisionMode('approve')}
                    >
                      <CheckCircle2 size={16} /> Approve
                    </button>
                  )}
                  {decisionMode === 'approve' && (
                    <button
                      className="xap-btn xap-btn--ok"
                      disabled={submitting}
                      onClick={() => submitDecision('approved')}
                    >
                      {submitting ? <Loader2 size={16} className="xap__spin" /> : <CheckCircle2 size={16} />} Confirm Approval
                    </button>
                  )}
                  <button
                    className="xap-btn xap-btn--danger"
                    disabled={submitting}
                    onClick={() => {
                      if (!comment.trim()) { setActionError('Please provide a reason for rejecting.'); return }
                      submitDecision('rejected')
                    }}
                  >
                    <XCircle size={16} /> Reject
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </div>

      <footer className="xap__footer">
        Link expires {fmtDateTime(link.expires_at)} · NU Laguna SDAO — RSO PAWrtal
      </footer>
    </div>
  )
}
