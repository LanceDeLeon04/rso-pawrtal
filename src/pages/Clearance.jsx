import { useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck, Loader2, AlertCircle, CalendarClock, Building2, CheckCircle2,
  Clock, AlertTriangle, CalendarPlus, FileCheck, X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier } from '../context/AuthContext'
import { toISODate } from '../lib/dateUtils'
import { reconcileOwnOverdueAssignments } from '../lib/clearanceReconcile'
import './Clearance.css'

const STATUS_META = {
  pending: { label: 'Pending', tone: 'warn', icon: Clock },
  extended: { label: 'Extended', tone: 'blue', icon: CalendarClock },
  overdue: { label: 'Overdue', tone: 'danger', icon: AlertTriangle },
  cleared: { label: 'Cleared', tone: 'ok', icon: CheckCircle2 },
}

function daysUntil(dateStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.round((target - today) / (1000 * 60 * 60 * 24))
}

export default function Clearance() {
  const { profile } = useAuth()
  const admin = isAdminTier(profile?.role)
  const canManage = ['sdao_assistant', 'sdao_supervisor', 'academic_director', 'system_admin'].includes(profile?.role)
  const myOrgId = profile?.org_memberships?.[0]?.org_id

  const [clearances, setClearances] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [extendTarget, setExtendTarget] = useState(null)
  const [extendDate, setExtendDate] = useState('')
  const [extending, setExtending] = useState(false)
  const [extendError, setExtendError] = useState('')
  const [clearingId, setClearingId] = useState(null)

  useEffect(() => {
    loadClearances()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  async function loadClearances() {
    if (!profile) return
    setLoading(true)
    setError('')

    // Materialize any overdue non-event task into a blocking clearance
    // row for orgs the caller belongs to first — see
    // src/lib/clearanceReconcile.js for why this can't wait for an
    // admin to visit Assignments.
    if (!admin) await reconcileOwnOverdueAssignments(profile)

    let q = supabase
      .from('clearances')
      .select(`
        id, org_id, event_id, assignment_id, reason, status, deadline, extended_deadline,
        report_submission_id, cleared_at,
        organizations ( name, acronym ),
        events ( title, event_date ),
        assignments ( title, due_date )
      `)
      .order('deadline', { ascending: true })

    if (!admin && myOrgId) q = q.eq('org_id', myOrgId)
    if (!admin && !myOrgId) q = q.eq('org_id', '00000000-0000-0000-0000-000000000000')

    const { data, error: err } = await q
    if (err) {
      setError('Could not load clearance records. Please try again.')
      setClearances([])
      setLoading(false)
      return
    }

    // Self-healing: flip any pending/extended row whose effective deadline
    // has already passed to 'overdue' — there's no server cron, so this
    // reconciles status on every page load.
    const today = toISODate(new Date())
    const rows = data || []
    const toFlip = rows.filter((c) => {
      if (!['pending', 'extended'].includes(c.status)) return false
      const effective = c.extended_deadline || c.deadline
      return effective < today
    })

    if (toFlip.length > 0) {
      await Promise.all(toFlip.map((c) => supabase.from('clearances').update({ status: 'overdue' }).eq('id', c.id)))
    }

    const flippedIds = new Set(toFlip.map((c) => c.id))
    setClearances(rows.map((c) => (flippedIds.has(c.id) ? { ...c, status: 'overdue' } : c)))
    setLoading(false)
  }

  const filtered = useMemo(
    () => (statusFilter === 'all' ? clearances : clearances.filter((c) => c.status === statusFilter)),
    [clearances, statusFilter]
  )

  const summary = useMemo(() => {
    const s = { pending: 0, extended: 0, overdue: 0, cleared: 0 }
    clearances.forEach((c) => { if (s[c.status] !== undefined) s[c.status] += 1 })
    return s
  }, [clearances])

  function openExtend(c) {
    setExtendTarget(c)
    setExtendDate(c.extended_deadline || c.deadline)
    setExtendError('')
  }

  async function handleExtend(e) {
    e.preventDefault()
    if (!extendDate) {
      setExtendError('Please choose a new deadline.')
      return
    }
    setExtending(true)
    await supabase
      .from('clearances')
      .update({ extended_deadline: extendDate, status: 'extended' })
      .eq('id', extendTarget.id)
    setExtending(false)
    setExtendTarget(null)
    loadClearances()
  }

  async function handleManualClear(c) {
    const what = c.events?.title || c.assignments?.title || c.reason || 'this item'
    if (!window.confirm(`Mark ${c.organizations?.acronym}'s clearance for "${what}" as cleared?`)) return
    setClearingId(c.id)
    await supabase
      .from('clearances')
      .update({ status: 'cleared', cleared_by: profile.id, cleared_at: new Date().toISOString() })
      .eq('id', c.id)

    // Keep the Assignments page in sync: clearing the issue here should
    // also resolve the assignment that opened it, otherwise it keeps
    // showing as outstanding there even though it's cleared here.
    if (c.assignment_id) {
      await supabase.from('assignments')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', c.assignment_id)
        .neq('status', 'approved')
    } else if (c.event_id) {
      await supabase.from('assignments')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('event_id', c.event_id)
        .eq('auto_generated', true)
        .neq('status', 'approved')
    }

    setClearingId(null)
    loadClearances()
  }

  return (
    <div className="clr-page">
      <div className="clr-header">
        <h2 className="clr-header__title"><ShieldCheck size={17} color="var(--nu-blue-700)" /> Clearance</h2>
        <p className="clr-header__sub">
          Every approved activity opens a report obligation due 7 days after the event date, and any non-event
          task left past its due date opens one too. No report, no new submissions until it's cleared.
        </p>
      </div>

      <div className="clr-summary">
        {Object.entries(STATUS_META).map(([key, meta]) => {
          const Icon = meta.icon
          return (
            <button
              key={key}
              className={`clr-summary__card clr-summary__card--${meta.tone} ${statusFilter === key ? 'clr-summary__card--active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
            >
              <Icon size={16} />
              <span className="clr-summary__value">{summary[key]}</span>
              <span className="clr-summary__label">{meta.label}</span>
            </button>
          )
        })}
      </div>

      {error && <div className="clr-error"><AlertCircle size={15} /> {error}</div>}

      <div className="clr-list-wrap">
        {loading ? (
          <div className="clr-loading"><Loader2 size={22} className="spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="clr-empty">
            <ShieldCheck size={26} strokeWidth={1.6} />
            <p>{clearances.length === 0 ? 'No clearance obligations on record.' : 'Nothing matches this filter.'}</p>
          </div>
        ) : (
          <table className="clr-table">
            <thead>
              <tr>
                {admin && <th>Organization</th>}
                <th>Activity</th>
                <th>Event Date</th>
                <th>Report Due</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const meta = STATUS_META[c.status]
                const effectiveDeadline = c.extended_deadline || c.deadline
                const remaining = daysUntil(effectiveDeadline)
                const isTaskIssue = !c.event_id
                return (
                  <tr key={c.id}>
                    {admin && (
                      <td>
                        <span className="clr-org"><Building2 size={13} /> {c.organizations?.acronym}</span>
                      </td>
                    )}
                    <td className="clr-table__title">
                      {c.events?.title || c.assignments?.title || c.reason || '—'}
                      {isTaskIssue && <span className="clr-task-tag">task</span>}
                    </td>
                    <td>{c.events?.event_date || '—'}</td>
                    <td>
                      {effectiveDeadline}
                      {c.status !== 'cleared' && (
                        <span className={`clr-countdown ${remaining < 0 ? 'clr-countdown--over' : ''}`}>
                          {remaining < 0 ? ` · overdue by ${Math.abs(remaining)}d` : ` · ${remaining}d left`}
                        </span>
                      )}
                      {c.extended_deadline && <span className="clr-extended-tag">extended</span>}
                    </td>
                    <td>
                      <span className={`clr-badge clr-badge--${meta.tone}`}>{meta.label}</span>
                      {c.report_submission_id && c.status !== 'cleared' && (
                        <span className="clr-report-flag"><FileCheck size={11} /> report in review</span>
                      )}
                    </td>
                    <td>
                      <div className="clr-row-actions">
                        {!admin && c.status !== 'cleared' && !isTaskIssue && (
                          <Link to="/submissions" className="clr-link-btn">Submit Report</Link>
                        )}
                        {!admin && c.status !== 'cleared' && isTaskIssue && (
                          <Link to="/assignments" className="clr-link-btn">View Task</Link>
                        )}
                        {canManage && c.status !== 'cleared' && (
                          <>
                            <button className="clr-icon-btn" title="Extend deadline" onClick={() => openExtend(c)}>
                              <CalendarPlus size={14} />
                            </button>
                            <button
                              className="clr-icon-btn clr-icon-btn--ok"
                              title="Mark cleared"
                              onClick={() => handleManualClear(c)}
                              disabled={clearingId === c.id}
                            >
                              {clearingId === c.id ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {extendTarget && (
        <div className="clr-modal-backdrop" onClick={() => setExtendTarget(null)}>
          <form className="clr-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleExtend}>
            <button type="button" className="clr-modal__close" onClick={() => setExtendTarget(null)}><X size={18} /></button>
            <h3 className="clr-modal__title">Extend Deadline</h3>
            <p className="clr-modal__sub">
              {extendTarget.organizations?.acronym} — {extendTarget.events?.title || extendTarget.assignments?.title || extendTarget.reason}
            </p>

            {extendError && <div className="clr-form-error"><AlertCircle size={14} /> {extendError}</div>}

            <label className="clr-field">
              New Deadline
              <input type="date" value={extendDate} onChange={(e) => setExtendDate(e.target.value)} required />
            </label>

            <button type="submit" className="clr-btn clr-btn--gold clr-btn--full" disabled={extending}>
              {extending ? <Loader2 size={15} className="spin" /> : 'Save Extension'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
