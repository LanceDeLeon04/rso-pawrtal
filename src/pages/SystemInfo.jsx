import { useEffect, useState } from 'react'
import {
  Info, ListChecks, Code2, Users, Camera, Pencil, Check, X, Loader2,
  AlertCircle, Plus, Trash2, GripVertical, Sparkles,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import ImageCropModal from '../components/ImageCropModal'
import './SystemInfo.css'

export default function SystemInfo() {
  const { profile } = useAuth()
  const canEdit = profile?.role === 'system_admin'

  const [info, setInfo] = useState(null)
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [infoRes, adminsRes] = await Promise.all([
      supabase.from('system_info').select('*').eq('id', 1).single(),
      supabase.from('system_administrators').select('*').order('sort_order', { ascending: true }),
    ])
    setInfo(infoRes.data)
    setAdmins(adminsRes.data || [])
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="sys-page">
        <div className="sys-loading"><Loader2 size={18} className="spin" /> Loading…</div>
      </div>
    )
  }

  return (
    <div className="sys-page">
      <div className="sys-header">
        <h2 className="sys-header__title"><Info size={17} color="var(--nu-blue-700)" /> About the System</h2>
      </div>

      <DescriptionSection info={info} canEdit={canEdit} onSaved={setInfo} />
      <DeveloperSection info={info} canEdit={canEdit} onSaved={setInfo} />
      <AdministratorsSection admins={admins} canEdit={canEdit} onChanged={load} />
    </div>
  )
}

/* ============================== Description ============================== */

function DescriptionSection({ info, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [description, setDescription] = useState(info?.description || '')
  const [functions, setFunctions] = useState(info?.functions?.length ? info.functions : [''])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function startEdit() {
    setDescription(info?.description || '')
    setFunctions(info?.functions?.length ? info.functions : [''])
    setError('')
    setEditing(true)
  }

  function updateFn(idx, value) {
    setFunctions((prev) => prev.map((f, i) => (i === idx ? value : f)))
  }
  function addFn() { setFunctions((prev) => [...prev, '']) }
  function removeFn(idx) { setFunctions((prev) => prev.filter((_, i) => i !== idx)) }

  async function handleSave() {
    setSaving(true)
    setError('')
    const cleanFns = functions.map((f) => f.trim()).filter(Boolean)
    const { data, error: err } = await supabase.from('system_info')
      .update({ description: description.trim(), functions: cleanFns, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .select('*')
      .single()
    setSaving(false)
    if (err) { setError('Could not save changes.'); return }
    onSaved(data)
    setEditing(false)
  }

  return (
    <div className="sys-card">
      <div className="sys-card__head">
        <span className="sys-card__label"><ListChecks size={13} /> System Description</span>
        {canEdit && !editing && (
          <button type="button" className="sys-icon-btn" onClick={startEdit} title="Edit">
            <Pencil size={13} />
          </button>
        )}
      </div>

      {error && <div className="sys-error"><AlertCircle size={13} /> {error}</div>}

      {!editing ? (
        <>
          <p className="sys-description">{info?.description}</p>
          {!!info?.functions?.length && (
            <>
              <span className="sys-card__sub-label">What it does</span>
              <ul className="sys-fn-list">
                {info.functions.map((fn, i) => <li key={i}>{fn}</li>)}
              </ul>
            </>
          )}
        </>
      ) : (
        <>
          <label className="sys-field">
            Description
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <label className="sys-field">
            Functions
            <div className="sys-fn-edit-list">
              {functions.map((fn, i) => (
                <div className="sys-fn-edit-row" key={i}>
                  <input
                    type="text"
                    value={fn}
                    onChange={(e) => updateFn(i, e.target.value)}
                    placeholder="Describe a function of the system"
                  />
                  <button type="button" className="sys-icon-btn sys-icon-btn--danger" onClick={() => removeFn(i)} title="Remove">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <button type="button" className="sys-btn sys-btn--outline sys-btn--sm" onClick={addFn}>
                <Plus size={13} /> Add function
              </button>
            </div>
          </label>

          <div className="sys-edit-actions">
            <button type="button" className="sys-btn sys-btn--gold" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Save
            </button>
            <button type="button" className="sys-btn sys-btn--outline" onClick={() => setEditing(false)} disabled={saving}>
              <X size={13} /> Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/* ============================== Developer ============================== */

function DeveloperSection({ info, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(info?.developer_name || '')
  const [title, setTitle] = useState(info?.developer_title || '')
  const [note, setNote] = useState(info?.developer_note || '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [pendingPhotoFile, setPendingPhotoFile] = useState(null)

  function startEdit() {
    setName(info?.developer_name || '')
    setTitle(info?.developer_title || '')
    setNote(info?.developer_note || '')
    setError('')
    setEditing(true)
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    const { data, error: err } = await supabase.from('system_info')
      .update({
        developer_name: name.trim(),
        developer_title: title.trim(),
        developer_note: note.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
      .select('*')
      .single()
    setSaving(false)
    if (err) { setError('Could not save changes.'); return }
    onSaved(data)
    setEditing(false)
  }

  function handlePhotoPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setPendingPhotoFile(file)
  }

  async function handlePhotoConfirm(croppedFile) {
    setUploading(true)
    setError('')
    const ext = croppedFile.name.split('.').pop()
    const path = `developer/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('system-admins').upload(path, croppedFile, { upsert: true })
    if (upErr) { setError('Could not upload photo.'); setUploading(false); setPendingPhotoFile(null); return }
    const { data: pub } = supabase.storage.from('system-admins').getPublicUrl(path)
    const { data, error: dbErr } = await supabase.from('system_info')
      .update({ developer_photo_url: pub.publicUrl, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .select('*')
      .single()
    setUploading(false)
    setPendingPhotoFile(null)
    if (dbErr) { setError('Could not save photo.'); return }
    onSaved(data)
  }

  return (
    <div className="sys-card">
      <div className="sys-card__head">
        <span className="sys-card__label"><Code2 size={15} /> Developed By</span>
        {canEdit && !editing && (
          <button type="button" className="sys-icon-btn" onClick={startEdit} title="Edit">
            <Pencil size={14} />
          </button>
        )}
      </div>

      {error && <div className="sys-error"><AlertCircle size={13} /> {error}</div>}

      {pendingPhotoFile && (
        <ImageCropModal
          file={pendingPhotoFile}
          uploading={uploading}
          onCancel={() => setPendingPhotoFile(null)}
          onConfirm={handlePhotoConfirm}
        />
      )}

      {!editing ? (
        <div className="sys-dev">
          <div className="sys-dev__avatar">
            {info?.developer_photo_url ? (
              <img src={info.developer_photo_url} alt={info?.developer_name || ''} />
            ) : (
              <Sparkles size={26} />
            )}
            {canEdit && (
              <label className="sys-dev__avatar-edit" title="Change photo">
                <Camera size={13} />
                <input type="file" accept="image/*" onChange={handlePhotoPick} hidden />
              </label>
            )}
          </div>
          <div className="sys-dev__body">
            <span className="sys-dev__name">{info?.developer_name}</span>
            <span className="sys-dev__title">{info?.developer_title}</span>
            {info?.developer_note && <p className="sys-dev__note">{info.developer_note}</p>}
          </div>
        </div>
      ) : (
        <>
          <label className="sys-field">Full name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="sys-field">Title
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="sys-field">Note
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          <div className="sys-edit-actions">
            <button type="button" className="sys-btn sys-btn--gold" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Save
            </button>
            <button type="button" className="sys-btn sys-btn--outline" onClick={() => setEditing(false)} disabled={saving}>
              <X size={13} /> Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/* ============================== Administrators ============================== */

// Three-tier org hierarchy: Executive, then Academic, then everyone else
// (SDAO / QMO / consultants / etc.), inferred from each admin's title.
const TIERS = [
  { key: 'executive', label: 'Executive', match: (t) => /executive/i.test(t) },
  { key: 'academic', label: 'Academic', match: (t) => /academic/i.test(t) },
  { key: 'other', label: 'SDAO, QMO & Consultants', match: () => true },
]

function groupByTier(admins) {
  const buckets = { executive: [], academic: [], other: [] }
  for (const admin of admins) {
    const tier = TIERS.find((t) => t.match(admin.title || '')) || TIERS[2]
    buckets[tier.key].push(admin)
  }
  return buckets
}

function AdministratorsSection({ admins, canEdit, onChanged }) {
  const [managing, setManaging] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const tiers = groupByTier(admins)

  async function uploadPhoto(adminId, file) {
    const ext = file.name.split('.').pop()
    const path = `${adminId}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('system-admins').upload(path, file, { upsert: true })
    if (upErr) return upErr
    const { data: pub } = supabase.storage.from('system-admins').getPublicUrl(path)
    const { error: dbErr } = await supabase.from('system_administrators')
      .update({ photo_url: pub.publicUrl, updated_at: new Date().toISOString() })
      .eq('id', adminId)
    return dbErr || null
  }

  async function handlePhotoChange(adminId, file) {
    if (!file) return
    setError('')
    const err = await uploadPhoto(adminId, file)
    if (err) setError('Could not upload photo.')
    onChanged()
  }

  async function handleTitleEdit(admin, field, value) {
    await supabase.from('system_administrators')
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq('id', admin.id)
    onChanged()
  }

  async function handleRemove(admin) {
    await supabase.from('system_administrators').delete().eq('id', admin.id)
    onChanged()
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!newName.trim() || !newTitle.trim()) return
    setSaving(true)
    setError('')
    const maxOrder = admins.reduce((m, a) => Math.max(m, a.sort_order || 0), 0)
    const { error: err } = await supabase.from('system_administrators').insert({
      full_name: newName.trim(),
      title: newTitle.trim(),
      sort_order: maxOrder + 10,
    })
    setSaving(false)
    if (err) { setError('Could not add administrator.'); return }
    setNewName('')
    setNewTitle('')
    setAdding(false)
    onChanged()
  }

  return (
    <div className="sys-card">
      <div className="sys-card__head">
        <span className="sys-card__label"><Users size={13} /> The Administrators</span>
        {canEdit && (
          <button
            type="button"
            className={`sys-btn sys-btn--outline sys-btn--sm ${managing ? 'sys-btn--active' : ''}`}
            onClick={() => { setManaging((v) => !v); setAdding(false) }}
          >
            <Pencil size={13} /> {managing ? 'Done' : 'Manage'}
          </button>
        )}
      </div>

      {error && <div className="sys-error"><AlertCircle size={13} /> {error}</div>}

      <div className="sys-org-chart">
        {TIERS.map((tier, i) => {
          const group = tiers[tier.key]
          if (!group.length) return null
          return (
            <div className={`sys-tier sys-tier--${tier.key}`} key={tier.key}>
              {i > 0 && <div className="sys-tier__connector" aria-hidden="true" />}
              <span className="sys-tier__label">{tier.label}</span>
              <div className="sys-admin-grid">
                {group.map((admin) => (
                  <AdminCard
                    key={admin.id}
                    admin={admin}
                    editing={managing}
                    onPhotoChange={(file) => handlePhotoChange(admin.id, file)}
                    onFieldSave={(field, value) => handleTitleEdit(admin, field, value)}
                    onRemove={() => handleRemove(admin)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {managing && (
        adding ? (
          <form className="sys-add-form" onSubmit={handleAdd}>
            <input
              type="text" placeholder="Full name" value={newName}
              onChange={(e) => setNewName(e.target.value)} required
            />
            <input
              type="text" placeholder="Title / position" value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)} required
            />
            <div className="sys-edit-actions">
              <button type="submit" className="sys-btn sys-btn--gold" disabled={saving}>
                {saving ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Add
              </button>
              <button type="button" className="sys-btn sys-btn--outline" onClick={() => setAdding(false)} disabled={saving}>
                <X size={13} /> Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="sys-btn sys-btn--outline sys-btn--sm" onClick={() => setAdding(true)}>
            <Plus size={13} /> Add administrator
          </button>
        )
      )}
    </div>
  )
}

function AdminCard({ admin, editing, onPhotoChange, onFieldSave, onRemove }) {
  const [name, setName] = useState(admin.full_name)
  const [title, setTitle] = useState(admin.title)
  const [uploading, setUploading] = useState(false)
  const [pendingPhotoFile, setPendingPhotoFile] = useState(null)

  function handleFilePick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPendingPhotoFile(file)
  }

  async function handlePhotoConfirm(croppedFile) {
    setUploading(true)
    await onPhotoChange(croppedFile)
    setUploading(false)
    setPendingPhotoFile(null)
  }

  return (
    <div className="sys-admin-card">
      {pendingPhotoFile && (
        <ImageCropModal
          file={pendingPhotoFile}
          uploading={uploading}
          onCancel={() => setPendingPhotoFile(null)}
          onConfirm={handlePhotoConfirm}
        />
      )}
      <div className="sys-admin-card__avatar">
        {admin.photo_url ? <img src={admin.photo_url} alt="" /> : <Users size={22} />}
        {editing && (
          <label className="sys-admin-card__edit">
            {uploading ? <Loader2 size={12} className="spin" /> : <Camera size={12} />}
            <input type="file" accept="image/*" onChange={handleFilePick} hidden disabled={uploading} />
          </label>
        )}
      </div>

      {!editing ? (
        <>
          <span className="sys-admin-card__name">{admin.full_name}</span>
          <span className="sys-admin-card__title">{admin.title}</span>
        </>
      ) : (
        <div className="sys-admin-card__fields">
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== admin.full_name && onFieldSave('full_name', name.trim())}
          />
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== admin.title && onFieldSave('title', title.trim())}
          />
          <button type="button" className="sys-admin-card__remove" onClick={onRemove} title="Remove">
            <Trash2 size={12} /> Remove
          </button>
        </div>
      )}
    </div>
  )
}
