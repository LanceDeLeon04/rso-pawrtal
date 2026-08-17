import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Loader2, AlertTriangle, CheckCircle2, Copy, Check, ShieldCheck, CalendarDays, Info, Clock,
  DoorOpen, DoorClosed, ShieldAlert, Paperclip, X, FileText,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import {
  getCurricularApplyLink, submitCurricularActivity,
  fileToBase64, formatFileSize, MAX_ATTACHMENT_MB, MAX_ATTACHMENTS,
} from '../lib/curricularActivities'
import EventCalendarModal from '../components/EventCalendarModal'
import './CurricularApply.css'

const ACTIVITY_TYPES = ['Curricular Requirement', 'Extension/Outreach', 'Seminar/Training', 'Competition', 'Other']

export default function CurricularApply() {
  const { token } = useParams()

  const [loading, setLoading] = useState(true)
  const [linkError, setLinkError] = useState('')
  const [linkLabel, setLinkLabel] = useState('')

  const [venues, setVenues] = useState([])
  const [form, setForm] = useState({
    faculty_name: '', faculty_email: '', faculty_personal_email: '', department: '',
    title: '', description: '', activity_type: '', activity_type_other: '',
    target_audience: '', target_participants: '', projected_budget: '', budget_source: '',
    medium: 'f2f', venue_id: '', venue_detail: '', online_platform: '',
    event_date: '', start_time: '', end_time: '',
  })
  const [attachments, setAttachments] = useState([]) // [{ name, type, size, data }]
  const [attachError, setAttachError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState(null) // { event_code }
  const [copied, setCopied] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const { data, error } = await getCurricularApplyLink(token)
      const { data: venueData } = await supabase.from('venues').select('id, name').eq('is_active', true).order('name')
      setVenues(venueData || [])
      setLoading(false)
      if (error || !data || data.error) {
        setLinkError(
          data?.error === 'inactive'
            ? 'This application link has been deactivated. Please ask SDAO for a new one.'
            : 'This application link is invalid. Please ask SDAO for a new one.'
        )
        return
      }
      setLinkLabel(data.label || '')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleFiles(e) {
    setAttachError('')
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return

    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      setAttachError(`You can attach up to ${MAX_ATTACHMENTS} files.`)
      return
    }
    const tooBig = files.find((f) => f.size > MAX_ATTACHMENT_MB * 1024 * 1024)
    if (tooBig) {
      setAttachError(`"${tooBig.name}" is over ${MAX_ATTACHMENT_MB}MB. Please attach a smaller file.`)
      return
    }

    try {
      const encoded = await Promise.all(files.map(async (f) => ({
        name: f.name, type: f.type, size: f.size, data: await fileToBase64(f),
      })))
      setAttachments((prev) => [...prev, ...encoded])
    } catch {
      setAttachError('Could not read one of the files. Please try again.')
    }
  }

  function removeAttachment(idx) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError('')

    if (!form.faculty_name.trim() || !form.faculty_email.trim() || !form.title.trim() || !form.event_date) {
      setSubmitError('Please fill in your name, email, activity title, and event date.')
      return
    }

    setSubmitting(true)
    const { data, error } = await submitCurricularActivity(token, { ...form, attachments })
    setSubmitting(false)

    if (error || !data?.ok) {
      setSubmitError(error?.message || 'Something went wrong submitting your activity. Please try again.')
      return
    }
    setResult(data)
  }

  function copyCode() {
    navigator.clipboard.writeText(result.event_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="curric-screen">
        <div className="curric-card curric-center"><Loader2 className="spin" size={22} /></div>
      </div>
    )
  }

  if (linkError) {
    return (
      <div className="curric-screen">
        <div className="curric-card curric-center">
          <AlertTriangle size={28} color="var(--danger)" />
          <p>{linkError}</p>
        </div>
      </div>
    )
  }

  if (result) {
    return (
      <div className="curric-screen">
        <div className="curric-card curric-center">
          <CheckCircle2 size={32} color="#16a34a" />
          <h1>Activity submitted</h1>
          <p className="curric-sub">
            Your Curricular Activity has been sent for Dean review. We've also emailed your event code to{' '}
            <strong>{form.faculty_email}</strong>.
          </p>
          <div className="curric-code-box">
            <span className="curric-code-label">Event Code</span>
            <div className="curric-code-row">
              <span className="curric-code">{result.event_code}</span>
              <button type="button" className="curric-copy-btn" onClick={copyCode}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <p className="curric-sub">Save this code — use it on the Track My Activity page to check its status anytime.</p>
          <Link to="/track" className="btn-primary curric-track-link">Track this activity</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="curric-screen">
      <div className="curric-card">
        <span className="curric-chip"><ShieldCheck size={14} /> Curricular Activity Application{linkLabel ? ` · ${linkLabel}` : ''}</span>
        <h1>Apply for a Curricular Activity</h1>
        <p className="curric-sub">
          For faculty members — no RSO PAWrtal account needed. Your application goes to the Dean and SDG
          Representative for review (in parallel), then to the Academic Director once both approve.
        </p>

        {submitError && <div className="curric-error"><AlertTriangle size={16} /><span>{submitError}</span></div>}

        <form onSubmit={handleSubmit} noValidate>
          <fieldset>
            <legend>Your Information</legend>
            <div className="curric-grid-2">
              <div className="field">
                <label>Full Name</label>
                <input value={form.faculty_name} onChange={(e) => set('faculty_name', e.target.value)} required />
              </div>
              <div className="field">
                <label>NU Email</label>
                <input type="email" value={form.faculty_email} onChange={(e) => set('faculty_email', e.target.value)} required />
              </div>
            </div>
            <div className="curric-grid-2">
              <div className="field">
                <label>Personal Email <span className="curric-optional">(optional)</span></label>
                <input type="email" value={form.faculty_personal_email} onChange={(e) => set('faculty_personal_email', e.target.value)} placeholder="e.g. name@gmail.com" />
              </div>
              <div className="field">
                <label>Department / College</label>
                <input value={form.department} onChange={(e) => set('department', e.target.value)} placeholder="e.g. College of Engineering" />
              </div>
            </div>
            <p className="curric-hint curric-hint--plain">
              <Info size={12} /> We'll send your event code and status updates to both addresses — the personal one is a backup in case your NU inbox is hard to reach.
            </p>
          </fieldset>

          <fieldset>
            <legend>Activity Details</legend>
            <div className="field">
              <label>Activity Title</label>
              <input value={form.title} onChange={(e) => set('title', e.target.value)} required />
            </div>
            <div className="field">
              <label>Description</label>
              <textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </div>
            <div className="curric-grid-2">
              <div className="field">
                <label>Activity Type</label>
                <select value={form.activity_type} onChange={(e) => set('activity_type', e.target.value)}>
                  <option value="">Select...</option>
                  {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {form.activity_type === 'Other' && (
                <div className="field">
                  <label>Specify</label>
                  <input value={form.activity_type_other} onChange={(e) => set('activity_type_other', e.target.value)} />
                </div>
              )}
              <div className="field">
                <label>Target Audience</label>
                <input value={form.target_audience} onChange={(e) => set('target_audience', e.target.value)} />
              </div>
              <div className="field">
                <label>Target Participants</label>
                <input type="number" min="0" value={form.target_participants} onChange={(e) => set('target_participants', e.target.value)} />
              </div>
              <div className="field">
                <label>Projected Budget</label>
                <input type="number" min="0" step="0.01" value={form.projected_budget} onChange={(e) => set('projected_budget', e.target.value)} />
              </div>
              <div className="field">
                <label>Budget Source</label>
                <input value={form.budget_source} onChange={(e) => set('budget_source', e.target.value)} />
              </div>
            </div>
          </fieldset>

          <fieldset>
            <div className="curric-legend-row">
              <legend>Schedule &amp; Venue</legend>
              <button type="button" className="curric-cal-btn" onClick={() => setShowCalendar(true)}>
                <CalendarDays size={13} /> View Calendar
              </button>
            </div>

            <div className="curric-grid-2">
              <div className="field">
                <label>Event Date</label>
                <input type="date" value={form.event_date} onChange={(e) => set('event_date', e.target.value)} required />
              </div>
              <div className="field">
                <label>Medium</label>
                <select value={form.medium} onChange={(e) => set('medium', e.target.value)}>
                  <option value="f2f">Face-to-face</option>
                  <option value="online">Online</option>
                  <option value="hybrid">Hybrid (Face-to-face + Online)</option>
                  <option value="off_campus">Off-campus</option>
                </select>
              </div>
              <div className="field">
                <label>Start Time</label>
                <input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
              </div>
              <div className="field">
                <label>End Time</label>
                <input type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
              </div>
            </div>

            {form.medium === 'hybrid' && (
              <p className="curric-hint">
                <Info size={12} /> Hybrid activity — fill in whichever parts apply: the on-campus venue below, the
                online platform, or both.
              </p>
            )}

            {(form.medium === 'f2f' || form.medium === 'hybrid') && (
              <div className="curric-grid-2">
                <div className="field">
                  <label>Venue</label>
                  <select value={form.venue_id} onChange={(e) => set('venue_id', e.target.value)}>
                    <option value="">Select...</option>
                    {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Room / Detail</label>
                  <input value={form.venue_detail} onChange={(e) => set('venue_detail', e.target.value)} placeholder="e.g. Room 301" />
                </div>
              </div>
            )}
            {(form.medium === 'online' || form.medium === 'hybrid') && (
              <div className="field">
                <label>Online Platform</label>
                <input value={form.online_platform} onChange={(e) => set('online_platform', e.target.value)} placeholder="e.g. MS Teams" />
              </div>
            )}

            <div className="curric-policies">
              <span className="curric-policies__label"><ShieldAlert size={13} /> Venue &amp; Date Policies</span>
              <ul className="curric-policies__list">
                <li>
                  <Clock size={13} />
                  <p>Every booking automatically gets a <strong>2‑hour ingress buffer</strong> before the start time and a <strong>2‑hour egress buffer</strong> after the end time. The venue is considered occupied for that whole padded window, not just your listed start/end.</p>
                </li>
                <li>
                  <DoorOpen size={13} />
                  <p>Venues can only be entered starting <strong>6:00 AM</strong> and must be cleared by <strong>9:00 PM</strong> (gate hours). A day starting before 8:00 AM or ending after 7:00 PM won't get the full 2‑hour buffer on that side.</p>
                </li>
                <li>
                  <DoorClosed size={13} />
                  <p>Need to go earlier or later than gate hours? That requires a separate Security Office letter — coordinate with SDAO once this application is approved.</p>
                </li>
                <li>
                  <Clock size={13} />
                  <p>Setting up the night before is only allowed at select large venues, from <strong>7:00–9:00 PM</strong>, and only if nothing else is already booked there during that window.</p>
                </li>
                <li>
                  <ShieldAlert size={13} />
                  <p>Activities during a declared holiday or exam period are discouraged and reviewed with extra scrutiny — pick another date where possible.</p>
                </li>
                <li>
                  <Info size={13} />
                  <p>A venue that's already booked for an overlapping time (including its ingress/egress buffers) will be flagged during review — use "View Calendar" above to check ahead of time.</p>
                </li>
              </ul>
            </div>
          </fieldset>

          <fieldset>
            <legend>Attachments</legend>
            <p className="curric-hint curric-hint--plain">
              <Info size={12} /> Same set the RSO Event Application uses where relevant — program design/matrix, budget breakdown, endorsement letter, or any supporting document. Up to {MAX_ATTACHMENTS} files, {MAX_ATTACHMENT_MB}MB each.
            </p>

            <label className="curric-file-drop">
              <Paperclip size={16} />
              <span>Click to attach files</span>
              <input type="file" multiple onChange={handleFiles} hidden />
            </label>

            {attachError && <div className="curric-error curric-error--tight"><AlertTriangle size={14} /><span>{attachError}</span></div>}

            {attachments.length > 0 && (
              <ul className="curric-file-list">
                {attachments.map((f, idx) => (
                  <li key={`${f.name}-${idx}`}>
                    <FileText size={14} />
                    <span className="curric-file-list__name">{f.name}</span>
                    <span className="curric-file-list__size">{formatFileSize(f.size)}</span>
                    <button type="button" onClick={() => removeAttachment(idx)} aria-label="Remove file"><X size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <button className="btn-primary curric-submit" type="submit" disabled={submitting}>
            {submitting ? <><Loader2 size={16} className="spin" /> Submitting…</> : 'Submit Application'}
          </button>
        </form>
      </div>

      {showCalendar && <EventCalendarModal onClose={() => setShowCalendar(false)} />}
    </div>
  )
}
