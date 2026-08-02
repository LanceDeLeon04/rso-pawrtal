import { useEffect, useState } from 'react'
import {
  Users, Plus, Loader2, AlertCircle, CheckCircle2, Building2, Copy,
  Tag, Trash2, X, Camera, Mail, Phone, Pencil, Check,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import './Accounts.css'

const ROLE_LABELS = {
  rso_officer: 'RSO Officer',
  sdao_assistant: 'SDAO Assistant',
  crso_chairperson: 'CRSO Chairperson',
  qmo: 'QMO',
  sdao_supervisor: 'SDAO Supervisor',
  academic_director: 'Academic Director',
  system_admin: 'System Admin',
}

const ADMIN_ROLES = ['sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor', 'academic_director', 'system_admin']
const VIEWER_SCOPES = ['events', 'calendar', 'submissions', 'clearance', 'all']
const POSITIONS = ['President', 'VP Internal', 'VP External', 'PRO', 'Treasurer', 'Secretary', 'Auditor']

const EMPTY_ADMIN_FORM = {
  full_name: '', username: '', role: ADMIN_ROLES[0], viewer_scopes: [],
}
const EMPTY_RSO_FORM = { org_id: '', position: '', full_name: '' }

const ACCREDITATION_LABELS = {
  accredited: 'Accredited',
  probationary: 'Probationary',
  pending: 'Pending',
}

const EMPTY_ORG_FORM = {
  name: '', acronym: '', category: '', adviser_name: '',
  accreditation_status: 'pending', contact_email: '', contact_number: '',
}
const EMPTY_MEMBERSHIP_FORM = { profile_id: '', org_id: '', position: '', is_primary: true }

export default function Accounts() {
  const { profile: currentProfile } = useAuth()
  const [orgs, setOrgs] = useState([])
  const [profiles, setProfiles] = useState([])
  const [memberships, setMemberships] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: o }, { data: p }, { data: m }] = await Promise.all([
      supabase.from('organizations')
        .select('id, name, acronym, category, adviser_name, logo_url, accreditation_status, contact_email, contact_number, is_active')
        .order('acronym'),
      supabase.from('profiles').select('id, full_name, email, role, is_active').order('full_name'),
      supabase.from('org_memberships')
        .select('id, profile_id, position, is_primary, profiles ( full_name ), organizations ( acronym )')
        .order('created_at', { ascending: false }),
    ])
    setOrgs(o || [])
    setProfiles(p || [])
    setMemberships(m || [])
    setLoading(false)
  }

  const adminProfiles = profiles.filter((p) => ADMIN_ROLES.includes(p.role))

  return (
    <div className="acc-page">
      <div className="acc-header">
        <h2 className="acc-header__title"><Users size={17} color="var(--nu-blue-700)" /> Accounts</h2>
        <p className="acc-header__sub">Create logins, manage organizations, and tag officers across orgs.</p>
      </div>

      {loading ? (
        <Loader2 size={20} className="spin" />
      ) : (
        <>
          <CreateAdminAccountSection onCreated={loadAll} />
          <CreateRSOAccountSection orgs={orgs} onCreated={loadAll} />
          <AdminAccountsSection
            adminProfiles={adminProfiles}
            currentProfileId={currentProfile?.id}
            onChanged={loadAll}
          />
          <OrganizationsSection orgs={orgs} onChanged={loadAll} />
          <MembershipsSection orgs={orgs} profiles={profiles} memberships={memberships} onChanged={loadAll} />
        </>
      )}
    </div>
  )
}

// supabase.functions.invoke() is *supposed* to attach the signed-in
// user's access token automatically, but right after sign-in / a page
// reload the client's internal auth listener can lag behind — the call
// goes out before that wiring finishes and the Edge Function sees no
// Authorization header at all ("Missing authorization header"). Grabbing
// the session directly and passing the header explicitly sidesteps that
// race entirely.
async function invokeAccountFn(functionName, payload) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return { data: null, error: { message: 'Your session has expired. Please sign in again.' } }
  }
  return supabase.functions.invoke(functionName, {
    body: payload,
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
}

function CreatedAccountResult({ result, onClose }) {
  const [copied, setCopied] = useState(false)
  function copyPassword() {
    navigator.clipboard.writeText(result.temp_password)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="acc-result">
      <CheckCircle2 size={15} />
      <div>
        <strong>{result.email}</strong> created. Share this temporary password — they'll be required to change
        it on first sign-in:
        <div className="acc-result__password">
          <code>{result.temp_password}</code>
          <button type="button" onClick={copyPassword}><Copy size={13} /> {copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>
      <button className="acc-result__close" onClick={onClose}><X size={14} /></button>
    </div>
  )
}

// ---------- ADMINISTRATORS (personal accounts) ----------
// SDAO, Admins, Academic Directors, etc. — one login per person.
function CreateAdminAccountSection({ onCreated }) {
  const [form, setForm] = useState(EMPTY_ADMIN_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  function toggleScope(scope) {
    setForm((f) => ({
      ...f,
      viewer_scopes: f.viewer_scopes.includes(scope)
        ? f.viewer_scopes.filter((s) => s !== scope)
        : [...f.viewer_scopes, scope],
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setResult(null)

    if (!form.full_name.trim() || !form.username.trim()) {
      setError('Full name and username are required.')
      return
    }
    if (form.username.includes('@')) {
      setError('Username should not include "@" — it will automatically become username@pawrtal.local.')
      return
    }

    setSaving(true)
    const { data, error: err } = await invokeAccountFn('create-account', {
      full_name: form.full_name.trim(),
      username: form.username.trim(),
      role: form.role,
      viewer_scopes: form.viewer_scopes,
    })
    setSaving(false)

    if (err || data?.error) {
      setError(data?.error || 'Could not create the account. Please try again.')
      return
    }

    setResult(data)
    setForm(EMPTY_ADMIN_FORM)
    onCreated()
  }

  return (
    <div className="acc-card">
      <span className="acc-card__label"><Plus size={13} /> Create Account for Administrators</span>
      <p className="acc-card__sub">
        Personal login for SDAO staff, admins, and academic directors — tied to that person, one account each.
      </p>

      {result && <CreatedAccountResult result={result} onClose={() => setResult(null)} />}
      {error && <div className="acc-error"><AlertCircle size={14} /> {error}</div>}

      <form className="acc-form" onSubmit={handleSubmit}>
        <div className="acc-field-row">
          <label className="acc-field">
            Full Name
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
          </label>
          <label className="acc-field">
            Username
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="e.g. jdelacruz"
              pattern="[^@]*"
              title="Username only — no @ symbol"
              required
            />
            <span className="acc-hint">Becomes {form.username || 'username'}@pawrtal.local. Don't enter a full email address.</span>
          </label>
        </div>

        <label className="acc-field">
          Role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, viewer_scopes: [] })}>
            {ADMIN_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>

        <div className="acc-field">
          <span>Viewer Access <span className="acc-optional">(optional — restricts what they can see)</span></span>
          <div className="acc-scope-chips">
            {VIEWER_SCOPES.map((s) => (
              <button
                type="button"
                key={s}
                className={`acc-scope-chip ${form.viewer_scopes.includes(s) ? 'acc-scope-chip--active' : ''}`}
                onClick={() => toggleScope(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <button className="acc-btn acc-btn--gold" type="submit" disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : 'Create Account'}
        </button>
      </form>
    </div>
  )
}

// ---------- ADMINISTRATOR ACCOUNTS (list + delete) ----------
function AdminAccountsSection({ adminProfiles, currentProfileId, onChanged }) {
  const [error, setError] = useState('')
  const [confirmingId, setConfirmingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  async function handleDelete(profileId) {
    setError('')
    setDeletingId(profileId)
    const { data, error: err } = await invokeAccountFn('delete-account', { profile_id: profileId })
    setDeletingId(null)
    setConfirmingId(null)
    if (err || data?.error) {
      setError(data?.error || 'Could not delete the account. Please try again.')
      return
    }
    onChanged()
  }

  return (
    <div className="acc-card">
      <span className="acc-card__label"><Users size={13} /> Administrator Accounts</span>
      <p className="acc-card__sub">SDAO, Admins, and Academic Directors with a personal login.</p>

      {error && <div className="acc-error"><AlertCircle size={14} /> {error}</div>}

      <table className="acc-table">
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th /></tr></thead>
        <tbody>
          {adminProfiles.length === 0 ? (
            <tr><td colSpan={4} className="acc-empty-row">No administrator accounts yet.</td></tr>
          ) : (
            adminProfiles.map((p) => {
              const isSelf = p.id === currentProfileId
              const isConfirming = confirmingId === p.id
              return (
                <tr key={p.id}>
                  <td>{p.full_name}{!p.is_active && <span className="acc-optional"> (deactivated)</span>}</td>
                  <td>{p.email}</td>
                  <td>{ROLE_LABELS[p.role]}</td>
                  <td>
                    {isConfirming ? (
                      <div className="acc-edit-actions">
                        <button
                          className="acc-icon-btn"
                          onClick={() => handleDelete(p.id)}
                          disabled={deletingId === p.id}
                          title="Confirm delete"
                        >
                          {deletingId === p.id ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                        </button>
                        <button className="acc-icon-btn" onClick={() => setConfirmingId(null)} title="Cancel">
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <button
                        className="acc-icon-btn"
                        onClick={() => setConfirmingId(p.id)}
                        disabled={isSelf}
                        title={isSelf ? "You can't delete your own account" : 'Delete account'}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

// ---------- RSO (position-based accounts) ----------
// The login belongs to the position (e.g. "SCS-SC President"), not to
// whoever currently holds it — username is auto-generated as
// {org-acronym}.{position} and can't be typed manually. "Full Name" here
// is just a label for the current holder and can be renamed later by an
// admin from the table below without touching the login itself.
function CreateRSOAccountSection({ orgs, onCreated }) {
  const [form, setForm] = useState(EMPTY_RSO_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const org = orgs.find((o) => o.id === form.org_id)
  const slug = (v) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const usernamePreview = org && form.position.trim()
    ? `${slug(org.acronym)}.${slug(form.position)}`
    : null

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setResult(null)

    if (!form.org_id || !form.position.trim()) {
      setError('Organization and position are required.')
      return
    }
    if (!form.full_name.trim()) {
      setError("The current holder's name is required.")
      return
    }

    setSaving(true)
    const { data, error: err } = await invokeAccountFn('create-account', {
      full_name: form.full_name.trim(),
      role: 'rso_officer',
      org_id: form.org_id,
      position: form.position.trim(),
    })
    setSaving(false)

    if (err || data?.error) {
      setError(data?.error || 'Could not create the account. Please try again.')
      return
    }

    setResult(data)
    setForm(EMPTY_RSO_FORM)
    onCreated()
  }

  return (
    <div className="acc-card">
      <span className="acc-card__label"><Plus size={13} /> Create RSO Account</span>
      <p className="acc-card__sub">
        RSO logins are position-based — one account per org + position (e.g. SCS-SC President), not per person.
        The username is generated automatically. If the position already has an account, rename its current
        holder in the table below instead of creating a new one.
      </p>

      {result && <CreatedAccountResult result={result} onClose={() => setResult(null)} />}
      {error && <div className="acc-error"><AlertCircle size={14} /> {error}</div>}

      <form className="acc-form" onSubmit={handleSubmit}>
        <div className="acc-field-row">
          <label className="acc-field">
            Organization
            <select value={form.org_id} onChange={(e) => setForm({ ...form, org_id: e.target.value })} required>
              <option value="">Select organization</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.acronym}</option>)}
            </select>
          </label>
          <label className="acc-field">
            Position
            <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} required>
              <option value="">Select position</option>
              {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <span className="acc-hint">Also doubles as the cross-org tag (e.g. "all Treasurers").</span>
          </label>
        </div>

        <label className="acc-field">
          Current Holder's Name
          <input
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            placeholder="e.g. Juan Dela Cruz"
            required
          />
          <span className="acc-hint">Shown in the app so people know who holds the position — admins can rename this any time.</span>
        </label>

        {usernamePreview && (
          <div className="acc-hint">Login username will be <strong>{usernamePreview}@pawrtal.local</strong></div>
        )}

        <button className="acc-btn acc-btn--gold" type="submit" disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : 'Create RSO Account'}
        </button>
      </form>
    </div>
  )
}

function OrganizationsSection({ orgs, onChanged }) {
  const [form, setForm] = useState(EMPTY_ORG_FORM)
  const [logoFile, setLogoFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_ORG_FORM)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  function startEdit(org) {
    setEditingId(org.id)
    setEditError('')
    setEditForm({
      name: org.name || '',
      acronym: org.acronym || '',
      category: org.category || '',
      adviser_name: org.adviser_name || '',
      accreditation_status: org.accreditation_status || 'pending',
      contact_email: org.contact_email || '',
      contact_number: org.contact_number || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditError('')
  }

  async function saveEdit(orgId) {
    setEditError('')
    if (!editForm.name.trim() || !editForm.acronym.trim()) {
      setEditError('Name and acronym are required.')
      return
    }
    setEditSaving(true)
    const { error: err } = await supabase.from('organizations').update({
      name: editForm.name.trim(),
      acronym: editForm.acronym.trim(),
      category: editForm.category.trim() || null,
      adviser_name: editForm.adviser_name.trim() || null,
      accreditation_status: editForm.accreditation_status,
      contact_email: editForm.contact_email.trim() || null,
      contact_number: editForm.contact_number.trim() || null,
    }).eq('id', orgId)
    setEditSaving(false)
    if (err) {
      setEditError(err.message?.includes('duplicate') ? 'That acronym is already in use.' : 'Could not save changes.')
      return
    }
    setEditingId(null)
    onChanged()
  }

  async function handleAdd(e) {
    e.preventDefault()
    setError('')
    if (!form.name.trim() || !form.acronym.trim()) {
      setError('Name and acronym are required.')
      return
    }
    setSaving(true)

    const { data: inserted, error: err } = await supabase.from('organizations').insert({
      name: form.name.trim(),
      acronym: form.acronym.trim(),
      category: form.category.trim() || null,
      adviser_name: form.adviser_name.trim() || null,
      accreditation_status: form.accreditation_status,
      contact_email: form.contact_email.trim() || null,
      contact_number: form.contact_number.trim() || null,
    }).select('id').single()

    if (err) {
      setSaving(false)
      setError(err.message?.includes('duplicate') ? 'That acronym is already in use.' : 'Could not add the organization.')
      return
    }

    if (logoFile) {
      const uploadError = await uploadOrgLogo(inserted.id, logoFile)
      if (uploadError) {
        setSaving(false)
        setError('Organization added, but the logo upload failed. You can retry it from the table.')
        setForm(EMPTY_ORG_FORM)
        setLogoFile(null)
        setShowForm(false)
        onChanged()
        return
      }
    }

    setSaving(false)
    setForm(EMPTY_ORG_FORM)
    setLogoFile(null)
    setShowForm(false)
    onChanged()
  }

  async function uploadOrgLogo(orgId, file) {
    const ext = file.name.split('.').pop()
    const path = `${orgId}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('org-logos').upload(path, file, { upsert: true })
    if (upErr) return upErr
    const { data: pub } = supabase.storage.from('org-logos').getPublicUrl(path)
    const { error: dbErr } = await supabase.from('organizations').update({ logo_url: pub.publicUrl }).eq('id', orgId)
    return dbErr || null
  }

  async function handleLogoReplace(org, file) {
    if (!file) return
    await uploadOrgLogo(org.id, file)
    onChanged()
  }

  async function toggleActive(org) {
    await supabase.from('organizations').update({ is_active: !org.is_active }).eq('id', org.id)
    onChanged()
  }

  async function updateStatus(org, status) {
    await supabase.from('organizations').update({ accreditation_status: status }).eq('id', org.id)
    onChanged()
  }

  return (
    <div className="acc-card">
      <div className="acc-card__head">
        <span className="acc-card__label"><Building2 size={13} /> Organizations</span>
        <button className="acc-btn acc-btn--outline" onClick={() => setShowForm(!showForm)}>
          <Plus size={13} /> Add Organization
        </button>
      </div>

      {showForm && (
        <form className="acc-form" onSubmit={handleAdd}>
          {error && <div className="acc-error"><AlertCircle size={14} /> {error}</div>}
          <div className="acc-field-row">
            <label className="acc-field">
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="acc-field">
              Acronym
              <input value={form.acronym} onChange={(e) => setForm({ ...form, acronym: e.target.value })} required />
            </label>
          </div>
          <div className="acc-field-row">
            <label className="acc-field">
              Category
              <input placeholder="e.g. Academic" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </label>
            <label className="acc-field">
              Adviser
              <input value={form.adviser_name} onChange={(e) => setForm({ ...form, adviser_name: e.target.value })} />
            </label>
          </div>
          <div className="acc-field-row">
            <label className="acc-field">
              Contact Email
              <input type="email" placeholder="org@nu-laguna.edu.ph" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
            </label>
            <label className="acc-field">
              Contact Number
              <input placeholder="e.g. 09171234567" value={form.contact_number} onChange={(e) => setForm({ ...form, contact_number: e.target.value })} />
            </label>
          </div>
          <div className="acc-field-row">
            <label className="acc-field">
              Accreditation Status
              <select value={form.accreditation_status} onChange={(e) => setForm({ ...form, accreditation_status: e.target.value })}>
                {Object.entries(ACCREDITATION_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </label>
            <label className="acc-field">
              Logo
              <label className="acc-logo-input">
                {logoFile ? logoFile.name : 'Choose image'}
                <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} hidden />
              </label>
            </label>
          </div>
          <button className="acc-btn acc-btn--gold" type="submit" disabled={saving}>
            {saving ? <Loader2 size={14} className="spin" /> : 'Add Organization'}
          </button>
        </form>
      )}

      {editError && <div className="acc-error"><AlertCircle size={14} /> {editError}</div>}

      <table className="acc-table">
        <thead>
          <tr>
            <th>Logo</th><th>Acronym</th><th>Name</th><th>Category</th><th>Adviser</th>
            <th>Contact</th><th>Accreditation</th><th>Status</th><th />
          </tr>
        </thead>
        <tbody>
          {orgs.map((o) => {
            const isEditing = editingId === o.id
            return (
              <tr key={o.id}>
                <td>
                  <label className="acc-logo-cell">
                    {o.logo_url ? <img src={o.logo_url} alt="" /> : <Camera size={13} />}
                    <input type="file" accept="image/*" onChange={(e) => handleLogoReplace(o, e.target.files?.[0] || null)} hidden />
                  </label>
                </td>

                {isEditing ? (
                  <>
                    <td>
                      <input
                        className="acc-inline-input"
                        value={editForm.acronym}
                        onChange={(e) => setEditForm({ ...editForm, acronym: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="acc-inline-input"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="acc-inline-input"
                        placeholder="e.g. Academic"
                        value={editForm.category}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="acc-inline-input"
                        value={editForm.adviser_name}
                        onChange={(e) => setEditForm({ ...editForm, adviser_name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="acc-inline-input"
                        type="email"
                        placeholder="Contact email"
                        value={editForm.contact_email}
                        onChange={(e) => setEditForm({ ...editForm, contact_email: e.target.value })}
                      />
                      <input
                        className="acc-inline-input"
                        placeholder="Contact number"
                        value={editForm.contact_number}
                        onChange={(e) => setEditForm({ ...editForm, contact_number: e.target.value })}
                      />
                    </td>
                  </>
                ) : (
                  <>
                    <td className="acc-table__strong">{o.acronym}</td>
                    <td>{o.name}</td>
                    <td>{o.category || '—'}</td>
                    <td>{o.adviser_name || '—'}</td>
                    <td>
                      {o.contact_email && <div className="acc-contact-line"><Mail size={11} /> {o.contact_email}</div>}
                      {o.contact_number && <div className="acc-contact-line"><Phone size={11} /> {o.contact_number}</div>}
                      {!o.contact_email && !o.contact_number && '—'}
                    </td>
                  </>
                )}

                <td>
                  <select
                    className={`acc-accred-select acc-accred-select--${isEditing ? editForm.accreditation_status : o.accreditation_status}`}
                    value={isEditing ? editForm.accreditation_status : o.accreditation_status}
                    onChange={(e) => isEditing
                      ? setEditForm({ ...editForm, accreditation_status: e.target.value })
                      : updateStatus(o, e.target.value)}
                  >
                    {Object.entries(ACCREDITATION_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className={`acc-status-badge acc-status-badge--${o.is_active ? 'active' : 'inactive'}`}
                    onClick={() => toggleActive(o)}
                  >
                    {o.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td>
                  {isEditing ? (
                    <div className="acc-edit-actions">
                      <button className="acc-icon-btn" onClick={() => saveEdit(o.id)} disabled={editSaving} title="Save">
                        {editSaving ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                      </button>
                      <button className="acc-icon-btn" onClick={cancelEdit} disabled={editSaving} title="Cancel">
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <button className="acc-icon-btn" onClick={() => startEdit(o)} title="Edit">
                      <Pencil size={13} />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MembershipsSection({ orgs, profiles, memberships, onChanged }) {
  const [form, setForm] = useState(EMPTY_MEMBERSHIP_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [removingId, setRemovingId] = useState(null)

  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)

  function startRename(m) {
    setRenamingId(m.id)
    setRenameValue(m.profiles?.full_name || '')
    setError('')
  }

  function cancelRename() {
    setRenamingId(null)
    setRenameValue('')
  }

  // Position-based RSO accounts keep the same login when the holder
  // changes — this just updates the display name on the existing profile,
  // it never touches the username/email.
  async function saveRename(m) {
    if (!renameValue.trim()) {
      setError("The holder's name can't be empty.")
      return
    }
    setRenameSaving(true)
    const { error: err } = await supabase
      .from('profiles')
      .update({ full_name: renameValue.trim() })
      .eq('id', m.profile_id)
    setRenameSaving(false)
    if (err) {
      setError('Could not update the holder name.')
      return
    }
    setRenamingId(null)
    onChanged()
  }

  async function handleAdd(e) {
    e.preventDefault()
    setError('')
    if (!form.profile_id || !form.org_id || !form.position.trim()) {
      setError('Select a person, an organization, and a position.')
      return
    }
    setSaving(true)
    const { error: err } = await supabase.from('org_memberships').insert({
      profile_id: form.profile_id,
      org_id: form.org_id,
      position: form.position.trim(),
      is_primary: form.is_primary,
    })
    setSaving(false)
    if (err) {
      setError(err.message?.includes('duplicate') ? 'This person already holds that position in that org.' : 'Could not add the membership.')
      return
    }
    setForm(EMPTY_MEMBERSHIP_FORM)
    onChanged()
  }

  // RSO accounts are position-based — the membership *is* the account, so
  // removing it deletes the whole login via the same edge function used
  // for admin accounts, rather than leaving an orphaned auth user behind.
  async function handleRemove(m) {
    setRemovingId(m.id)
    setError('')
    const { data, error: err } = await invokeAccountFn('delete-account', { profile_id: m.profile_id })
    setRemovingId(null)
    if (err || data?.error) {
      setError(data?.error || 'Could not remove this account.')
      return
    }
    onChanged()
  }

  return (
    <div className="acc-card">
      <span className="acc-card__label"><Tag size={13} /> Org Memberships &amp; Tags</span>
      <p className="acc-card__sub">
        A position (e.g. "Treasurer") doubles as a cross-org tag — used in Assignments to route a task to
        everyone holding that position, across every organization.
      </p>

      {error && <div className="acc-error"><AlertCircle size={14} /> {error}</div>}

      <form className="acc-form acc-form--inline" onSubmit={handleAdd}>
        <select value={form.profile_id} onChange={(e) => setForm({ ...form, profile_id: e.target.value })}>
          <option value="">Person</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <select value={form.org_id} onChange={(e) => setForm({ ...form, org_id: e.target.value })}>
          <option value="">Organization</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.acronym}</option>)}
        </select>
        <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>
          <option value="">Position</option>
          {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="acc-btn acc-btn--gold" type="submit" disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
        </button>
      </form>

      <table className="acc-table">
        <thead><tr><th>Current Holder</th><th>Org</th><th>Position / Tag</th><th /></tr></thead>
        <tbody>
          {memberships.length === 0 ? (
            <tr><td colSpan={4} className="acc-empty-row">No memberships yet.</td></tr>
          ) : (
            memberships.map((m) => (
              <tr key={m.id}>
                <td>
                  {renamingId === m.id ? (
                    <input
                      className="acc-inline-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      autoFocus
                    />
                  ) : (
                    m.profiles?.full_name
                  )}
                </td>
                <td>{m.organizations?.acronym}</td>
                <td><span className="acc-tag-chip">{m.position}</span></td>
                <td>
                  {renamingId === m.id ? (
                    <div className="acc-edit-actions">
                      <button className="acc-icon-btn" onClick={() => saveRename(m)} disabled={renameSaving} title="Save">
                        {renameSaving ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                      </button>
                      <button className="acc-icon-btn" onClick={cancelRename} disabled={renameSaving} title="Cancel">
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="acc-edit-actions">
                      <button className="acc-icon-btn" onClick={() => startRename(m)} title="Rename holder">
                        <Pencil size={13} />
                      </button>
                      <button className="acc-icon-btn" onClick={() => handleRemove(m)} disabled={removingId === m.id} title="Delete account">
                        {removingId === m.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
