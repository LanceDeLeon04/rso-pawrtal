import { useEffect, useState } from 'react'
import {
  Settings as SettingsIcon, User, Camera, Lock, Users, Pencil, Check, X,
  Loader2, AlertCircle, CheckCircle2, UserCheck, UserX,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier } from '../context/AuthContext'
import './Settings.css'

export default function Settings() {
  const { profile, completePasswordChange, refreshProfile } = useAuth()
  const admin = isAdminTier(profile?.role)

  return (
    <div className="set-page">
      <div className="set-header">
        <h2 className="set-header__title"><SettingsIcon size={17} color="var(--nu-blue-700)" /> Settings</h2>
      </div>

      <ProfileSection profile={profile} refreshProfile={refreshProfile} />
      <PasswordSection completePasswordChange={completePasswordChange} />
      {admin && <UserManagementSection currentProfileId={profile?.id} />}
    </div>
  )
}

function ProfileSection({ profile, refreshProfile }) {
  const [name, setName] = useState(profile?.full_name || '')
  const [savingName, setSavingName] = useState(false)
  const [nameMsg, setNameMsg] = useState('')

  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')

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

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoError('')
    setUploading(true)

    const ext = file.name.split('.').pop()
    const path = `${profile.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (upErr) {
      setUploading(false)
      setPhotoError('Could not upload photo. Please try again.')
      return
    }
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
    const { error: dbErr } = await supabase.from('profiles').update({ photo_url: pub.publicUrl }).eq('id', profile.id)

    setUploading(false)
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
            {uploading ? <Loader2 size={13} className="spin" /> : <Camera size={13} />}
            <input type="file" accept="image/*" onChange={handlePhotoChange} hidden disabled={uploading} />
          </label>
        </div>
        <div>
          <span className="set-photo-row__name">{profile?.full_name}</span>
          <span className="set-photo-row__email">{profile?.email}</span>
        </div>
      </div>

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
    <div className="set-card">
      <span className="set-card__label"><Users size={13} /> Manage User Accounts</span>
      <p className="set-card__sub">
        Correct any account's display name, or deactivate one to immediately block that person from signing in.
      </p>

      {error && <div className="set-error"><AlertCircle size={13} /> {error}</div>}

      {loading ? (
        <Loader2 size={18} className="spin" />
      ) : (
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
      )}
    </div>
  )
}
