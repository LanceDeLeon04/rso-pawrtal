import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Loader2, AlertTriangle, CheckCircle2, Copy, Check, ShieldCheck, CalendarDays, Info, Clock,
  DoorOpen, DoorClosed, ShieldAlert, Paperclip, X, FileText, AlertCircle,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import {
  getCurricularApplyLink, submitCurricularActivity,
  fileToBase64, bytesToBase64, formatFileSize, MAX_ATTACHMENT_MB, MAX_ATTACHMENTS,
  fetchDeanForDepartment, fetchSdgRepresentatives,
} from '../lib/curricularActivities'
import { checkVenueAvailability } from '../lib/venueAvailability'
import { generateACPFormPdf } from '../lib/acpPdf'
import { toISODate, formatTime } from '../lib/dateUtils'
import EventCalendarModal from '../components/EventCalendarModal'
import './CurricularApply.css'

const ACTIVITY_TYPES = ['Curricular Requirement', 'Extension/Outreach', 'Seminar/Training', 'Competition', 'Other']

const COLLEGE_OPTIONS = [
  'School of Computer Studies',
  'School of Arts and Sciences',
  'School of Accountancy, Business, and Management',
  'School of Engineering and Architecture',
]

// Same two venues that get a cascading Building/Floor/Room or
// Laboratory picker on the RSO Event Application, instead of a
// free-text detail field.
const VENUE_DETAIL_PROMPTS = {
  Room: 'Select the building, floor, and room',
  Laboratory: 'Select the laboratory',
}

export default function CurricularApply() {
  const { token } = useParams()

  const [loading, setLoading] = useState(true)
  const [linkError, setLinkError] = useState('')
  const [linkLabel, setLinkLabel] = useState('')

  const [venues, setVenues] = useState([])
  const [venueRooms, setVenueRooms] = useState([])
  const [venueLabs, setVenueLabs] = useState([])
  const [roomSel, setRoomSel] = useState({ building: '', floor: '', number: '' })
  const [labId, setLabId] = useState('')
  const [venueConflict, setVenueConflict] = useState(null)
  const [venueAdvisory, setVenueAdvisory] = useState(null)
  const [checkingVenue, setCheckingVenue] = useState(false)
  const [form, setForm] = useState({
    faculty_name: '', faculty_email: '', faculty_personal_email: '', department: '',
    title: '', description: '', activity_type: '', activity_type_other: '',
    target_audience: '', target_participants: '', projected_budget: '', budget_source: '',
    medium: 'f2f', venue_id: '', venue_detail: '', online_platform: '',
    event_date: '', start_time: '', end_time: '', sdg_rep_id: '',
  })
  const [sdgReps, setSdgReps] = useState([])
  const [detectedDean, setDetectedDean] = useState(null)
  const [detectingDean, setDetectingDean] = useState(false)
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
      const [{ data: venueData }, { data: rooms }, { data: labs }] = await Promise.all([
        supabase.from('venues').select('id, name').eq('is_active', true).order('name'),
        supabase.from('venue_rooms').select('id, building, floor, room_number').order('building').order('floor').order('sort_order'),
        supabase.from('venue_labs').select('id, name, care_of, location').order('sort_order'),
      ])
      setVenues(venueData || [])
      setVenueRooms(rooms || [])
      setVenueLabs(labs || [])
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
      const { data: reps } = await fetchSdgRepresentatives()
      setSdgReps(reps)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Auto-detect the Dean the moment a Department is picked — same
  // fixed School→Dean roster SDAO manages in Settings. Faculty never
  // types a Dean in themselves; this just confirms who it resolved to.
  useEffect(() => {
    if (!form.department) {
      setDetectedDean(null)
      return
    }
    let cancelled = false
    setDetectingDean(true)
    fetchDeanForDepartment(form.department).then(({ data }) => {
      if (cancelled) return
      setDetectedDean(data)
      setDetectingDean(false)
    })
    return () => { cancelled = true }
  }, [form.department])

  const roomBuildingOptionsFor = () => [...new Set(venueRooms.map((r) => r.building))]
  const roomFloorOptionsFor = (building) => [...new Set(venueRooms.filter((r) => r.building === building).map((r) => r.floor))]
  const roomNumberOptionsFor = (building, floor) => venueRooms.filter((r) => r.building === building && r.floor === floor)

  const selectedVenue = venues.find((v) => v.id === form.venue_id)
  const detailPrompt = selectedVenue ? VENUE_DETAIL_PROMPTS[selectedVenue.name] : null

  // Live venue-availability check — same blocked/already-booked/heads-up
  // notices as the RSO Event Application, so faculty find out here
  // instead of only at review time.
  useEffect(() => {
    const usesOnCampusVenue = form.medium === 'f2f' || form.medium === 'hybrid'
    if (!usesOnCampusVenue || !form.venue_id || !form.event_date) {
      setVenueConflict(null)
      setVenueAdvisory(null)
      return
    }
    let cancelled = false
    setCheckingVenue(true)
    checkVenueAvailability(supabase, form.venue_id, form.event_date, form.start_time, form.end_time, '', '')
      .then((result) => {
        if (cancelled) return
        setVenueConflict(result?.blocking ? result.message : null)
        setVenueAdvisory(result && !result.blocking ? result.message : null)
        setCheckingVenue(false)
      })
    return () => { cancelled = true }
  }, [form.medium, form.venue_id, form.event_date, form.start_time, form.end_time])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleFiles(e) {
    setAttachError('')
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return

    // The auto-generated ACP always takes one of the (up to 8) attachment
    // slots, so cap manually-picked files one lower to leave room for it.
    if (attachments.length + files.length > MAX_ATTACHMENTS - 1) {
      setAttachError(`You can attach up to ${MAX_ATTACHMENTS - 1} files (the ACP Form is auto-generated and attached separately).`)
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
    if (venueConflict) {
      setSubmitError('Please resolve the venue conflict below before submitting.')
      return
    }

    setSubmitting(true)

    // Auto-generate the filled ACP Form PDF from what's being submitted
    // and attach it — same as the RSO Event Application, no manual
    // upload needed. Best-effort: if it fails for some reason, still
    // let the actual application go through.
    let allAttachments = attachments
    try {
      const activityTypeLabel = form.activity_type === 'Other' ? form.activity_type_other : form.activity_type
      const venueLabel = selectedVenue
        ? [selectedVenue.name, form.venue_detail].filter(Boolean).join(' — ')
        : (form.online_platform || '')
      const timeRange = [form.start_time && formatTime(form.start_time), form.end_time && formatTime(form.end_time)].filter(Boolean).join(' – ')

      const pdfBytes = await generateACPFormPdf({
        applicationDate: toISODate(new Date()),
        orgName: form.department || '',
        contactPerson: form.faculty_name,
        position: 'Faculty',
        email: form.faculty_email,
        title: form.title,
        activityTypeLabel,
        venueAddress: venueLabel,
        venueAddressLines: [venueLabel],
        targetAudience: form.target_audience,
        targetParticipants: form.target_participants,
        eventDate: form.event_date,
        timeRange,
        projectedBudget: form.projected_budget,
        budgetSource: form.budget_source,
        description: form.description,
      })
      const acpBase64 = bytesToBase64(pdfBytes)
      allAttachments = [
        { name: `ACP-Form-${form.title || 'activity'}.pdf`, type: 'application/pdf', size: pdfBytes.length, data: acpBase64 },
        ...attachments,
      ]
    } catch (err) {
      console.error('Could not auto-generate ACP PDF', err)
    }

    const { data, error } = await submitCurricularActivity(token, { ...form, attachments: allAttachments })
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
                <select value={form.department} onChange={(e) => set('department', e.target.value)}>
                  <option value="">Select...</option>
                  {COLLEGE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            {form.department && (
              <p className="curric-hint curric-hint--plain">
                {detectingDean ? (
                  <><Loader2 size={12} className="spin" /> Detecting Dean…</>
                ) : detectedDean ? (
                  <><Info size={12} /> Dean: <strong>{detectedDean.person_name}</strong> — auto-detected for this department; their approval link is sent automatically once you submit.</>
                ) : (
                  <><AlertCircle size={12} /> No Dean is on file for this department yet — SDAO will assign one manually after you submit.</>
                )}
              </p>
            )}
            <div className="field">
              <label>SDG Representative</label>
              <select value={form.sdg_rep_id} onChange={(e) => set('sdg_rep_id', e.target.value)}>
                <option value="">Select...</option>
                {sdgReps.map((r) => <option key={r.id} value={r.id}>{r.person_name}</option>)}
              </select>
              <p className="curric-hint curric-hint--plain">
                <Info size={12} /> Their approval link is generated and sent automatically once you submit — no need to contact them yourself.
              </p>
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
              <>
                <div className="curric-grid-2">
                  <div className="field">
                    <label>Venue</label>
                    <select
                      value={form.venue_id}
                      onChange={(e) => {
                        set('venue_id', e.target.value)
                        set('venue_detail', '')
                        setRoomSel({ building: '', floor: '', number: '' })
                        setLabId('')
                      }}
                    >
                      <option value="">Select...</option>
                      {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                  {!detailPrompt && (
                    <div className="field">
                      <label>Room / Detail</label>
                      <input value={form.venue_detail} onChange={(e) => set('venue_detail', e.target.value)} placeholder="e.g. Room 301" />
                    </div>
                  )}
                </div>

                {selectedVenue?.name === 'Room' && (
                  <div className="curric-grid-2">
                    <div className="field">
                      <label>Building</label>
                      <select
                        value={roomSel.building}
                        onChange={(e) => {
                          const next = { building: e.target.value, floor: '', number: '' }
                          setRoomSel(next)
                          set('venue_detail', '')
                        }}
                      >
                        <option value="">Select building</option>
                        {roomBuildingOptionsFor().map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Floor</label>
                      <select
                        value={roomSel.floor}
                        disabled={!roomSel.building}
                        onChange={(e) => {
                          const next = { ...roomSel, floor: e.target.value, number: '' }
                          setRoomSel(next)
                          set('venue_detail', '')
                        }}
                      >
                        <option value="">Select floor</option>
                        {roomFloorOptionsFor(roomSel.building).map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Room</label>
                      <select
                        value={roomSel.number}
                        disabled={!roomSel.floor}
                        onChange={(e) => {
                          const room = roomNumberOptionsFor(roomSel.building, roomSel.floor).find((r) => r.room_number === e.target.value)
                          setRoomSel({ ...roomSel, number: e.target.value })
                          set('venue_detail', room ? `${room.building}, ${room.floor} Flr — ${room.room_number}` : '')
                        }}
                      >
                        <option value="">Select room</option>
                        {roomNumberOptionsFor(roomSel.building, roomSel.floor).map((r) => (
                          <option key={r.id} value={r.room_number}>{r.room_number}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {selectedVenue?.name === 'Laboratory' && (
                  <div className="field">
                    <label>Laboratory</label>
                    <select
                      value={labId}
                      onChange={(e) => {
                        const lab = venueLabs.find((l) => l.id === e.target.value)
                        setLabId(e.target.value)
                        set('venue_detail', lab ? `${lab.name} c/o ${lab.care_of}, ${lab.location}` : '')
                      }}
                    >
                      <option value="">Select laboratory</option>
                      {venueLabs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                )}

                {form.venue_id && form.event_date && (
                  <>
                    {checkingVenue && (
                      <div className="curric-hint curric-hint--plain">
                        <Loader2 size={12} className="spin" /> Checking venue availability…
                      </div>
                    )}
                    {venueConflict && (
                      <div className="curric-error curric-error--tight"><AlertCircle size={14} /><span>{venueConflict}</span></div>
                    )}
                    {!venueConflict && venueAdvisory && (
                      <div className="curric-hint"><AlertCircle size={12} /> {venueAdvisory}</div>
                    )}
                  </>
                )}
              </>
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
              <Info size={12} /> A filled Activity Concept Paper (ACP) is generated automatically from this form and attached for you — no need to upload one. You can still attach other supporting documents (program design/matrix, budget breakdown, endorsement letter, etc.) — up to {MAX_ATTACHMENTS - 1} files, {MAX_ATTACHMENT_MB}MB each.
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

          <button className="btn-primary curric-submit" type="submit" disabled={submitting || !!venueConflict || checkingVenue}>
            {submitting ? <><Loader2 size={16} className="spin" /> Submitting…</> : 'Submit Application'}
          </button>
        </form>
      </div>

      {showCalendar && <EventCalendarModal onClose={() => setShowCalendar(false)} />}
    </div>
  )
}
