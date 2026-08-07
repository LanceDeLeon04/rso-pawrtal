import { useEffect, useState } from 'react'
import {
  Settings as SettingsIcon, User, Camera, Lock, Users, Pencil, Check, X,
  Loader2, AlertCircle, CheckCircle2, UserCheck, UserX, Building2, FlaskConical, Plus, Trash2,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier } from '../context/AuthContext'
import './Settings.css'

// Rooms/labs can be maintained by SDAO, Facilities (FMO), and Admin —
// same role set used across the app for venue_blocks/restricted_periods.
const VENUE_MANAGER_ROLES = [
  'sdao_assistant', 'crso_chairperson', 'qmo', 'sdao_supervisor', 'academic_director', 'system_admin', 'fmo',
]

export default function Settings() {
  const { profile, completePasswordChange, refreshProfile } = useAuth()
  const admin = isAdminTier(profile?.role)
  const canManageVenues = VENUE_MANAGER_ROLES.includes(profile?.role)

  return (
    <div className="set-page">
      <div className="set-header">
        <h2 className="set-header__title"><SettingsIcon size={17} color="var(--nu-blue-700)" /> Settings</h2>
      </div>

      <ProfileSection profile={profile} refreshProfile={refreshProfile} />
      <PasswordSection completePasswordChange={completePasswordChange} />
      {canManageVenues && <VenueRoomsAndLabsSection />}
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
    <div className="set-card">
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
