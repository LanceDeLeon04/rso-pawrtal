import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, AlertTriangle, Loader2, CalendarDays, MapPin, UserCheck, Building2 } from 'lucide-react'
import { fetchEventVerification } from '../lib/eventVerification'
import { formatTime } from '../lib/dateUtils'
import './EventVerification.css'

const MEDIUM_LABELS = { f2f: 'Face-to-Face', online: 'Online', off_campus: 'Off-Campus' }

function fmtDate(d) {
  if (!d) return '—'
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function EventVerification() {
  const { token } = useParams()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [event, setEvent] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function load() {
    setLoading(true)
    const { data, error } = await fetchEventVerification(token)
    setLoading(false)
    if (error || !data || data.error) {
      setNotFound(true)
      return
    }
    setEvent(data.event)
  }

  if (loading) {
    return (
      <div className="evp evp--center">
        <Loader2 className="evp__spin" size={28} />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="evp evp--center">
        <div className="evp-card evp-card--narrow">
          <AlertTriangle size={32} color="#c23b3b" />
          <h2>Not found</h2>
          <p>This QR code doesn't match any approved activity on record with NU Laguna SDAO.</p>
        </div>
      </div>
    )
  }

  const timeRange = [event.start_time && formatTime(event.start_time), event.end_time && formatTime(event.end_time)]
    .filter(Boolean).join(' – ')

  return (
    <div className="evp">
      <header className="evp__header">
        <img src="/pawrtal-logo.png" alt="PAWrtal" className="evp__logo" />
        <div>
          <h1>Activity Verification</h1>
          <p>NU Laguna — Student Development and Activities Office</p>
        </div>
      </header>

      <div className="evp__body">
        <section className="evp-outcome evp-outcome--ok">
          <CheckCircle2 size={40} />
          <h2>This activity is verified and approved.</h2>
          <p>The details below are on record with SDAO and have not been altered.</p>
        </section>

        <section className="evp-card">
          <h3>{event.title}</h3>
          {event.organization && (
            <div className="evp-org">
              <Building2 size={14} />
              {event.organization}{event.organization_acronym ? ` (${event.organization_acronym})` : ''}
            </div>
          )}

          <div className="evp-grid">
            <div className="evp-field">
              <span><CalendarDays size={13} /> Date</span>
              <strong>{fmtDate(event.event_date)}</strong>
            </div>
            {timeRange && (
              <div className="evp-field">
                <span>Time</span>
                <strong>{timeRange}</strong>
              </div>
            )}
            <div className="evp-field">
              <span><MapPin size={13} /> Venue</span>
              {event.medium === 'online' ? (
                <strong>Online</strong>
              ) : event.venue_names?.length > 1 ? (
                <ul className="evp-venue-list">
                  {event.venue_names.map((name, i) => <li key={i}>{name}</li>)}
                </ul>
              ) : (
                <strong>{event.venue || '—'}</strong>
              )}
            </div>
            {event.medium && (
              <div className="evp-field">
                <span>Medium</span>
                <strong>{MEDIUM_LABELS[event.medium] || event.medium}</strong>
              </div>
            )}
          </div>

          <div className="evp-approval">
            <div className="evp-field">
              <span><UserCheck size={13} /> Approved by</span>
              <strong>{event.approved_by || '—'}</strong>
            </div>
            <div className="evp-field">
              <span>Approved on</span>
              <strong>{fmtDateTime(event.approved_at)}</strong>
            </div>
          </div>
        </section>
      </div>

      <footer className="evp__footer">
        NU Laguna SDAO — RSO PAWrtal · Verified via QR code printed on the official ACP Form
      </footer>
    </div>
  )
}
