import { useEffect, useState } from 'react'
import {
  LayoutDashboard, CalendarDays, Inbox, ShieldCheck, Building2,
  AlertTriangle, ChevronRight, Loader2, CheckCircle2, Clock, ClipboardCheck,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth, isAdminTier, isSHSReviewer } from '../context/AuthContext'
import { toISODate, formatTime } from '../lib/dateUtils'
import { reconcileOwnOverdueAssignments } from '../lib/clearanceReconcile'
import AnalyticsSection from '../components/analytics/AnalyticsSection'
import './Dashboard.css'

const REVIEW_STAGE_BY_ROLE = {
  sdao_assistant: ['submitted', 'assistant_review'],
  sdao_supervisor: ['supervisor_endorsement', 'shs_supervisor_endorsement'],
  academic_director: ['director_approval', 'shs_director_approval'],
  executive_director: ['shs_executive_approval'],
  sdao_shs: ['shs_review'],
  shs_principal: ['shs_principal_approval'],
}

const OPEN_STAGES = [
  'submitted', 'assistant_review', 'supervisor_endorsement', 'director_approval',
  'shs_review', 'shs_supervisor_endorsement', 'shs_principal_approval',
  'shs_director_approval', 'shs_executive_approval',
]

export default function Dashboard() {
  const { profile } = useAuth()
  // SDAO-SHS/SHS Principal get the same "reviewer dashboard" shape as
  // College admins — RLS (migration 052) transparently scopes every
  // query below to department = 'shs' rows only for these two roles,
  // so no manual org/department filtering is needed here.
  const admin = isAdminTier(profile?.role) || isSHSReviewer(profile?.role)
  const myOrgId = profile?.org_memberships?.[0]?.org_id
  const myOrgAcronym = profile?.org_memberships?.[0]?.organizations?.acronym

  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState({
    upcomingCount: 0,
    upcomingList: [],
    pendingSubmissions: 0,
    activeOrgs: 0,
    clearancePending: 0,
    clearanceOverdue: 0,
    myClearanceBlocked: false,
    myReviewQueue: 0,
    myOpenAssignments: 0,
  })

  useEffect(() => {
    loadDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  async function loadDashboard() {
    if (!profile) return
    setLoading(true)

    // Materialize any overdue non-event task into a blocking clearance
    // row for this org before counting — see src/lib/clearanceReconcile.js.
    if (!admin) await reconcileOwnOverdueAssignments(profile)

    const todayIso = toISODate(new Date())
    const in30 = toISODate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))

    let eventsQuery = supabase
      .from('events')
      .select('id, title, event_date, start_time, booking_status, organizations ( acronym ), venues ( name )')
      .gte('event_date', todayIso)
      .lte('event_date', in30)
      .neq('booking_status', 'cancelled')
      .order('event_date', { ascending: true })
      .limit(5)

    if (!admin && myOrgId) eventsQuery = eventsQuery.eq('org_id', myOrgId)

    let submissionsCountQuery = supabase
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .in('stage', OPEN_STAGES)

    if (!admin && myOrgId) submissionsCountQuery = submissionsCountQuery.eq('org_id', myOrgId)

    const queries = [
      eventsQuery,
      submissionsCountQuery,
    ]

    if (admin) {
      // organizations has no RLS restriction on select (every role can
      // browse the org directory for dropdowns), so SDAO-SHS/SHS
      // Principal need an explicit department filter here — unlike
      // clearances/submissions below, which RLS already scopes for them.
      let activeOrgsQuery = supabase.from('organizations').select('id', { count: 'exact', head: true }).eq('is_active', true)
      if (isSHSReviewer(profile.role)) activeOrgsQuery = activeOrgsQuery.eq('department', 'shs')

      queries.push(
        activeOrgsQuery,
        supabase.from('clearances').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('clearances').select('id', { count: 'exact', head: true }).eq('status', 'overdue'),
      )
      const myStages = REVIEW_STAGE_BY_ROLE[profile.role]
      if (myStages) {
        queries.push(
          supabase.from('submissions').select('id', { count: 'exact', head: true }).in('stage', myStages),
        )
      }
      // Tasks assigned directly to this staff member — e.g. an
      // auto-generated "Generate Evaluation form for: ..." task handed
      // to the SDAO Supervisor/Assistant once an Academic Director
      // approves an activity (College or SHS alike). Index into `rest`
      // below is 3 (right after activeOrgs/clearancePending/clearanceOverdue)
      // when there's no myStages review-queue query, else 4.
      queries.push(
        supabase.from('assignments').select('id', { count: 'exact', head: true })
          .eq('assigned_to', profile.id).in('status', ['pending', 'returned', 'conditional_approved']),
      )
    } else if (myOrgId) {
      queries.push(
        supabase.from('clearances').select('id', { count: 'exact', head: true }).eq('org_id', myOrgId).in('status', ['pending', 'overdue']),
        // RLS already scopes assignments to ones targeting me / my org /
        // my position tag, so no extra filter is needed here.
        supabase.from('assignments').select('id', { count: 'exact', head: true }).in('status', ['pending', 'returned', 'conditional_approved']),
      )
    }

    const results = await Promise.all(queries)
    const [eventsRes, submissionsRes, ...rest] = results

    const next = {
      upcomingCount: eventsRes.data?.length || 0,
      upcomingList: eventsRes.data || [],
      pendingSubmissions: submissionsRes.count || 0,
      activeOrgs: 0,
      clearancePending: 0,
      clearanceOverdue: 0,
      myClearanceBlocked: false,
      myReviewQueue: 0,
    }

    if (admin) {
      next.activeOrgs = rest[0]?.count || 0
      next.clearancePending = rest[1]?.count || 0
      next.clearanceOverdue = rest[2]?.count || 0
      const myStages = REVIEW_STAGE_BY_ROLE[profile.role]
      const myAssignmentsIdx = myStages ? 4 : 3
      if (myStages && rest[3]) next.myReviewQueue = rest[3].count || 0
      next.myOpenAssignments = rest[myAssignmentsIdx]?.count || 0
    } else if (myOrgId) {
      next.myClearanceBlocked = (rest[0]?.count || 0) > 0
      next.myOpenAssignments = rest[1]?.count || 0
    }

    setMetrics(next)
    setLoading(false)
  }

  const roleLabel = isSHSReviewer(profile?.role)
    ? 'SDAO-SHS Admin View'
    : admin ? 'SDAO Admin View' : (myOrgAcronym || 'No org assigned')

  return (
    <div className="dash-page">
      <div className="dash-header">
        <div className="dash-header__title">
          <LayoutDashboard size={19} color="var(--nu-blue-700)" />
          <div>
            <h2>Welcome, {profile?.full_name?.split(' ')[0] || 'there'}</h2>
            <span className="dash-header__sub">{roleLabel}</span>
          </div>
        </div>
        {loading && <Loader2 size={18} className="dash-spin" />}
      </div>

      <div className="dash-cards">
        <div className="dash-card">
          <div className="dash-card__icon dash-card__icon--blue"><CalendarDays size={18} /></div>
          <div>
            <span className="dash-card__value">{metrics.upcomingCount}</span>
            <span className="dash-card__label">Upcoming activities (30 days)</span>
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card__icon dash-card__icon--gold"><Inbox size={18} /></div>
          <div>
            <span className="dash-card__value">{metrics.pendingSubmissions}</span>
            <span className="dash-card__label">
              {admin ? 'Submissions in the pipeline' : 'Your submissions in review'}
            </span>
          </div>
        </div>

        {admin ? (
          <>
            <div className="dash-card">
              <div className="dash-card__icon dash-card__icon--navy"><Building2 size={18} /></div>
              <div>
                <span className="dash-card__value">{metrics.activeOrgs}</span>
                <span className="dash-card__label">Active organizations</span>
              </div>
            </div>
            <div className="dash-card">
              <div className="dash-card__icon dash-card__icon--danger"><ShieldCheck size={18} /></div>
              <div>
                <span className="dash-card__value">{metrics.clearancePending + metrics.clearanceOverdue}</span>
                <span className="dash-card__label">Orgs with open clearance</span>
              </div>
            </div>
          </>
        ) : (
          <div className="dash-card">
            <div className={`dash-card__icon ${metrics.myClearanceBlocked ? 'dash-card__icon--danger' : 'dash-card__icon--success'}`}>
              <ShieldCheck size={18} />
            </div>
            <div>
              <span className="dash-card__value">{metrics.myClearanceBlocked ? 'Blocked' : 'Cleared'}</span>
              <span className="dash-card__label">Clearance status</span>
            </div>
          </div>
        )}
      </div>

      <div className="dash-columns">
        <div className="dash-panel">
          <div className="dash-panel__head">
            <span>Upcoming Activities</span>
            <Link to="/calendar" className="dash-panel__link">
              View calendar <ChevronRight size={13} />
            </Link>
          </div>

          {metrics.upcomingList.length === 0 ? (
            <p className="dash-empty">No activities scheduled in the next 30 days.</p>
          ) : (
            <ul className="dash-event-list">
              {metrics.upcomingList.map((ev) => (
                <li key={ev.id} className="dash-event-item">
                  <div className={`dash-event-dot dash-event-dot--${ev.booking_status}`} />
                  <div className="dash-event-item__body">
                    <span className="dash-event-item__title">{ev.title}</span>
                    <span className="dash-event-item__meta">
                      {ev.organizations?.acronym} · {ev.event_date}
                      {ev.start_time && ` · ${formatTime(ev.start_time)}`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dash-panel">
          <div className="dash-panel__head">
            <span>Alerts</span>
          </div>

          <div className="dash-alerts">
            {admin && metrics.myReviewQueue > 0 && (
              <Link to="/submissions" className="dash-alert dash-alert--warn dash-alert--link">
                <Clock size={15} />
                <span><strong>{metrics.myReviewQueue}</strong> submission{metrics.myReviewQueue !== 1 ? 's' : ''} waiting on your action.</span>
                <ChevronRight size={14} className="dash-alert__chevron" />
              </Link>
            )}

            {admin && metrics.clearanceOverdue > 0 && (
              <Link to="/clearance" className="dash-alert dash-alert--danger dash-alert--link">
                <AlertTriangle size={15} />
                <span><strong>{metrics.clearanceOverdue}</strong> org{metrics.clearanceOverdue !== 1 ? 's have' : ' has'} an overdue clearance report.</span>
                <ChevronRight size={14} className="dash-alert__chevron" />
              </Link>
            )}

            {admin && metrics.myOpenAssignments > 0 && (
              <Link to="/assignments" className="dash-alert dash-alert--warn dash-alert--link">
                <ClipboardCheck size={15} />
                <span><strong>{metrics.myOpenAssignments}</strong> task{metrics.myOpenAssignments !== 1 ? 's' : ''} assigned to you need{metrics.myOpenAssignments === 1 ? 's' : ''} attention.</span>
                <ChevronRight size={14} className="dash-alert__chevron" />
              </Link>
            )}

            {!admin && metrics.myClearanceBlocked && (
              <Link to="/clearance" className="dash-alert dash-alert--danger dash-alert--link">
                <AlertTriangle size={15} />
                <span>Your org has an unresolved clearance report — new event submissions are blocked until it's cleared.</span>
                <ChevronRight size={14} className="dash-alert__chevron" />
              </Link>
            )}

            {!admin && metrics.pendingSubmissions > 0 && (
              <Link to="/submissions" className="dash-alert dash-alert--warn dash-alert--link">
                <Clock size={15} />
                <span><strong>{metrics.pendingSubmissions}</strong> submission{metrics.pendingSubmissions !== 1 ? 's' : ''} currently in review.</span>
                <ChevronRight size={14} className="dash-alert__chevron" />
              </Link>
            )}

            {!admin && metrics.myOpenAssignments > 0 && (
              <Link to="/assignments" className="dash-alert dash-alert--warn dash-alert--link">
                <ClipboardCheck size={15} />
                <span><strong>{metrics.myOpenAssignments}</strong> task{metrics.myOpenAssignments !== 1 ? 's' : ''} assigned to your org need{metrics.myOpenAssignments === 1 ? 's' : ''} attention.</span>
                <ChevronRight size={14} className="dash-alert__chevron" />
              </Link>
            )}

            {((admin && metrics.myReviewQueue === 0 && metrics.clearanceOverdue === 0 && metrics.myOpenAssignments === 0) ||
              (!admin && !metrics.myClearanceBlocked && metrics.pendingSubmissions === 0 && metrics.myOpenAssignments === 0)) && (
              <div className="dash-alert dash-alert--ok">
                <CheckCircle2 size={15} />
                <span>All caught up — nothing needs your attention right now.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <AnalyticsSection />
    </div>
  )
}
