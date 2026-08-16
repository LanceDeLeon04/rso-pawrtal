import { useEffect, useState } from 'react'
import {
  Settings as SettingsIcon, User, Camera, Lock, Users, Pencil, Check, X,
  Loader2, AlertCircle, CheckCircle2, UserCheck, UserX, Building2, FlaskConical, Plus, Trash2,
  Bell, BellOff, BellRing, MessageSquarePlus, MessageSquare, Star, Mail, RefreshCw, CalendarClock,
  KeyRound, Eye, EyeOff, Shuffle, GraduationCap, Megaphone, Leaf,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier } from '../context/AuthContext'
import ImageCropModal from '../components/ImageCropModal'
import {
  isPushSupported, getPermissionState, isSubscribed, subscribeToPush, unsubscribeFromPush,
} from '../lib/pushNotifications'
import './Settings.css'

// Rooms/labs can be maintained by SDAO, Facilities (FMO), and Admin —
// same role set used across the app for venue_blocks/restricted_periods.
const VENUE_MANAGER_ROLES = [
  'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor', 'academic_director', 'system_admin', 'fmo',
]

// Only SDAO (assistant/supervisor) and System Admin can toggle
// portal-wide feature flags such as Merchandise Proposal submission.
const SDAO_ADMIN_ROLES = ['sdao_assistant', 'sdao_supervisor', 'system_admin']

export default function Settings() {
  const { profile, completePasswordChange, refreshProfile, updateRecoveryEmail } = useAuth()
  const admin = isAdminTier(profile?.role)
  const canManageVenues = VENUE_MANAGER_ROLES.includes(profile?.role)
  const canManageFeatureFlags = SDAO_ADMIN_ROLES.includes(profile?.role)

  return (
    <div className="set-page">
      <div className="set-header">
        <h2 className="set-header__title"><SettingsIcon size={17} color="var(--nu-blue-700)" /> Settings</h2>
      </div>

      <ProfileSection profile={profile} refreshProfile={refreshProfile} />
      <RecoveryEmailSection profile={profile} updateRecoveryEmail={updateRecoveryEmail} refreshProfile={refreshProfile} />
      <NotificationsSection profileId={profile?.id} />
      <PasswordSection completePasswordChange={completePasswordChange} />
      {canManageFeatureFlags && <FeatureFlagsSection />}
      {canManageFeatureFlags && <RenewalPolicySection />}
      {canManageFeatureFlags && <ExternalApproverPinsSection />}
      {canManageVenues && <VenueRoomsAndLabsSection />}
      {admin && <UserManagementSection currentProfileId={profile?.id} />}
      <FeedbackSection profile={profile} />
      {admin && <AdminFeedbackSection />}
    </div>
  )
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Lets a signed-in user set/update the Gmail address that receives their
// password-reset OTP codes (see send-password-reset-otp Edge Function).
// Also the same field the mandatory first-login gate
// (AddRecoveryEmail.jsx) writes to — this just lets it be changed later.
function RecoveryEmailSection({ profile, updateRecoveryEmail, refreshProfile }) {
  const [email, setEmail] = useState(profile?.recovery_email || '')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { setEmail(profile?.recovery_email || '') }, [profile?.recovery_email])

  async function handleSave(e) {
    e.preventDefault()
    setMsg('')
    if (!EMAIL_RE.test(email.trim())) {
      setMsg('error')
      return
    }
    setSaving(true)
    const { error } = await updateRecoveryEmail(email.trim())
    setSaving(false)
    if (error) {
      setMsg('error')
      return
    }
    setMsg('ok')
    setEditing(false)
    await refreshProfile()
  }

  return (
    <div className="set-card">
      <span className="set-card__label"><Mail size={13} /> Recovery Gmail</span>
      <p className="set-card__sub" style={{ marginTop: -4, marginBottom: 12, color: 'var(--nu-gray-500, #64748b)', fontSize: 13 }}>
        Used to send you a verification code if you ever need to reset your password yourself, from the Sign in screen.
      </p>

      {!editing ? (
        <div className="set-photo-row" style={{ justifyContent: 'space-between' }}>
          <span className="set-photo-row__email">
            {profile?.recovery_email || 'No Gmail on file'}
          </span>
          <button type="button" className="set-icon-btn" onClick={() => setEditing(true)} title="Edit">
            <Pencil size={14} />
          </button>
        </div>
      ) : (
        <form className="set-name-form" onSubmit={handleSave}>
          <label className="set-field">
            Gmail address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="yourname@gmail.com"
              required
            />
          </label>
          <div className="set-row-actions">
            <button className="set-btn set-btn--gold" type="submit" disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Save
            </button>
            <button
              type="button"
              className="set-btn set-btn--outline"
              onClick={() => { setEditing(false); setEmail(profile?.recovery_email || ''); setMsg('') }}
            >
              <X size={14} /> Cancel
            </button>
          </div>
        </form>
      )}

      {msg === 'ok' && <div className="set-success"><CheckCircle2 size={13} /> Saved.</div>}
      {msg === 'error' && <div className="set-error"><AlertCircle size={13} /> Enter a valid email address.</div>}
    </div>
  )
}

function NotificationsSection({ profileId }) {
  const supported = isPushSupported()
  const [permission, setPermission] = useState(getPermissionState())
  const [subscribed, setSubscribed] = useState(false)
  const [checking, setChecking] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supported) { setChecking(false); return }
    isSubscribed().then((v) => { setSubscribed(v); setChecking(false) })
  }, [])

  async function handleEnable() {
    setError('')
    setWorking(true)
    const res = await subscribeToPush(profileId)
    setWorking(false)
    setPermission(getPermissionState())
    if (res.ok) {
      setSubscribed(true)
    } else if (res.reason === 'denied') {
      setError('Notifications are blocked for this site in your browser. Enable them in your browser\'s site settings, then try again.')
    } else if (res.reason === 'not-configured') {
      setError('Push notifications aren\'t configured for this deployment yet.')
    } else {
      setError('Could not enable notifications. Please try again.')
    }
  }

  async function handleDisable() {
    setError('')
    setWorking(true)
    await unsubscribeFromPush()
    setWorking(false)
    setSubscribed(false)
  }

  return (
    <div className="set-card">
      <span className="set-card__label"><Bell size={13} /> Desktop &amp; Phone Notifications</span>
      <div className="set-toggle-row">
        <div>
          <strong>Push Notifications</strong>
          <p className="set-toggle-row__hint">
            {subscribed
              ? 'Enabled on this browser/device — you\'ll get a popup notification here the moment a submission needs your action or its status changes, even if RSO Pawrtal isn\'t open. Email notifications keep sending too.'
              : 'Get a real popup notification on this browser/device — desktop or phone — the moment a submission needs your action or its status changes, in addition to email. You\'ll need to allow notifications when your browser asks.'}
          </p>
        </div>
        {!supported ? (
          <span className="set-toggle-row__hint"><BellOff size={13} /> Not supported in this browser</span>
        ) : checking ? (
          <Loader2 size={16} className="spin" />
        ) : subscribed ? (
          <button type="button" className="set-btn set-btn--outline" onClick={handleDisable} disabled={working}>
            {working ? <Loader2 size={13} className="spin" /> : <BellOff size={13} />} Turn off
          </button>
        ) : (
          <button type="button" className="set-btn set-btn--gold" onClick={handleEnable} disabled={working || permission === 'denied'}>
            {working ? <Loader2 size={13} className="spin" /> : <BellRing size={13} />} Enable
          </button>
        )}
      </div>
      {error && <div className="set-error"><AlertCircle size={13} /> {error}</div>}
    </div>
  )
}

function FeatureFlagsSection() {
  const [loading, setLoading] = useState(true)
  const [allowMerch, setAllowMerch] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'allow_merchandise_submission').single()
    setAllowMerch(!!data?.value)
    setLoading(false)
  }

  async function toggle() {
    const next = !allowMerch
    setSaving(true)
    setAllowMerch(next)
    const { error } = await supabase.from('app_settings')
      .update({ value: next, updated_at: new Date().toISOString() })
      .eq('key', 'allow_merchandise_submission')
    setSaving(false)
    if (error) setAllowMerch(!next)
  }

  return (
    <section className="set-section">
      <div className="set-card">
      <span className="set-card__label"><SettingsIcon size={13} /> Feature Toggles</span>
      <div className="set-toggle-row">
        <div>
          <strong>Allow Merchandise Submission</strong>
          <p className="set-toggle-row__hint">
            When enabled, RSO officers can submit a Merchandise Proposal from Submission Bin. When disabled, the
            button is hidden and not available for new submissions.
          </p>
        </div>
        <button
          type="button"
          className={`set-switch ${allowMerch ? 'set-switch--on' : ''}`}
          onClick={toggle}
          disabled={loading || saving}
          aria-pressed={allowMerch}
        >
          <span className="set-switch__knob" />
        </button>
      </div>
      </div>
    </section>
  )
}

// SDAO opens/manages RSO Renewal for the current academic year:
// setting it "open" auto-assigns a renewal to every org's President
// (see open_org_renewal in migration 070), and SDAO can set/extend the
// submission deadline and choose whether Constitution & By-Laws can be
// declared via checkbox instead of a fresh upload each year.
function RenewalPolicySection() {
  const [loading, setLoading] = useState(true)
  const [ay, setAy] = useState(null)
  const [settings, setSettings] = useState(null)
  const [deadline, setDeadline] = useState('')
  const [allowBylaws, setAllowBylaws] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError('')
    const { data: currentAy } = await supabase.from('academic_years').select('*').eq('is_current', true).maybeSingle()
    setAy(currentAy || null)
    if (currentAy) {
      const { data: rs } = await supabase.from('renewal_settings').select('*').eq('academic_year_id', currentAy.id).maybeSingle()
      setSettings(rs || null)
      setDeadline(rs?.deadline || '')
      setAllowBylaws(!!rs?.allow_bylaws_checkbox)
    } else {
      setSettings(null)
    }
    setLoading(false)
  }

  async function handleOpen() {
    if (!ay) return
    setError(''); setMsg(''); setSaving(true)
    const { error: err } = await supabase.rpc('open_org_renewal', {
      p_academic_year_id: ay.id,
      p_deadline: deadline || null,
      p_allow_bylaws_checkbox: allowBylaws,
    })
    setSaving(false)
    if (err) { setError(err.message || 'Could not open renewal.'); return }
    setMsg('Renewal is open — every org\'s President has been assigned their renewal requirements.')
    load()
  }

  async function handleSaveDeadline() {
    if (!ay) return
    setError(''); setMsg(''); setSaving(true)
    const { error: err } = await supabase.rpc('update_org_renewal_deadline', {
      p_academic_year_id: ay.id,
      p_deadline: deadline || null,
      p_allow_bylaws_checkbox: allowBylaws,
    })
    setSaving(false)
    if (err) { setError(err.message || 'Could not update the deadline.'); return }
    setMsg('Deadline updated.')
    load()
  }

  async function handleClose() {
    if (!ay) return
    setError(''); setMsg(''); setSaving(true)
    const { error: err } = await supabase.rpc('close_org_renewal', { p_academic_year_id: ay.id })
    setSaving(false)
    if (err) { setError(err.message || 'Could not close renewal.'); return }
    setMsg('Renewal closed to new submissions. Renewals already submitted keep moving through review.')
    load()
  }

  return (
    <section className="set-section">
      <div className="set-card">
        <span className="set-card__label"><CalendarClock size={13} /> RSO Renewal Policy</span>

        {loading ? (
          <div className="set-toggle-row__hint"><Loader2 size={13} className="spin" /> Loading...</div>
        ) : !ay ? (
          <p className="set-toggle-row__hint">Set a current Academic Year first (Calendar of Activities → Academic Year &amp; Terms) before opening renewal.</p>
        ) : (
          <>
            <p className="set-toggle-row__hint" style={{ marginTop: -4, marginBottom: 12 }}>
              For <strong>{ay.label}</strong>. Opening renewal auto-assigns every org's President to submit their
              renewal requirements, with an approval tracker through SDAO Assistant → SDAO Supervisor → Academic Director.
            </p>

            <div className="set-toggle-row">
              <div>
                <strong>Renewal Status</strong>
                <p className="set-toggle-row__hint">
                  {settings?.is_open ? 'Open — Presidents can submit renewal requirements.' : 'Not open yet.'}
                </p>
              </div>
              <span className={`set-switch ${settings?.is_open ? 'set-switch--on' : ''}`} aria-pressed={!!settings?.is_open}>
                <span className="set-switch__knob" />
              </span>
            </div>

            <div className="set-name-form" style={{ marginTop: 10 }}>
              <label className="set-field">
                Submission Deadline
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </label>
              <label className="set-toggle-row" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={allowBylaws} onChange={(e) => setAllowBylaws(e.target.checked)} style={{ width: 16, height: 16 }} />
                <div>
                  <strong>Allow Constitution &amp; By-Laws checkbox</strong>
                  <p className="set-toggle-row__hint">Let a President declare "on file, no changes" instead of re-uploading the document.</p>
                </div>
              </label>
            </div>

            {error && <div className="set-error"><AlertCircle size={13} /> {error}</div>}
            {msg && <div className="set-success"><CheckCircle2 size={13} /> {msg}</div>}

            <div className="set-row-actions" style={{ marginTop: 10 }}>
              {!settings?.is_open ? (
                <button className="set-btn set-btn--gold" onClick={handleOpen} disabled={saving}>
                  {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Open Renewal
                </button>
              ) : (
                <>
                  <button className="set-btn set-btn--outline" onClick={handleSaveDeadline} disabled={saving}>
                    {saving ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Update Deadline
                  </button>
                  <button className="set-btn set-btn--outline" onClick={handleClose} disabled={saving}>
                    <X size={14} /> Close to New Submissions
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

// SDAO/Admin assign a hidden 4-digit security PIN per external
// approver (Adviser per org, the 4 fixed Deans, the 4 fixed SDG
// Representatives, and a free-form Marketing roster). Everything here
// lives behind a click-to-open modal — never shown inline on the
// Settings page itself — and each PIN field is password-type with a
// show/hide toggle, per spec.
const APPROVER_TABS = [
  { role: 'adviser', label: 'Advisers', icon: Users },
  { role: 'dean', label: 'Deans', icon: GraduationCap },
  { role: 'sdg_rep', label: 'SDG Representatives', icon: Leaf },
  { role: 'marketing_rep', label: 'Marketing', icon: Megaphone },
]

function ExternalApproverPinsSection() {
  const [open, setOpen] = useState(false)
  return (
    <section className="set-section">
      <div className="set-card">
        <span className="set-card__label"><KeyRound size={13} /> External Approver Security PINs</span>
        <p className="set-toggle-row__hint" style={{ marginTop: -4, marginBottom: 12 }}>
          Assign a hidden 4-digit PIN to each Adviser, Dean, SDG Representative, and Marketing reviewer.
          They must enter it, on top of their emailed link, before an approval is accepted.
        </p>
        <button className="set-btn set-btn--gold" onClick={() => setOpen(true)}>
          <KeyRound size={14} /> Manage External Approver PINs
        </button>
      </div>
      {open && <ExternalApproverPinsModal onClose={() => setOpen(false)} />}
    </section>
  )
}

function ExternalApproverPinsModal({ onClose }) {
  const [tab, setTab] = useState('adviser')
  const [rows, setRows] = useState([])
  const [orgsById, setOrgsById] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    setError('')
    const [{ data: approvers, error: aErr }, { data: orgs }] = await Promise.all([
      supabase.from('external_approvers').select('*').eq('is_active', true).order('person_name'),
      supabase.from('organizations').select('id, name, acronym'),
    ])
    if (aErr) setError('Could not load the approver roster.')
    setRows(approvers || [])
    setOrgsById(Object.fromEntries((orgs || []).map((o) => [o.id, o])))
    setLoading(false)
  }

  const rowsForTab = rows.filter((r) => r.role === tab)

  return (
    <div className="set-modal-backdrop" onClick={onClose}>
      <div className="set-modal" onClick={(e) => e.stopPropagation()}>
        <button className="set-modal__close" onClick={onClose}><X size={18} /></button>
        <h3 className="set-modal__title"><KeyRound size={16} /> External Approver Security PINs</h3>

        <div className="set-approver-tabs">
          {APPROVER_TABS.map((t) => (
            <button
              key={t.role}
              className={`set-approver-tab ${tab === t.role ? 'set-approver-tab--active' : ''}`}
              onClick={() => setTab(t.role)}
            >
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>

        {error && <div className="set-error"><AlertCircle size={13} /> {error}</div>}

        {loading ? (
          <div className="set-toggle-row__hint"><Loader2 size={13} className="spin" /> Loading...</div>
        ) : (
          <div className="set-approver-list">
            {rowsForTab.length === 0 && <p className="set-toggle-row__hint">No entries yet.</p>}
            {rowsForTab.map((row) => (
              <ApproverRow
                key={row.id}
                row={row}
                orgLabel={row.org_id ? (orgsById[row.org_id]?.acronym || orgsById[row.org_id]?.name) : null}
                showSchool={tab === 'dean'}
                onChanged={load}
              />
            ))}
            {tab !== 'adviser' && (
              <AddApproverForm role={tab} showSchool={tab === 'dean'} onAdded={load} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ApproverRow({ row, orgLabel, showSchool, onChanged }) {
  const [name, setName] = useState(row.person_name)
  const [school, setSchool] = useState(row.school || '')
  const [pin, setPin] = useState(row.pin || '')
  const [pinVisible, setPinVisible] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function saveDetails() {
    setError(''); setBusy('details')
    const { error: err } = await supabase.rpc('update_external_approver', {
      p_id: row.id, p_person_name: name, p_school: showSchool ? school : null,
    })
    setBusy('')
    if (err) { setError(err.message || 'Could not save.'); return }
    onChanged()
  }

  async function savePin() {
    setError('')
    if (pin && !/^[0-9]{4}$/.test(pin)) { setError('PIN must be exactly 4 digits.'); return }
    setBusy('pin')
    const { error: err } = await supabase.rpc('set_external_approver_pin', { p_id: row.id, p_pin: pin || null })
    setBusy('')
    if (err) { setError(err.message || 'Could not save the PIN.'); return }
    onChanged()
  }

  async function generatePin() {
    setError(''); setBusy('generate')
    const { data, error: err } = await supabase.rpc('generate_external_approver_pin', { p_id: row.id })
    setBusy('')
    if (err) { setError(err.message || 'Could not generate a PIN.'); return }
    setPin(data)
    setPinVisible(true)
  }

  async function remove() {
    if (!window.confirm(`Remove ${row.person_name}?`)) return
    setError(''); setBusy('remove')
    const { error: err } = await supabase.rpc('remove_external_approver', { p_id: row.id })
    setBusy('')
    if (err) { setError(err.message || 'Could not remove this entry.'); return }
    onChanged()
  }

  return (
    <div className="set-approver-row">
      {orgLabel && <span className="set-approver-row__org">{orgLabel}</span>}
      <div className="set-approver-row__fields">
        <input className="set-approver-row__name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        {showSchool && (
          <input className="set-approver-row__school" value={school} onChange={(e) => setSchool(e.target.value)} placeholder="School" />
        )}
        <button className="set-icon-btn" title="Save name" disabled={busy === 'details'} onClick={saveDetails}>
          {busy === 'details' ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
        </button>
      </div>
      <div className="set-approver-row__pin">
        <div className="set-approver-row__pin-input">
          <input
            type={pinVisible ? 'text' : 'password'}
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <button type="button" onClick={() => setPinVisible((v) => !v)} title={pinVisible ? 'Hide' : 'Show'}>
            {pinVisible ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        <button className="set-btn set-btn--outline set-btn--small" disabled={busy === 'pin'} onClick={savePin}>
          {busy === 'pin' ? <Loader2 size={12} className="spin" /> : 'Save'}
        </button>
        <button className="set-btn set-btn--outline set-btn--small" disabled={busy === 'generate'} onClick={generatePin} title="Auto-generate">
          {busy === 'generate' ? <Loader2 size={12} className="spin" /> : <Shuffle size={12} />}
        </button>
        {row.role !== 'adviser' && (
          <button className="set-icon-btn set-icon-btn--danger" title="Remove" disabled={busy === 'remove'} onClick={remove}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {error && <div className="set-error" style={{ marginTop: 4 }}><AlertCircle size={12} /> {error}</div>}
    </div>
  )
}

function AddApproverForm({ role, showSchool, onAdded }) {
  const [name, setName] = useState('')
  const [school, setSchool] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function add() {
    setError('')
    if (!name.trim()) { setError('Please enter a name.'); return }
    setBusy(true)
    const { error: err } = await supabase.rpc('add_external_approver', {
      p_role: role, p_person_name: name.trim(), p_school: showSchool ? (school.trim() || null) : null, p_org_id: null,
    })
    setBusy(false)
    if (err) { setError(err.message || 'Could not add this entry.'); return }
    setName(''); setSchool('')
    onAdded()
  }

  return (
    <div className="set-approver-add">
      <input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
      {showSchool && <input placeholder="School" value={school} onChange={(e) => setSchool(e.target.value)} />}
      <button className="set-btn set-btn--outline set-btn--small" disabled={busy} onClick={add}>
        {busy ? <Loader2 size={12} className="spin" /> : <Plus size={12} />} Add
      </button>
      {error && <div className="set-error" style={{ marginTop: 4 }}><AlertCircle size={12} /> {error}</div>}
    </div>
  )
}

function ProfileSection({ profile, refreshProfile }) {
  const [name, setName] = useState(profile?.full_name || '')
  const [savingName, setSavingName] = useState(false)
  const [nameMsg, setNameMsg] = useState('')

  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [pendingPhotoFile, setPendingPhotoFile] = useState(null)

  useEffect(() => { setName(profile?.full_name || '') }, [profile?.full_name])

  async function handleSaveName(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSavingName(true)
    setNameMsg('')
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', profile.id)
    setSavingName(false)
    if (error) {
      setNameMsg('error')
    } else {
      setNameMsg('ok')
      await refreshProfile()
    }
  }

  function handlePhotoPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoError('')
    // Don't upload yet — let the person zoom/reposition first.
    setPendingPhotoFile(file)
  }

  async function handlePhotoConfirm(croppedFile) {
    setUploading(true)
    const ext = croppedFile.name.split('.').pop()
    const path = `${profile.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, croppedFile, { upsert: true })
    if (upErr) {
      setUploading(false)
      setPhotoError('Could not upload photo. Please try again.')
      setPendingPhotoFile(null)
      return
    }
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
    const { error: dbErr } = await supabase.from('profiles').update({ photo_url: pub.publicUrl }).eq('id', profile.id)

    setUploading(false)
    setPendingPhotoFile(null)
    if (dbErr) {
      setPhotoError('Photo uploaded, but saving it to your profile failed.')
      return
    }
    await refreshProfile()
  }

  return (
    <div className="set-card">
      <span className="set-card__label"><User size={13} /> My Profile</span>

      <div className="set-photo-row">
        <div className="set-avatar">
          {profile?.photo_url ? <img src={profile.photo_url} alt="" /> : <User size={26} />}
          <label className="set-avatar__edit">
            <Camera size={13} />
            <input type="file" accept="image/*" onChange={handlePhotoPick} hidden />
          </label>
        </div>
        <div>
          <span className="set-photo-row__name">{profile?.full_name}</span>
          <span className="set-photo-row__email">{profile?.email}</span>
        </div>
      </div>

      {pendingPhotoFile && (
        <ImageCropModal
          file={pendingPhotoFile}
          uploading={uploading}
          onCancel={() => setPendingPhotoFile(null)}
          onConfirm={handlePhotoConfirm}
        />
      )}

      {photoError && <div className="set-error"><AlertCircle size={13} /> {photoError}</div>}

      <form className="set-name-form" onSubmit={handleSaveName}>
        <label className="set-field">
          Display Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button className="set-btn set-btn--gold" type="submit" disabled={savingName || name.trim() === profile?.full_name}>
          {savingName ? <Loader2 size={14} className="spin" /> : 'Save'}
        </button>
      </form>
      {nameMsg === 'ok' && <div className="set-success"><CheckCircle2 size={13} /> Name updated.</div>}
      {nameMsg === 'error' && <div className="set-error"><AlertCircle size={13} /> Could not update your name.</div>}
    </div>
  )
}

function PasswordSection({ completePasswordChange }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess(false)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    const { error: err } = await completePasswordChange(password)
    setSubmitting(false)

    if (err) {
      setError('Could not update your password. Please try again.')
      return
    }
    setSuccess(true)
    setPassword('')
    setConfirm('')
  }

  return (
    <div className="set-card">
      <span className="set-card__label"><Lock size={13} /> Change Password</span>

      <form className="set-password-form" onSubmit={handleSubmit}>
        {error && <div className="set-error"><AlertCircle size={13} /> {error}</div>}
        {success && <div className="set-success"><CheckCircle2 size={13} /> Password updated.</div>}

        <div className="set-field-row">
          <label className="set-field">
            New Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" required />
          </label>
          <label className="set-field">
            Confirm New Password
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
        </div>

        <button className="set-btn set-btn--gold" type="submit" disabled={submitting}>
          {submitting ? <Loader2 size={14} className="spin" /> : 'Update Password'}
        </button>
      </form>
    </div>
  )
}

const EMPTY_ROOM_FORM = { building: '', floor: '', room_number: '' }
const EMPTY_LAB_FORM = { name: '', care_of: '', location: '' }

// Lets SDAO/Facilities/Admin maintain the Building -> Floor -> Room and
// Laboratory picklists used on the Event Application form (SubmissionBin).
function VenueRoomsAndLabsSection() {
  const [tab, setTab] = useState('rooms')
  const [rooms, setRooms] = useState([])
  const [labs, setLabs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [roomForm, setRoomForm] = useState(EMPTY_ROOM_FORM)
  const [labForm, setLabForm] = useState(EMPTY_LAB_FORM)
  const [editingRoomId, setEditingRoomId] = useState(null)
  const [editingLabId, setEditingLabId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    setError('')
    const [{ data: r, error: rErr }, { data: l, error: lErr }] = await Promise.all([
      supabase.from('venue_rooms').select('id, building, floor, room_number').order('building').order('floor').order('sort_order'),
      supabase.from('venue_labs').select('id, name, care_of, location').order('sort_order'),
    ])
    if (rErr || lErr) setError('Could not load rooms/labs.')
    setRooms(r || [])
    setLabs(l || [])
    setLoading(false)
  }

  function startEditRoom(r) {
    setEditingRoomId(r.id)
    setRoomForm({ building: r.building, floor: r.floor, room_number: r.room_number })
  }
  function startEditLab(l) {
    setEditingLabId(l.id)
    setLabForm({ name: l.name, care_of: l.care_of, location: l.location })
  }
  function cancelRoomEdit() {
    setEditingRoomId(null)
    setRoomForm(EMPTY_ROOM_FORM)
  }
  function cancelLabEdit() {
    setEditingLabId(null)
    setLabForm(EMPTY_LAB_FORM)
  }

  async function submitRoom(e) {
    e.preventDefault()
    if (!roomForm.building.trim() || !roomForm.floor.trim() || !roomForm.room_number.trim()) return
    setSaving(true)
    setError('')
    const payload = {
      building: roomForm.building.trim(),
      floor: roomForm.floor.trim(),
      room_number: roomForm.room_number.trim(),
    }
    const { error: err } = editingRoomId
      ? await supabase.from('venue_rooms').update(payload).eq('id', editingRoomId)
      : await supabase.from('venue_rooms').insert(payload)
    setSaving(false)
    if (err) {
      setError(err.code === '23505' ? 'That room already exists.' : 'Could not save that room.')
      return
    }
    cancelRoomEdit()
    loadAll()
  }

  async function submitLab(e) {
    e.preventDefault()
    if (!labForm.name.trim() || !labForm.care_of.trim() || !labForm.location.trim()) return
    setSaving(true)
    setError('')
    const payload = {
      name: labForm.name.trim(),
      care_of: labForm.care_of.trim(),
      location: labForm.location.trim(),
    }
    const { error: err } = editingLabId
      ? await supabase.from('venue_labs').update(payload).eq('id', editingLabId)
      : await supabase.from('venue_labs').insert(payload)
    setSaving(false)
    if (err) {
      setError(err.code === '23505' ? 'A laboratory with that name already exists.' : 'Could not save that laboratory.')
      return
    }
    cancelLabEdit()
    loadAll()
  }

  async function deleteRoom(id) {
    setDeletingId(id)
    const { error: err } = await supabase.from('venue_rooms').delete().eq('id', id)
    setDeletingId(null)
    setConfirmDeleteId(null)
    if (err) {
      setError('Could not delete that room.')
      return
    }
    setRooms((prev) => prev.filter((r) => r.id !== id))
  }

  async function deleteLab(id) {
    setDeletingId(id)
    const { error: err } = await supabase.from('venue_labs').delete().eq('id', id)
    setDeletingId(null)
    setConfirmDeleteId(null)
    if (err) {
      setError('Could not delete that laboratory.')
      return
    }
    setLabs((prev) => prev.filter((l) => l.id !== id))
  }

  return (
    <div className="set-card set-card--wide">
      <span className="set-card__label"><Building2 size={13} /> Rooms &amp; Laboratories</span>
      <p className="set-card__sub">
        Manage the Building → Floor → Room and Laboratory picklists applicants choose from on the Event Application form.
      </p>

      <div className="set-tabs">
        <button type="button" className={`set-tab ${tab === 'rooms' ? 'set-tab--active' : ''}`} onClick={() => setTab('rooms')}>
          <Building2 size={12} /> Rooms
        </button>
        <button type="button" className={`set-tab ${tab === 'labs' ? 'set-tab--active' : ''}`} onClick={() => setTab('labs')}>
          <FlaskConical size={12} /> Laboratories
        </button>
      </div>

      {error && <div className="set-error"><AlertCircle size={13} /> {error}</div>}

      {loading ? (
        <Loader2 size={18} className="spin" />
      ) : tab === 'rooms' ? (
        <>
          <form className="set-field-row" onSubmit={submitRoom}>
            <label className="set-field">
              Building
              <input value={roomForm.building} onChange={(e) => setRoomForm({ ...roomForm, building: e.target.value })} placeholder="e.g. Henry Sy Sr. (Educ)" required />
            </label>
            <label className="set-field">
              Floor
              <input value={roomForm.floor} onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value })} placeholder="e.g. 3rd" required />
            </label>
            <label className="set-field">
              Room
              <input value={roomForm.room_number} onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })} placeholder="e.g. 305" required />
            </label>
            <div className="set-row-actions">
              <button className="set-btn set-btn--gold" type="submit" disabled={saving}>
                {saving ? <Loader2 size={13} className="spin" /> : editingRoomId ? <Check size={13} /> : <Plus size={13} />}
                {editingRoomId ? 'Save' : 'Add'}
              </button>
              {editingRoomId && (
                <button type="button" className="set-btn set-btn--outline" onClick={cancelRoomEdit}><X size={13} /></button>
              )}
            </div>
          </form>

          <div className="table-scroll">
          <table className="set-table">
            <thead>
              <tr><th>Building</th><th>Floor</th><th>Room</th><th /></tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.id}>
                  <td>{r.building}</td>
                  <td>{r.floor}</td>
                  <td>{r.room_number}</td>
                  <td>
                    <div className="set-row-actions">
                      {confirmDeleteId === r.id ? (
                        <>
                          <button className="set-icon-btn set-icon-btn--ok" onClick={() => deleteRoom(r.id)} disabled={deletingId === r.id} title="Confirm delete">
                            {deletingId === r.id ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                          </button>
                          <button className="set-icon-btn" onClick={() => setConfirmDeleteId(null)} title="Cancel"><X size={13} /></button>
                        </>
                      ) : (
                        <>
                          <button className="set-icon-btn" onClick={() => startEditRoom(r)}><Pencil size={13} /></button>
                          <button className="set-icon-btn set-icon-btn--danger" onClick={() => setConfirmDeleteId(r.id)}><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rooms.length === 0 && <tr><td colSpan={4}>No rooms yet.</td></tr>}
            </tbody>
          </table>
          </div>
        </>
      ) : (
        <>
          <form className="set-field-row" onSubmit={submitLab}>
            <label className="set-field">
              Laboratory Name
              <input value={labForm.name} onChange={(e) => setLabForm({ ...labForm, name: e.target.value })} placeholder="e.g. Physics Laboratory 1" required />
            </label>
            <label className="set-field">
              Care of
              <input value={labForm.care_of} onChange={(e) => setLabForm({ ...labForm, care_of: e.target.value })} placeholder="e.g. School of Arts and Sciences" required />
            </label>
            <label className="set-field">
              Location
              <input value={labForm.location} onChange={(e) => setLabForm({ ...labForm, location: e.target.value })} placeholder="e.g. 2nd Flr, HSSH" required />
            </label>
            <div className="set-row-actions">
              <button className="set-btn set-btn--gold" type="submit" disabled={saving}>
                {saving ? <Loader2 size={13} className="spin" /> : editingLabId ? <Check size={13} /> : <Plus size={13} />}
                {editingLabId ? 'Save' : 'Add'}
              </button>
              {editingLabId && (
                <button type="button" className="set-btn set-btn--outline" onClick={cancelLabEdit}><X size={13} /></button>
              )}
            </div>
          </form>

          <div className="table-scroll">
          <table className="set-table">
            <thead>
              <tr><th>Laboratory</th><th>Care of</th><th>Location</th><th /></tr>
            </thead>
            <tbody>
              {labs.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td>{l.care_of}</td>
                  <td>{l.location}</td>
                  <td>
                    <div className="set-row-actions">
                      {confirmDeleteId === l.id ? (
                        <>
                          <button className="set-icon-btn set-icon-btn--ok" onClick={() => deleteLab(l.id)} disabled={deletingId === l.id} title="Confirm delete">
                            {deletingId === l.id ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                          </button>
                          <button className="set-icon-btn" onClick={() => setConfirmDeleteId(null)} title="Cancel"><X size={13} /></button>
                        </>
                      ) : (
                        <>
                          <button className="set-icon-btn" onClick={() => startEditLab(l)}><Pencil size={13} /></button>
                          <button className="set-icon-btn set-icon-btn--danger" onClick={() => setConfirmDeleteId(l.id)}><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {labs.length === 0 && <tr><td colSpan={4}>No laboratories yet.</td></tr>}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  )
}

function UserManagementSection({ currentProfileId }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [togglingId, setTogglingId] = useState(null)

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, is_active, org_memberships ( organizations ( acronym ) )')
      .order('full_name')

    if (err) {
      setError('Could not load user accounts.')
      setUsers([])
    } else {
      setUsers(data || [])
    }
    setLoading(false)
  }

  function startEdit(u) {
    setEditingId(u.id)
    setEditName(u.full_name)
  }

  async function saveEdit(id) {
    if (!editName.trim()) return
    setSavingId(id)
    const { error: err } = await supabase.from('profiles').update({ full_name: editName.trim() }).eq('id', id)
    setSavingId(null)
    if (!err) {
      setUsers(users.map((u) => (u.id === id ? { ...u, full_name: editName.trim() } : u)))
      setEditingId(null)
    }
  }

  async function toggleActive(u) {
    setTogglingId(u.id)
    const { error: err } = await supabase.from('profiles').update({ is_active: !u.is_active }).eq('id', u.id)
    setTogglingId(null)
    if (!err) {
      setUsers(users.map((x) => (x.id === u.id ? { ...x, is_active: !u.is_active } : x)))
    }
  }

  return (
    <div className="set-card set-card--wide">
      <span className="set-card__label"><Users size={13} /> Manage User Accounts</span>
      <p className="set-card__sub">
        Correct any account's display name, or deactivate one to immediately block that person from signing in.
      </p>

      {error && <div className="set-error"><AlertCircle size={13} /> {error}</div>}

      {loading ? (
        <Loader2 size={18} className="spin" />
      ) : (
        <div className="table-scroll">
        <table className="set-table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Org</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {editingId === u.id ? (
                    <input className="set-inline-input" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                  ) : (
                    <span className="set-table__name">
                      {u.full_name}
                      {u.id === currentProfileId && <span className="set-you-tag">you</span>}
                    </span>
                  )}
                </td>
                <td>{u.email}</td>
                <td>{u.role.replace(/_/g, ' ')}</td>
                <td>{u.org_memberships?.map((m) => m.organizations?.acronym).filter(Boolean).join(', ') || '—'}</td>
                <td>
                  <button
                    className={`set-status-badge set-status-badge--${u.is_active ? 'active' : 'inactive'}`}
                    onClick={() => toggleActive(u)}
                    disabled={togglingId === u.id || u.id === currentProfileId}
                    title={u.id === currentProfileId ? "You can't deactivate your own account" : u.is_active ? 'Click to deactivate' : 'Click to reactivate'}
                  >
                    {togglingId === u.id ? (
                      <Loader2 size={11} className="spin" />
                    ) : u.is_active ? (
                      <UserCheck size={11} />
                    ) : (
                      <UserX size={11} />
                    )}
                    {u.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td>
                  {editingId === u.id ? (
                    <div className="set-row-actions">
                      <button className="set-icon-btn set-icon-btn--ok" onClick={() => saveEdit(u.id)} disabled={savingId === u.id}>
                        {savingId === u.id ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                      </button>
                      <button className="set-icon-btn" onClick={() => setEditingId(null)}><X size={13} /></button>
                    </div>
                  ) : (
                    <button className="set-icon-btn" onClick={() => startEdit(u)}><Pencil size={13} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}

// ============================================================
// FeedbackSection — any logged-in user can submit general feedback
// about the portal here. Own submissions only (RLS: feedback_insert /
// feedback_select in migration 067).
// ============================================================
function FeedbackSection({ profile }) {
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!message.trim()) return
    setSaving(true)
    setError('')
    const orgId = profile?.org_memberships?.[0]?.org_id || null
    const { error: err } = await supabase.from('feedback').insert({
      profile_id: profile.id,
      org_id: orgId,
      message: message.trim(),
      page_context: 'Settings',
    })
    setSaving(false)
    if (err) {
      setError('Could not send your feedback. Please try again.')
      return
    }
    setMessage('')
    setSent(true)
    setTimeout(() => setSent(false), 4000)
  }

  return (
    <section className="set-section">
      <div className="set-card">
        <span className="set-card__label"><MessageSquarePlus size={13} /> Feedback</span>
        <p className="set-toggle-row__hint">
          Found a bug, or have a suggestion for RSO PAWrtal? Let us know here.
        </p>
        <form className="set-name-form" onSubmit={handleSubmit}>
          <label className="set-field" style={{ flex: 1 }}>
            Your feedback
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us what's working, what's not, or what you'd like to see..."
              required
            />
          </label>
          <button className="set-btn set-btn--gold" type="submit" disabled={saving || !message.trim()}>
            {saving ? <Loader2 size={14} className="spin" /> : 'Send Feedback'}
          </button>
        </form>
        {error && <div className="set-error"><AlertCircle size={13} /> {error}</div>}
        {sent && <div className="set-success"><CheckCircle2 size={13} /> Thanks — your feedback was sent.</div>}
      </div>
    </section>
  )
}

// ============================================================
// AdminFeedbackSection — admin-tier roles only. Lists all submitted
// feedback newest-first, with who sent it and when, and lets an admin
// mark an entry as reviewed.
// ============================================================
function AdminFeedbackSection() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('feedback')
      .select('id, message, status, created_at, page_context, profiles ( full_name ), organizations ( acronym )')
      .order('created_at', { ascending: false })
      .limit(100)
    setItems(data || [])
    setLoading(false)
  }

  async function markReviewed(id) {
    setUpdatingId(id)
    const { error } = await supabase.from('feedback').update({ status: 'reviewed' }).eq('id', id)
    setUpdatingId(null)
    if (!error) setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'reviewed' } : it)))
  }

  return (
    <section className="set-section set-section--full">
      <div className="set-card">
        <span className="set-card__label"><MessageSquare size={13} /> Submitted Feedback</span>
        {loading ? (
          <div className="set-toggle-row__hint"><Loader2 size={13} className="spin" /> Loading...</div>
        ) : items.length === 0 ? (
          <p className="set-toggle-row__hint">No feedback has been submitted yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((it) => (
              <div key={it.id} className="set-toggle-row" style={{ alignItems: 'flex-start' }}>
                <div>
                  <strong>{it.profiles?.full_name || 'Unknown user'}{it.organizations?.acronym ? ` · ${it.organizations.acronym}` : ''}</strong>
                  <p className="set-toggle-row__hint" style={{ whiteSpace: 'pre-wrap' }}>{it.message}</p>
                  <span className="set-photo-row__email">{new Date(it.created_at).toLocaleString()}</span>
                </div>
                {it.status === 'reviewed' ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--nu-blue-700)', fontWeight: 600 }}><Check size={11} /> Reviewed</span>
                ) : (
                  <button className="set-btn set-btn--outline" onClick={() => markReviewed(it.id)} disabled={updatingId === it.id}>
                    {updatingId === it.id ? <Loader2 size={13} className="spin" /> : 'Mark reviewed'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
