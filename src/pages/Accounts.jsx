import { useEffect, useState } from 'react'
import {
  Users, Plus, Loader2, AlertCircle, CheckCircle2, Building2, Copy,
  Tag, Trash2, X, Camera, Mail, Phone,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
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

const EMPTY_ACCOUNT_FORM = {
  full_name: '', username: '', role: 'rso_officer',
  org_id: '', position: '', is_primary: true, viewer_scopes: [],
}

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
      supabase.from('profiles').select('id, full_name, role').order('full_name'),
      supabase.from('org_memberships')
        .select('id, position, is_primary, profiles ( full_name ), organizations ( acronym )')
        .order('created_at', { ascending: false }),
    ])
    setOrgs(o || [])
    setProfiles(p || [])
    setMemberships(m || [])
    setLoading(false)
  }

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
          <CreateAccountSection orgs={orgs} onCreated={loadAll} />
          <OrganizationsSection orgs={orgs} onChanged={loadAll} />
          <MembershipsSection orgs={orgs} profiles={profiles} memberships={memberships} onChanged={loadAll} />
        </>
      )}
    </div>
  )
}

function CreateAccountSection({ orgs, onCreated }) {
  const [form, setForm] = useState(EMPTY_ACCOUNT_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

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
    if (form.role === 'rso_officer' && (!form.org_id || !form.position.trim())) {
      setError('RSO Officer accounts need an organization and position.')
      return
    }

    setSaving(true)
    const { data, error: err } = await supabase.functions.invoke('create-account', {
      body: {
        full_name: form.full_name.trim(),
        username: form.username.trim(),
        role: form.role,
        org_id: form.role === 'rso_officer' ? form.org_id : undefined,
        position: form.role === 'rso_officer' ? form.position.trim() : undefined,
        is_primary: form.is_primary,
        viewer_scopes: form.viewer_scopes,
      },
    })
    setSaving(false)

    if (err || data?.error) {
      setError(data?.error || 'Could not create the account. Please try again.')
      return
    }

    setResult(data)
    setForm(EMPTY_ACCOUNT_FORM)
    onCreated()
  }

  function copyPassword() {
    navigator.clipboard.writeText(result.temp_password)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="acc-card">
      <span className="acc-card__label"><Plus size={13} /> Create Account</span>

      {result && (
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
          <button className="acc-result__close" onClick={() => setResult(null)}><X size={14} /></button>
        </div>
      )}

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
              placeholder="e.g. jdela cruz"
              required
            />
            <span className="acc-hint">Becomes {form.username || 'username'}@pawrtal.local unless you enter a full email.</span>
          </label>
        </div>

        <label className="acc-field">
          Role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, viewer_scopes: [] })}>
            <option value="rso_officer">RSO Officer</option>
            {ADMIN_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>

        {form.role === 'rso_officer' && (
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
              <input
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
                placeholder="e.g. Treasurer"
                required
              />
              <span className="acc-hint">This becomes their cross-org tag (e.g. "all Treasurers").</span>
            </label>
          </div>
        )}

        {ADMIN_ROLES.includes(form.role) && (
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
        )}

        <button className="acc-btn acc-btn--gold" type="submit" disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : 'Create Account'}
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

      <table className="acc-table">
        <thead>
          <tr>
            <th>Logo</th><th>Acronym</th><th>Name</th><th>Category</th><th>Adviser</th>
            <th>Contact</th><th>Accreditation</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {orgs.map((o) => (
            <tr key={o.id}>
              <td>
                <label className="acc-logo-cell">
                  {o.logo_url ? <img src={o.logo_url} alt="" /> : <Camera size={13} />}
                  <input type="file" accept="image/*" onChange={(e) => handleLogoReplace(o, e.target.files?.[0] || null)} hidden />
                </label>
              </td>
              <td className="acc-table__strong">{o.acronym}</td>
              <td>{o.name}</td>
              <td>{o.category || '—'}</td>
              <td>{o.adviser_name || '—'}</td>
              <td>
                {o.contact_email && <div className="acc-contact-line"><Mail size={11} /> {o.contact_email}</div>}
                {o.contact_number && <div className="acc-contact-line"><Phone size={11} /> {o.contact_number}</div>}
                {!o.contact_email && !o.contact_number && '—'}
              </td>
              <td>
                <select
                  className={`acc-accred-select acc-accred-select--${o.accreditation_status}`}
                  value={o.accreditation_status}
                  onChange={(e) => updateStatus(o, e.target.value)}
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
            </tr>
          ))}
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

  async function handleRemove(id) {
    setRemovingId(id)
    await supabase.from('org_memberships').delete().eq('id', id)
    setRemovingId(null)
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
        <input placeholder="Position / tag" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
        <button className="acc-btn acc-btn--gold" type="submit" disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
        </button>
      </form>

      <table className="acc-table">
        <thead><tr><th>Person</th><th>Org</th><th>Position / Tag</th><th /></tr></thead>
        <tbody>
          {memberships.length === 0 ? (
            <tr><td colSpan={4} className="acc-empty-row">No memberships yet.</td></tr>
          ) : (
            memberships.map((m) => (
              <tr key={m.id}>
                <td>{m.profiles?.full_name}</td>
                <td>{m.organizations?.acronym}</td>
                <td><span className="acc-tag-chip">{m.position}</span></td>
                <td>
                  <button className="acc-icon-btn" onClick={() => handleRemove(m.id)} disabled={removingId === m.id}>
                    {removingId === m.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
