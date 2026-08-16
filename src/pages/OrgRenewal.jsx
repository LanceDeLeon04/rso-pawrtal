import { useEffect, useMemo, useState } from 'react'
import {
  RefreshCw, Loader2, AlertCircle, X, Check, Upload, FileText, CheckCircle2,
  MessageSquare, User, ClipboardCheck, ShieldCheck,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import './OrgRenewal.css'

// Requirement document types, in display order. "Constitution and
// By-Laws" is the one doc SDAO can optionally allow to be declared
// via checkbox instead of uploaded — see renewal_settings.
const REQUIREMENTS = [
  'General Plan of Action',
  'List of Officers',
  'Constitution and By-Laws',
  'Financial Statement',
  'Summary of Evaluations',
  'Endorsement Letter for Adviser',
  'Letter of Intent',
]

const STAGE_META = {
  draft: { label: 'Draft', tone: 'muted' },
  assistant_review: { label: 'Pending SDAO Assistant', tone: 'warn' },
  supervisor_endorsement: { label: 'Pending SDAO Supervisor', tone: 'blue' },
  director_approval: { label: 'Pending Academic Director', tone: 'blue' },
  approved: { label: 'Approved', tone: 'ok' },
  returned: { label: 'Returned for Revision', tone: 'danger' },
}

const TRACKER_STEPS = [
  { stage: 'assistant_review', label: 'Assistant' },
  { stage: 'supervisor_endorsement', label: 'Supervisor' },
  { stage: 'director_approval', label: 'Director' },
  { stage: 'approved', label: 'Approved' },
]

const REVIEW_STAGE_BY_ROLE = {
  sdao_assistant: 'assistant_review',
  sdao_supervisor: 'supervisor_endorsement',
  academic_director: 'director_approval',
}

function extractStoragePath(fileUrl) {
  if (!fileUrl) return null
  const marker = '/org-renewal-attachments/'
  const idx = fileUrl.indexOf(marker)
  if (idx === -1) return fileUrl
  return fileUrl.slice(idx + marker.length).split('?')[0]
}

export default function OrgRenewal() {
  const { profile } = useAuth()
  const role = profile?.role
  const myOrgId = profile?.org_memberships?.[0]?.org_id
  const myPosition = profile?.org_memberships?.[0]?.position
  const isPresident = role === 'rso_officer' && myPosition === 'President'
  const reviewStage = REVIEW_STAGE_BY_ROLE[role] || null
  const isReviewer = !!reviewStage || role === 'system_admin'
  const isSystemAdmin = role === 'system_admin'

  const [ay, setAy] = useState(null)
  const [settings, setSettings] = useState(null)
  const [renewals, setRenewals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState(isReviewer ? 'queue' : 'mine')
  const [reviewing, setReviewing] = useState(null)

  useEffect(() => { loadAll() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadAll() {
    setLoading(true)
    setError('')
    const { data: currentAy } = await supabase.from('academic_years').select('*').eq('is_current', true).maybeSingle()
    setAy(currentAy || null)
    if (!currentAy) { setSettings(null); setRenewals([]); setLoading(false); return }

    const [{ data: rs }, { data: r, error: rErr }] = await Promise.all([
      supabase.from('renewal_settings').select('*').eq('academic_year_id', currentAy.id).maybeSingle(),
      supabase.from('org_renewals').select(`
        id, org_id, stage, bylaws_declared, submitted_at, decided_at, updated_at,
        organizations ( name, acronym ),
        org_renewal_attachments ( id, document_type, file_url, uploaded_at ),
        org_renewal_history ( id, stage, action, comment, created_at, profiles ( full_name ) )
      `).eq('academic_year_id', currentAy.id).order('updated_at', { ascending: false }),
    ])
    if (rErr) setError('Could not load renewal requests. Please try again.')
    setSettings(rs || null)
    setRenewals(r || [])
    setLoading(false)
  }

  const myRenewal = useMemo(
    () => renewals.find((r) => r.org_id === myOrgId) || null,
    [renewals, myOrgId]
  )
  const queueRenewals = useMemo(
    () => renewals.filter((r) => r.stage === reviewStage),
    [renewals, reviewStage]
  )

  return (
    <div className="rn-page">
      <div className="rn-header">
        <h2 className="rn-header__title"><ClipboardCheck size={17} color="var(--nu-blue-700)" /> RSO Renewal</h2>
        <p className="rn-header__sub">
          Annual renewal requirements. Approval chain: SDAO Assistant → SDAO Supervisor → Academic Director.
        </p>
      </div>

      {error && <div className="rn-error"><AlertCircle size={14} /> {error}</div>}

      {loading ? (
        <div className="rn-loading"><Loader2 size={20} className="spin" /></div>
      ) : !ay ? (
        <div className="rn-empty">No current academic year has been set yet.</div>
      ) : !settings?.is_open && !myRenewal ? (
        <div className="rn-empty">Renewal for {ay.label} hasn't been opened yet.</div>
      ) : (
        <>
          {isPresident && myRenewal && (
            <MyRenewalCard
              ay={ay}
              settings={settings}
              renewal={myRenewal}
              onChanged={loadAll}
            />
          )}

          {isReviewer && (
            <div className="rn-tabs">
              <button className={`rn-tab ${tab === 'queue' ? 'rn-tab--active' : ''}`} onClick={() => setTab('queue')}>
                Awaiting My Review {queueRenewals.length > 0 && <span className="rn-tab__count">{queueRenewals.length}</span>}
              </button>
              <button className={`rn-tab ${tab === 'all' ? 'rn-tab--active' : ''}`} onClick={() => setTab('all')}>
                All Orgs
              </button>
            </div>
          )}

          {isReviewer && (
            <RenewalsList
              renewals={tab === 'queue' ? queueRenewals : renewals}
              reviewStage={reviewStage}
              isSystemAdmin={isSystemAdmin}
              onReview={(r) => setReviewing(r)}
            />
          )}
        </>
      )}

      {reviewing && (
        <ReviewModal
          renewal={reviewing}
          reviewStage={reviewStage}
          isSystemAdmin={isSystemAdmin}
          onClose={() => setReviewing(null)}
          onDone={() => { setReviewing(null); loadAll() }}
        />
      )}
    </div>
  )
}

function Tracker({ stage }) {
  const returned = stage === 'returned'
  const currentIdx = TRACKER_STEPS.findIndex((s) => s.stage === stage)
  return (
    <div className="rn-tracker">
      {TRACKER_STEPS.map((step, i) => {
        const done = !returned && currentIdx > i
        const current = !returned && currentIdx === i
        const cls = returned && i === 0 ? 'rn-tracker__step--returned'
          : done ? 'rn-tracker__step--done'
          : current ? 'rn-tracker__step--current' : ''
        return (
          <div key={step.stage} className={`rn-tracker__step ${cls}`}>
            <div className="rn-tracker__dot">{done ? <Check size={11} /> : i + 1}</div>
            <span className="rn-tracker__label">{step.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function MyRenewalCard({ ay, settings, renewal, onChanged }) {
  const [uploadingDoc, setUploadingDoc] = useState(null)
  const [bylawsChecked, setBylawsChecked] = useState(renewal.bylaws_declared)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const canEdit = renewal.stage === 'draft' || renewal.stage === 'returned'
  const haveDocs = useMemo(
    () => new Set((renewal.org_renewal_attachments || []).map((a) => a.document_type)),
    [renewal.org_renewal_attachments]
  )
  const bylawsSatisfied = settings?.allow_bylaws_checkbox && bylawsChecked
  const allDone = REQUIREMENTS.every((doc) =>
    haveDocs.has(doc) || (doc === 'Constitution and By-Laws' && bylawsSatisfied)
  )

  async function handleUpload(docType, file) {
    if (!file) return
    setUploadingDoc(docType)
    setError('')
    try {
      const ext = file.name.split('.').pop()
      const path = `${renewal.id}/${docType.replace(/\s+/g, '-')}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('org-renewal-attachments').upload(path, file)
      if (upErr) throw upErr
      const { data: signed } = await supabase.storage
        .from('org-renewal-attachments')
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 5)
      const { error: insErr } = await supabase.from('org_renewal_attachments').insert({
        renewal_id: renewal.id,
        document_type: docType,
        file_url: signed?.signedUrl || path,
      })
      if (insErr) throw insErr
      onChanged()
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.')
    }
    setUploadingDoc(null)
  }

  async function handleRemove(attachmentId, fileUrl) {
    setError('')
    const path = extractStoragePath(fileUrl)
    await supabase.from('org_renewal_attachments').delete().eq('id', attachmentId)
    if (path) await supabase.storage.from('org-renewal-attachments').remove([path])
    onChanged()
  }

  async function handleSubmit() {
    setError('')
    setSubmitting(true)
    const { error: err } = await supabase.rpc('submit_org_renewal', {
      p_renewal_id: renewal.id,
      p_bylaws_declared: !!bylawsChecked,
    })
    setSubmitting(false)
    if (err) { setError(err.message || 'Could not submit. Please check every requirement.'); return }
    onChanged()
  }

  const meta = STAGE_META[renewal.stage] || { label: renewal.stage, tone: 'muted' }

  return (
    <div className="rn-card">
      <div className="rn-row__top">
        <span className="rn-card__label"><FileText size={13} /> Your Renewal — {ay.label}</span>
        <span className={`rn-badge rn-badge--${meta.tone}`}>{meta.label}</span>
      </div>
      {settings?.deadline && <p className="rn-card__sub">Deadline: {settings.deadline}</p>}

      {renewal.stage !== 'draft' && <Tracker stage={renewal.stage} />}

      {renewal.stage === 'approved' && (
        <div className="rn-form-error" style={{ background: '#e5f6ec', color: '#1f8a4c', border: '1px solid #bfe3cd' }}>
          <CheckCircle2 size={13} /> Renewal approved — your org's accreditation status is now Accredited.
        </div>
      )}

      {renewal.stage === 'returned' && (
        <div className="rn-form-error"><AlertCircle size={13} /> Returned for revision — see comments below, update your documents, and resubmit.</div>
      )}

      <div className="rn-checklist">
        {REQUIREMENTS.map((doc) => {
          const attachment = (renewal.org_renewal_attachments || []).find((a) => a.document_type === doc)
          const isBylaws = doc === 'Constitution and By-Laws'
          const declaredInstead = isBylaws && settings?.allow_bylaws_checkbox && bylawsChecked && !attachment
          const done = !!attachment || declaredInstead
          return (
            <div key={doc} className={`rn-req ${done ? 'rn-req--done' : ''}`}>
              <div className="rn-req__label">
                {done ? <CheckCircle2 size={14} color="#1f8a4c" /> : <FileText size={14} color="var(--muted)" />}
                {doc}
                {attachment && (
                  <a className="rn-req__file" href={attachment.file_url} target="_blank" rel="noreferrer">View file</a>
                )}
              </div>
              {canEdit && (
                <div className="rn-req__actions">
                  {isBylaws && settings?.allow_bylaws_checkbox && !attachment && (
                    <label className="rn-bylaws-check">
                      <input type="checkbox" checked={bylawsChecked} onChange={(e) => setBylawsChecked(e.target.checked)} />
                      On file, no changes
                    </label>
                  )}
                  {!(isBylaws && bylawsChecked) && (
                    <label className="rn-upload-btn">
                      {uploadingDoc === doc ? <Loader2 size={12} className="spin" /> : <Upload size={12} />}
                      {attachment ? 'Replace' : 'Upload'}
                      <input type="file" onChange={(e) => handleUpload(doc, e.target.files?.[0])} disabled={uploadingDoc === doc} />
                    </label>
                  )}
                  {attachment && (
                    <button className="rn-icon-btn rn-icon-btn--danger" onClick={() => handleRemove(attachment.id, attachment.file_url)} title="Remove">
                      <X size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {(renewal.org_renewal_history || []).filter((h) => h.comment).length > 0 && (
        <div className="rn-row__history">
          {renewal.org_renewal_history.filter((h) => h.comment).map((h) => (
            <p key={h.id}><MessageSquare size={11} /> {h.profiles?.full_name || h.action}: {h.comment}</p>
          ))}
        </div>
      )}

      {error && <div className="rn-form-error"><AlertCircle size={13} /> {error}</div>}

      {canEdit && (
        <div className="rn-form-actions">
          <button className="rn-btn rn-btn--gold" onClick={handleSubmit} disabled={!allDone || submitting}
            title={!allDone ? 'Complete every requirement first' : undefined}>
            {submitting ? <Loader2 size={14} className="spin" /> : 'Submit for Review'}
          </button>
        </div>
      )}
    </div>
  )
}

function RenewalsList({ renewals, reviewStage, isSystemAdmin, onReview }) {
  if (renewals.length === 0) {
    return <div className="rn-empty">No renewals here yet.</div>
  }
  return (
    <div className="rn-list">
      {renewals.map((r) => {
        const meta = STAGE_META[r.stage] || { label: r.stage, tone: 'muted' }
        const canDecide = r.stage === reviewStage
        const canOverride = isSystemAdmin && r.stage !== 'approved'
        return (
          <div key={r.id} className="rn-row">
            <div className="rn-row__main">
              <div className="rn-row__top">
                <span className="rn-row__title">{r.organizations?.acronym || r.organizations?.name}</span>
                <span className={`rn-badge rn-badge--${meta.tone}`}>{meta.label}</span>
              </div>
              <div className="rn-row__meta">
                <span><User size={12} /> {(r.org_renewal_attachments || []).length}/{REQUIREMENTS.length} docs attached</span>
                {r.submitted_at && <span>Submitted {new Date(r.submitted_at).toLocaleDateString()}</span>}
              </div>
            </div>
            <div className="rn-row__actions">
              <button className="rn-btn rn-btn--outline rn-btn--small" onClick={() => onReview(r)}>
                {canDecide || canOverride ? 'Review' : 'View'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ReviewModal({ renewal, reviewStage, isSystemAdmin, onClose, onDone }) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canDecide = renewal.stage === reviewStage
  const canOverride = isSystemAdmin && renewal.stage !== 'approved'

  async function decide(action) {
    setError('')
    setBusy(true)
    const { error: err } = await supabase.rpc('decide_org_renewal', {
      p_renewal_id: renewal.id,
      p_action: action,
      p_comment: comment || null,
    })
    setBusy(false)
    if (err) { setError(err.message || 'Could not record that decision.'); return }
    onDone()
  }

  async function handleOverride() {
    setError('')
    setBusy(true)
    const { error: err } = await supabase.rpc('override_approve_org_renewal', {
      p_renewal_id: renewal.id,
      p_comment: comment || null,
    })
    setBusy(false)
    if (err) { setError(err.message || 'Could not override-approve this renewal.'); return }
    onDone()
  }

  const meta = STAGE_META[renewal.stage] || { label: renewal.stage, tone: 'muted' }

  return (
    <div className="rn-modal-backdrop" onClick={onClose}>
      <div className="rn-modal" onClick={(e) => e.stopPropagation()}>
        <button className="rn-modal__close" onClick={onClose}><X size={18} /></button>
        <h3 className="rn-modal__title"><FileText size={16} /> {renewal.organizations?.acronym || renewal.organizations?.name} — Renewal</h3>
        <span className={`rn-badge rn-badge--${meta.tone}`} style={{ alignSelf: 'flex-start' }}>{meta.label}</span>

        <Tracker stage={renewal.stage} />

        <div className="rn-checklist">
          {REQUIREMENTS.map((doc) => {
            const attachment = (renewal.org_renewal_attachments || []).find((a) => a.document_type === doc)
            const declaredInstead = doc === 'Constitution and By-Laws' && renewal.bylaws_declared && !attachment
            return (
              <div key={doc} className={`rn-req ${attachment || declaredInstead ? 'rn-req--done' : ''}`}>
                <div className="rn-req__label">
                  {attachment || declaredInstead ? <CheckCircle2 size={14} color="#1f8a4c" /> : <FileText size={14} color="var(--muted)" />}
                  {doc}
                  {attachment && <a className="rn-req__file" href={attachment.file_url} target="_blank" rel="noreferrer">View file</a>}
                  {declaredInstead && <span className="rn-req__file">Declared on file, no changes</span>}
                </div>
              </div>
            )
          })}
        </div>

        {(renewal.org_renewal_history || []).filter((h) => h.comment || h.action === 'override_approved').length > 0 && (
          <div className="rn-row__history">
            {renewal.org_renewal_history
              .filter((h) => h.comment || h.action === 'override_approved')
              .map((h) => (
                <p key={h.id}>
                  <MessageSquare size={11} />{' '}
                  {h.profiles?.full_name || 'System Admin'}
                  {h.action === 'override_approved' ? ' overrode and marked this renewal Approved (org accredited)' : `: ${h.comment}`}
                </p>
              ))}
          </div>
        )}

        {(canDecide || canOverride) && (
          <>
            <textarea
              className="rn-textarea"
              placeholder="Comment (optional, required if returning)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            {error && <div className="rn-form-error"><AlertCircle size={13} /> {error}</div>}
            <div className="rn-modal__actions">
              {canDecide && (
                <>
                  <button className="rn-btn rn-btn--danger" disabled={busy} onClick={() => decide('return')}>
                    {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Return for Revision
                  </button>
                  <button className="rn-btn rn-btn--gold" disabled={busy} onClick={() => decide('advance')}>
                    {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Approve &amp; Advance
                  </button>
                </>
              )}
              {canOverride && (
                <button className="rn-btn rn-btn--outline" disabled={busy} onClick={handleOverride}
                  title="Mark this RSO renewed regardless of stage — accredits the org immediately">
                  {busy ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />} Override: Mark Renewed &amp; Accredit
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
