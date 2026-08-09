import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import './VenueMultiSelect.css'

// Dropdown + checkbox venue picker. Selecting a date (handled by the
// parent, via the `availability` prop) triggers a per-venue availability
// check; each checked venue shows its own status inline so the applicant
// can see exactly which venue(s) are the problem, without losing the
// venues that are fine.
//
// `availability` is keyed by venue id: { [venueId]: { status: 'checking' | 'available' | 'unavailable' | 'advisory', message } }
export default function VenueMultiSelect({
  venues,
  selectedIds,
  onChange,
  availability = {},
  disabled = false,
  labelFor,
  placeholder = 'Select venue(s)',
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function toggle(id) {
    if (disabled) return
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id]
    onChange(next)
  }

  const nameFor = (v) => (labelFor ? labelFor(v) : v.name)
  const selectedVenues = venues.filter((v) => selectedIds.includes(v.id))

  const summary = selectedVenues.length === 0
    ? placeholder
    : selectedVenues.length === 1
      ? nameFor(selectedVenues[0])
      : `${selectedVenues.length} venues selected`

  const hasUnavailable = selectedIds.some((id) => availability[id]?.status === 'unavailable')

  return (
    <div className={`vms-root${disabled ? ' vms-disabled' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`vms-trigger${hasUnavailable ? ' vms-trigger-error' : ''}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
      >
        <span className={selectedVenues.length ? '' : 'vms-placeholder'}>{summary}</span>
        <ChevronDown size={16} className={`vms-chevron${open ? ' vms-chevron-open' : ''}`} />
      </button>

      {open && (
        <div className="vms-panel">
          {venues.map((v) => {
            const checked = selectedIds.includes(v.id)
            const status = availability[v.id]
            return (
              <label key={v.id} className="vms-option">
                <input type="checkbox" checked={checked} onChange={() => toggle(v.id)} />
                <span className="vms-option-name">{nameFor(v)}</span>
                {checked && status?.status === 'checking' && (
                  <Loader2 size={13} className="vms-spin" />
                )}
                {checked && status?.status === 'available' && (
                  <CheckCircle2 size={13} className="vms-icon-ok" />
                )}
                {checked && status?.status === 'unavailable' && (
                  <XCircle size={13} className="vms-icon-bad" />
                )}
                {checked && status?.status === 'advisory' && (
                  <AlertTriangle size={13} className="vms-icon-warn" />
                )}
              </label>
            )
          })}
        </div>
      )}

      {selectedVenues.length > 0 && (
        <ul className="vms-status-list">
          {selectedVenues.map((v) => {
            const status = availability[v.id]
            if (!status) return null
            return (
              <li key={v.id} className={`vms-status-row vms-status-${status.status}`}>
                {status.status === 'checking' && <Loader2 size={13} className="vms-spin" />}
                {status.status === 'available' && <CheckCircle2 size={13} />}
                {status.status === 'unavailable' && <XCircle size={13} />}
                {status.status === 'advisory' && <AlertTriangle size={13} />}
                <span>
                  <strong>{nameFor(v)}:</strong>{' '}
                  {status.status === 'checking' ? 'Checking availability…'
                    : status.status === 'available' ? 'Available on the chosen date.'
                    : status.message}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
