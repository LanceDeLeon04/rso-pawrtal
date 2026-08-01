import { useEffect, useState } from 'react'
import {
  FileText, Download, Plus, X, Loader2, AlertCircle, Pencil, Trash2,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier } from '../context/AuthContext'
import './Templates.css'

const STANDARD_DOCS = [
  { name: 'ACP Form', category: 'event_application' },
  { name: 'Attachments Template', category: 'event_application' },
  { name: 'PARF Template', category: 'report' },
  { name: 'Liquidation Report', category: 'report' },
  { name: 'Narrative Report', category: 'report' },
  { name: 'Evaluation Report', category: 'report' },
]

const CATEGORY_META = {
  event_application: { label: 'Event Application', tone: 'blue' },
  report: { label: 'Report', tone: 'gold' },
  other: { label: 'Other', tone: 'muted' },
}

const EMPTY_FORM = { name: '', customName: '', category: 'event_application', version: '' }

export default function Templates() {
  const { profile } = useAuth()
  const admin = isAdminTier(profile?.role)

  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    loadTemplates()
  }, [])

  async function loadTemplates() {
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase
      .from('templates')
      .select('id, name, category, file_url, version, updated_at, updater:profiles!templates_updated_by_fkey ( full_name )')
      .order('category', { ascending: true })
      .order('name', { ascending: true })

    if (err) {
      setError('Could not load templates. Please try again.')
      setTemplates([])
    } else {
      setTemplates(data || [])
    }
    setLoading(false)
  }

  function openUploadModal(existing) {
    if (existing) {
      const isStandard = STANDARD_DOCS.some((d) => d.name === existing.name)
      setForm({
        name: isStandard ? existing.name : '__custom__',
        customName: isStandard ? '' : existing.name,
        category: existing.category,
        version: existing.version || '',
      })
    } else {
      setForm(EMPTY_FORM)
    }
    setFile(null)
    setFormError('')
    setShowModal(true)
  }

  function handleNameSelect(value) {
    const match = STANDARD_DOCS.find((d) => d.name === value)
    setForm({
      ...form,
      name: value,
      category: match ? match.category : form.category,
    })
  }

  async function handleUpload(e) {
    e.preventDefault()
    setFormError('')

    const finalName = form.name === '__custom__' ? form.customName.trim() : form.name
    if (!finalName) {
      setFormError('Please select or enter a template name.')
      return
    }
    if (!file) {
      setFormError('Please choose a file to upload.')
      return
    }

    setSaving(true)
    const ext = file.name.split('.').pop()
    const path = `${form.category}/${finalName.replace(/\s+/g, '-')}-${Date.now()}.${ext}`

    const { error: upErr } = await supabase.storage.from('templates').upload(path, file)
    if (upErr) {
      setSaving(false)
      setFormError('Could not upload the file. Please try again.')
      return
    }

    const { data: pub } = supabase.storage.from('templates').getPublicUrl(path)

    const existing = templates.find((t) => t.name === finalName)
    const payload = {
      name: finalName,
      category: form.category,
      file_url: pub.publicUrl,
      version: form.version || null,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    }

    const { error: dbErr } = existing
      ? await supabase.from('templates').update(payload).eq('id', existing.id)
      : await supabase.from('templates').insert(payload)

    setSaving(false)
    if (dbErr) {
      setFormError('File uploaded, but saving the template record failed. Please try again.')
      return
    }

    setShowModal(false)
    loadTemplates()
  }

  async function handleDelete(id) {
    setDeletingId(id)
    await supabase.from('templates').delete().eq('id', id)
    setDeletingId(null)
    loadTemplates()
  }

  const grouped = templates.reduce((acc, t) => {
    const key = t.category || 'other'
    acc[key] = acc[key] || []
    acc[key].push(t)
    return acc
  }, {})

  return (
    <div className="tpl-page">
      <div className="tpl-toolbar">
        <div>
          <h2 className="tpl-toolbar__title"><FileText size={17} color="var(--nu-blue-700)" /> Templates</h2>
          <p className="tpl-toolbar__sub">Official SDAO forms for event applications and activity reports.</p>
        </div>
        {admin && (
          <button className="tpl-btn tpl-btn--gold" onClick={() => openUploadModal(null)}>
            <Plus size={15} /> Upload Template
          </button>
        )}
      </div>

      {error && <div className="tpl-error"><AlertCircle size={15} /> {error}</div>}

      {loading ? (
        <div className="tpl-loading"><Loader2 size={22} className="spin" /></div>
      ) : templates.length === 0 ? (
        <div className="tpl-empty">
          <FileText size={26} strokeWidth={1.6} />
          <p>{admin ? 'No templates uploaded yet.' : 'No templates are available yet — check back soon.'}</p>
        </div>
      ) : (
        Object.entries(CATEGORY_META).map(([key, meta]) => {
          const items = grouped[key]
          if (!items?.length) return null
          return (
            <div key={key} className="tpl-section">
              <span className={`tpl-section__label tpl-section__label--${meta.tone}`}>{meta.label}</span>
              <div className="tpl-grid">
                {items.map((t) => (
                  <div key={t.id} className="tpl-card">
                    <div className="tpl-card__icon"><FileText size={18} /></div>
                    <div className="tpl-card__body">
                      <span className="tpl-card__name">{t.name}</span>
                      <span className="tpl-card__meta">
                        {t.version && `${t.version} · `}
                        Updated {t.updated_at?.slice(0, 10)}
                        {t.updater?.full_name && ` by ${t.updater.full_name}`}
                      </span>
                    </div>
                    <div className="tpl-card__actions">
                      <a href={t.file_url} target="_blank" rel="noreferrer" className="tpl-icon-btn" title="Download">
                        <Download size={15} />
                      </a>
                      {admin && (
                        <>
                          <button className="tpl-icon-btn" title="Replace" onClick={() => openUploadModal(t)}>
                            <Pencil size={14} />
                          </button>
                          <button
                            className="tpl-icon-btn tpl-icon-btn--danger"
                            title="Delete"
                            onClick={() => handleDelete(t.id)}
                            disabled={deletingId === t.id}
                          >
                            {deletingId === t.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })
      )}

      {showModal && (
        <div className="tpl-modal-backdrop" onClick={() => setShowModal(false)}>
          <form className="tpl-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleUpload}>
            <button type="button" className="tpl-modal__close" onClick={() => setShowModal(false)}><X size={18} /></button>
            <h3 className="tpl-modal__title">Upload Template</h3>

            {formError && <div className="tpl-form-error"><AlertCircle size={14} /> {formError}</div>}

            <label className="tpl-field">
              Template Name
              <select value={form.name} onChange={(e) => handleNameSelect(e.target.value)} required>
                <option value="">Select a document type</option>
                {STANDARD_DOCS.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
                <option value="__custom__">Other (custom name)</option>
              </select>
            </label>

            {form.name === '__custom__' && (
              <label className="tpl-field">
                Custom Name
                <input value={form.customName} onChange={(e) => setForm({ ...form, customName: e.target.value })} required />
              </label>
            )}

            <div className="tpl-field-row">
              <label className="tpl-field">
                Category
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="event_application">Event Application</option>
                  <option value="report">Report</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="tpl-field">
                Version
                <input placeholder="e.g. v2.1" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
              </label>
            </div>

            <label className="tpl-field">
              File
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} required />
            </label>

            <button type="submit" className="tpl-btn tpl-btn--gold tpl-btn--full" disabled={saving}>
              {saving ? <Loader2 size={15} className="spin" /> : 'Save Template'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
