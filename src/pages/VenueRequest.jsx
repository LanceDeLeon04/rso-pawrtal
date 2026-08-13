import { useEffect, useMemo, useState } from 'react'
import {
  Building2, Plus, Loader2, AlertCircle, CheckCircle2, X, Clock,
  Calendar as CalendarIcon, User, MessageSquare, Check, Ban, Pencil,
  RotateCcw, Info,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isSHSFacultyModerator } from '../context/AuthContext'
import { formatTime } from '../lib/dateUtils'
import './VenueRequest.css'

const STATUS_META = {
  pending_sdao_shs: { label: 'Pending SDAO-SHS', tone: 'warn' },
  pending_principal: { label: 'Pending Principal', tone: 'blue' },
  approved: { label: 'Approved', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
}

const EMPTY_FORM = { classroom_id: '', purpose: '', request_date: '', start_time: '', end_time: '' }

export default function VenueRequest() {
  const { profile } = useAuth()
  const role = profile?.role
  // A Faculty-Moderator (role 'rso_officer' + Moderator org_membership
  // on an SHS org — see isSHSFacultyModerator) gets the same "submit a
  // request for yourself" experience as a pure SHS Faculty account.
  const isFaculty = role === 'shs_faculty' || isSHSFacultyModerator(profile)
  const isSdaoShs = role === 'sdao_shs'
  const isPrincipal = role === 'shs_principal'
  const isReviewer = isSdaoShs || isPrincipal
  // Which status this reviewer's queue is waiting on.
  const reviewStage = isSdaoShs ? 'pending_sdao_shs' : isPrincipal ? 'pending_principal' : null

  const [classrooms, setClassrooms] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState(isReviewer ? 'queue' : 'mine')

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadAll() {
    setLoading(true)
    setError('')
    const [{ data: c, error: cErr }, { data: r, error: rErr }] = await Promise.all([
      supabase.from('shs_classrooms').select('id, name, sort_order, is_active').order('sort_order'),
      supabase
        .from('shs_venue_requests')
        .select(`
          id, requester_id, classroom_id, purpose, request_date, start_time, end_time, status,
          sdao_shs_reviewer_id, sdao_shs_decided_at, sdao_shs_comment,
          principal_reviewer_id, principal_decided_at, principal_comment,
          created_at,
          shs_classrooms ( name ),
          profiles!shs_venue_requests_requester_id_fkey ( full_name )
        `)
        .order('created_at', { ascending: false }),
    ])
    if (cErr || rErr) setError('Could not load venue requests. Please try again.')
    setClassrooms(c || [])
    setRequests(r || [])
    setLoading(false)
  }

  const activeClassrooms = useMemo(() => classrooms.filter((c) => c.is_active), [classrooms])
  const myRequests = useMemo(
    () => requests.filter((r) => r.requester_id === profile?.id),
    [requests, profile?.id]
  )
  const queueRequests = useMemo(
    () => requests.filter((r) => r.status === reviewStage),
    [requests, reviewStage]
  )

  return (
    <div className="vr-page">
      <div className="vr-header">
        <h2 className="vr-header__title"><Building2 size={17} color="var(--nu-blue-700)" /> Venue Request</h2>
        <p className="vr-header__sub">
          {isFaculty
            ? 'Request an SHS classroom for your class or activity. Approval chain: You → SDAO-SHS → SHS Principal.'
            : 'SHS classroom booking requests submitted by Faculty. Approval chain: Faculty → SDAO-SHS → SHS Principal.'}
        </p>
        {isFaculty && (
          <p className="vr-header__note">
            <Info size={13} /> Only SHS classrooms can be requested here. If you need a College department room
            (a lecture hall, lab, etc.), please request it personally from the Facilities Management Office.
          </p>
        )}
      </div>

      {error && <div className="vr-error"><AlertCircle size={14} /> {error}</div>}

      {isFaculty && <NewRequestForm classrooms={activeClassrooms} onCreated={loadAll} />}

      {isReviewer && (
        <div className="vr-tabs">
          <button className={`vr-tab ${tab === 'queue' ? 'vr-tab--active' : ''}`} onClick={() => setTab('queue')}>
            Awaiting My Review {queueRequests.length > 0 && <span className="vr-tab__count">{queueRequests.length}</span>}
          </button>
          <button className={`vr-tab ${tab === 'all' ? 'vr-tab--active' : ''}`} onClick={() => setTab('all')}>
            All Requests
          </button>
          {isSdaoShs && (
            <button className={`vr-tab ${tab === 'rooms' ? 'vr-tab--active' : ''}`} onClick={() => setTab('rooms')}>
              Manage Classrooms
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="vr-loading"><Loader2 size={20} className="spin" /></div>
      ) : isReviewer && tab === 'rooms' ? (
        <ManageClassroomsSection classrooms={classrooms} onChanged={loadAll} />
      ) : (
        <RequestsList
          requests={isFaculty ? myRequests : (tab === 'queue' ? queueRequests : requests)}
          profile={profile}
          isFaculty={isFaculty}
          isReviewer={isReviewer}
          reviewStage={reviewStage}
          onChanged={loadAll}
        />
      )}
    </div>
  )
}

function NewRequestForm({ classrooms, onCreated }) {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!form.classroom_id || !form.purpose.trim() || !form.request_date || !form.start_time || !form.end_time) {
      setError('Please fill in every field.')
      return
    }
    if (form.end_time <= form.start_time) {
      setError('End time must be after the start time.')
      return
    }

    setSaving(true)
    const { error: err } = await supabase.from('shs_venue_requests').insert({
      requester_id: profile.id,
      classroom_id: form.classroom_id,
      purpose: form.purpose.trim(),
      request_date: form.request_date,
      start_time: form.start_time,
      end_time: form.end_time,
      status: 'pending_sdao_shs',
    })
    setSaving(false)

    if (err) {
      setError('Could not submit the request. Please try again.')
      return
    }

    setForm(EMPTY_FORM)
    setOpen(false)
    onCreated()
  }

  if (!open) {
    return (
      <button className="vr-btn vr-btn--gold" onClick={() => setOpen(true)}>
        <Plus size={14} /> New Venue Request
      </button>
    )
  }

  return (
    <div className="vr-card">
      <span className="vr-card__label"><Plus size={13} /> New Venue Request</span>
      {error && <div className="vr-form-error"><AlertCircle size={13} /> {error}</div>}
      <form className="vr-form" onSubmit={handleSubmit}>
        <div className="vr-field-row">
          <label className="vr-field">
            SHS Classroom
            <select value={form.classroom_id} onChange={(e) => setForm({ ...form, classroom_id: e.target.value })} required>
              <option value="">Select a classroom…</option>
              {classrooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="vr-field">
            Date
            <input type="date" value={form.request_date} onChange={(e) => setForm({ ...form, request_date: e.target.value })} required />
          </label>
        </div>
        <div className="vr-field-row">
          <label className="vr-field">
            Start Time
            <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} required />
          </label>
          <label className="vr-field">
            End Time
            <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} required />
          </label>
        </div>
        <label className="vr-field">
          Purpose
          <textarea
            rows={2}
            value={form.purpose}
            onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            placeholder="e.g. Remedial class for Grade 11 STEM"
            required
          />
        </label>
        <div className="vr-form-actions">
          <button type="button" className="vr-btn vr-btn--ghost" onClick={() => { setOpen(false); setForm(EMPTY_FORM); setError('') }}>
            Cancel
          </button>
          <button className="vr-btn vr-btn--gold" type="submit" disabled={saving}>
            {saving ? <Loader2 size={14} className="spin" /> : 'Submit Request'}
          </button>
        </div>
      </form>
    </div>
  )
}

function RequestsList({ requests, profile, isFaculty, isReviewer, reviewStage, onChanged }) {
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [commentDraft, setCommentDraft] = useState({})

  async function handleDecision(id, decision) {
    setError('')
    setBusyId(id)
    const { error: err } = await supabase.rpc('decide_shs_venue_request', {
      p_request_id: id,
      p_decision: decision,
      p_comment: commentDraft[id] || null,
    })
    setBusyId(null)
    if (err) {
      setError(err.message || 'Could not record that decision. Please try again.')
      return
    }
    onChanged()
  }

  async function handleCancel(id) {
    setError('')
    setBusyId(id)
    const { error: err } = await supabase.rpc('cancel_shs_venue_request', { p_request_id: id })
    setBusyId(null)
    if (err) {
      setError(err.message || 'Could not cancel that request. Please try again.')
      return
    }
    onChanged()
  }

  if (requests.length === 0) {
    return <div className="vr-empty">No venue requests here yet.</div>
  }

  return (
    <div className="vr-list">
      {error && <div className="vr-error"><AlertCircle size={14} /> {error}</div>}
      {requests.map((r) => {
        const meta = STATUS_META[r.status] || { label: r.status, tone: 'muted' }
        const canDecide = isReviewer && r.status === reviewStage
        const canCancel = (isFaculty && r.requester_id === profile?.id && ['pending_sdao_shs', 'pending_principal', 'approved'].includes(r.status))
          || (isReviewer && ['pending_sdao_shs', 'pending_principal', 'approved'].includes(r.status))
        return (
          <div key={r.id} className="vr-row">
            <div className="vr-row__main">
              <div className="vr-row__top">
                <span className="vr-row__room"><Building2 size={13} /> {r.shs_classrooms?.name || '—'}</span>
                <span className={`vr-badge vr-badge--${meta.tone}`}>{meta.label}</span>
              </div>
              <div className="vr-row__meta">
                <span><CalendarIcon size={12} /> {r.request_date}</span>
                <span><Clock size={12} /> {formatTime(r.start_time)}–{formatTime(r.end_time)}</span>
                {!isFaculty && <span><User size={12} /> {r.profiles?.full_name || 'Faculty'}</span>}
              </div>
              <p className="vr-row__purpose">{r.purpose}</p>
              {(r.sdao_shs_comment || r.principal_comment) && (
                <div className="vr-row__comments">
                  {r.sdao_shs_comment && <p><MessageSquare size={11} /> SDAO-SHS: {r.sdao_shs_comment}</p>}
                  {r.principal_comment && <p><MessageSquare size={11} /> Principal: {r.principal_comment}</p>}
                </div>
              )}
            </div>

            <div className="vr-row__actions">
              {canDecide && (
                <>
                  <input
                    className="vr-comment-input"
                    placeholder="Comment (optional)"
                    value={commentDraft[r.id] || ''}
                    onChange={(e) => setCommentDraft({ ...commentDraft, [r.id]: e.target.value })}
                  />
                  <button
                    className="vr-icon-btn vr-icon-btn--ok"
                    disabled={busyId === r.id}
                    onClick={() => handleDecision(r.id, 'approved')}
                    title="Approve"
                  >
                    {busyId === r.id ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                  </button>
                  <button
                    className="vr-icon-btn vr-icon-btn--danger"
                    disabled={busyId === r.id}
                    onClick={() => handleDecision(r.id, 'rejected')}
                    title="Reject"
                  >
                    <X size={13} />
                  </button>
                </>
              )}
              {canCancel && !canDecide && (
                <button
                  className="vr-icon-btn"
                  disabled={busyId === r.id}
                  onClick={() => handleCancel(r.id)}
                  title="Cancel request"
                >
                  {busyId === r.id ? <Loader2 size={13} className="spin" /> : <Ban size={13} />}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ManageClassroomsSection({ classrooms, onChanged }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [busyId, setBusyId] = useState(null)

  async function handleAdd(e) {
    e.preventDefault()
    setError('')
    if (!name.trim()) return
    setSaving(true)
    const { error: err } = await supabase.from('shs_classrooms').insert({
      name: name.trim(),
      sort_order: classrooms.length + 1,
    })
    setSaving(false)
    if (err) {
      setError(err.message?.includes('duplicate') ? 'That classroom already exists.' : 'Could not add the classroom.')
      return
    }
    setName('')
    onChanged()
  }

  async function handleRename(id) {
    if (!editName.trim()) return
    setBusyId(id)
    const { error: err } = await supabase.from('shs_classrooms').update({ name: editName.trim() }).eq('id', id)
    setBusyId(null)
    if (err) {
      setError('Could not rename the classroom.')
      return
    }
    setEditingId(null)
    onChanged()
  }

  async function handleToggleActive(c) {
    setBusyId(c.id)
    const { error: err } = await supabase.from('shs_classrooms').update({ is_active: !c.is_active }).eq('id', c.id)
    setBusyId(null)
    if (err) {
      setError('Could not update the classroom.')
      return
    }
    onChanged()
  }

  return (
    <div className="vr-card">
      <span className="vr-card__label"><Building2 size={13} /> SHS Classrooms</span>
      <p className="vr-card__sub">
        Rooms Faculty may Venue Request. Deactivate a room instead of deleting it if it has past bookings.
      </p>
      {error && <div className="vr-form-error"><AlertCircle size={13} /> {error}</div>}

      <form className="vr-add-room-form" onSubmit={handleAdd}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. 109 or Advising Room 3"
        />
        <button className="vr-btn vr-btn--gold" type="submit" disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : <><Plus size={13} /> Add</>}
        </button>
      </form>

      <div className="vr-room-list">
        {classrooms.map((c) => (
          <div key={c.id} className={`vr-room-row ${!c.is_active ? 'vr-room-row--inactive' : ''}`}>
            {editingId === c.id ? (
              <>
                <input className="vr-room-row__edit" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                <button className="vr-icon-btn vr-icon-btn--ok" onClick={() => handleRename(c.id)} disabled={busyId === c.id}>
                  {busyId === c.id ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                </button>
                <button className="vr-icon-btn" onClick={() => setEditingId(null)}><X size={13} /></button>
              </>
            ) : (
              <>
                <span className="vr-room-row__name">{c.name}{!c.is_active && <span className="vr-optional"> (inactive)</span>}</span>
                <button className="vr-icon-btn" onClick={() => { setEditingId(c.id); setEditName(c.name) }} title="Rename">
                  <Pencil size={13} />
                </button>
                <button
                  className="vr-icon-btn"
                  onClick={() => handleToggleActive(c)}
                  disabled={busyId === c.id}
                  title={c.is_active ? 'Deactivate' : 'Reactivate'}
                >
                  {busyId === c.id ? <Loader2 size={13} className="spin" /> : (c.is_active ? <Ban size={13} /> : <RotateCcw size={13} />)}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
