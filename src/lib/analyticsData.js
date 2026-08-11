// Data-fetching + aggregation for the Dashboard's Analytics section.
//
// Scoping rules (enforced here in the app layer, on top of RLS):
//   - Admin tier (sdao_assistant, crso_chairperson, qmo, sdao_supervisor,
//     academic_director, system_admin) -> full, org-picker-filterable data.
//   - RSO Officer (incl. COL, same role) -> own org only. `events` and
//     `organizations` RLS is `using (true)` (needed for calendar/venue
//     availability), so we explicitly filter by org_id client-side too.
//   - FMO -> facility/venue utilization only, never submissions/clearance/
//     org performance data.
import { supabase } from './supabaseClient'
import { MONTH_NAMES, toISODate } from './dateUtils'

export const STAGE_LABELS = {
  submitted: 'Submitted',
  assistant_review: 'Assistant Review',
  supervisor_endorsement: 'Supervisor Endorsement',
  director_approval: 'Director Approval',
  approved: 'Approved',
  returned: 'Returned',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export const BOOKING_STATUS_LABELS = {
  pencil: 'Pencil-booked',
  reserved: 'Reserved',
  cancelled: 'Cancelled',
}

function monthKey(isoDate) {
  return isoDate ? isoDate.slice(0, 7) : null // YYYY-MM
}

function monthLabel(key) {
  if (!key) return 'Unknown'
  const [y, m] = key.split('-')
  return `${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${y}`
}

// Builds the last N month buckets (oldest -> newest) ending this month,
// so charts show a consistent trailing window even for empty months.
function buildMonthBuckets(n) {
  const out = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ key, label: monthLabel(key) })
  }
  return out
}

function countBy(rows, keyFn) {
  const map = new Map()
  for (const row of rows) {
    const k = keyFn(row) ?? 'Unknown'
    map.set(k, (map.get(k) || 0) + 1)
  }
  return map
}

function seriesFromBuckets(buckets, rows, dateField) {
  const byMonth = countBy(rows, (r) => monthKey(r[dateField]))
  return buckets.map((b) => ({ name: b.label, value: byMonth.get(b.key) || 0 }))
}

// ---------- ADMIN / DIRECTOR / QMO: org-wide analytics ----------
export async function fetchAdminAnalytics({ orgId = null, startDate = null, endDate = null, months = 6 } = {}) {
  let subQ = supabase.from('submissions').select('id, type, stage, org_id, submitted_at, projected_budget, organizations ( acronym, category )')
  let evQ = supabase.from('events').select('id, org_id, event_date, booking_status, venue_id, organizations ( acronym ), venues ( name )')
  let clQ = supabase.from('clearances').select('id, org_id, status, deadline, created_at, organizations ( acronym )')
  let orgQ = supabase.from('organizations').select('id, name, acronym, category, is_active, accreditation_status')

  if (orgId) {
    subQ = subQ.eq('org_id', orgId)
    evQ = evQ.eq('org_id', orgId)
    clQ = clQ.eq('org_id', orgId)
  }
  if (startDate) { subQ = subQ.gte('submitted_at', startDate); evQ = evQ.gte('event_date', startDate) }
  if (endDate) { subQ = subQ.lte('submitted_at', endDate); evQ = evQ.lte('event_date', endDate) }

  const [{ data: submissions }, { data: events }, { data: clearances }, { data: orgs }] =
    await Promise.all([subQ, evQ, clQ, orgQ])

  const S = submissions || [], E = events || [], C = clearances || [], O = orgs || []
  const buckets = buildMonthBuckets(months)

  const submissionsByStage = Array.from(countBy(S, (r) => STAGE_LABELS[r.stage] || r.stage), ([name, value]) => ({ name, value }))
  const submissionsByType = Array.from(countBy(S, (r) => (r.type === 'event_application' ? 'Event Application' : 'Report')), ([name, value]) => ({ name, value }))
  const submissionsTrend = seriesFromBuckets(buckets, S, 'submitted_at')
  const eventsTrend = seriesFromBuckets(buckets, E.filter((e) => e.booking_status !== 'cancelled'), 'event_date')
  const eventsByStatus = Array.from(countBy(E, (r) => BOOKING_STATUS_LABELS[r.booking_status] || r.booking_status), ([name, value]) => ({ name, value }))
  const clearanceByStatus = Array.from(countBy(C, (r) => r.status), ([name, value]) => ({ name: name[0].toUpperCase() + name.slice(1), value }))
  const orgsByCategory = Array.from(countBy(O, (r) => r.category || 'Uncategorized'), ([name, value]) => ({ name, value }))

  const submissionsPerOrg = Array.from(countBy(S, (r) => r.organizations?.acronym || 'Unknown'), ([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value).slice(0, 10)
  const eventsPerOrg = Array.from(countBy(E.filter((e) => e.booking_status !== 'cancelled'), (r) => r.organizations?.acronym || 'Unknown'), ([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value).slice(0, 10)

  const totalBudget = S.filter((s) => s.type === 'event_application').reduce((sum, s) => sum + (Number(s.projected_budget) || 0), 0)

  return {
    kpis: {
      totalSubmissions: S.length,
      totalEvents: E.filter((e) => e.booking_status !== 'cancelled').length,
      activeOrgs: O.filter((o) => o.is_active).length,
      openClearances: C.filter((c) => c.status !== 'cleared').length,
      totalProjectedBudget: totalBudget,
    },
    submissionsByStage,
    submissionsByType,
    submissionsTrend,
    eventsTrend,
    eventsByStatus,
    clearanceByStatus,
    orgsByCategory,
    submissionsPerOrg,
    eventsPerOrg,
    orgs: O,
    rawSubmissions: S,
    rawEvents: E,
    rawClearances: C,
  }
}

// ---------- RSO / COL: own-org-only analytics ----------
export async function fetchOrgAnalytics({ orgId, startDate = null, endDate = null, months = 6 }) {
  if (!orgId) return null

  let subQ = supabase.from('submissions').select('id, type, stage, submitted_at, projected_budget').eq('org_id', orgId)
  let evQ = supabase.from('events').select('id, event_date, booking_status, venues ( name )').eq('org_id', orgId)
  let clQ = supabase.from('clearances').select('id, status, deadline, created_at, reason').eq('org_id', orgId)

  if (startDate) { subQ = subQ.gte('submitted_at', startDate); evQ = evQ.gte('event_date', startDate) }
  if (endDate) { subQ = subQ.lte('submitted_at', endDate); evQ = evQ.lte('event_date', endDate) }

  const [{ data: submissions }, { data: events }, { data: clearances }] = await Promise.all([subQ, evQ, clQ])
  const S = submissions || [], E = events || [], C = clearances || []
  const buckets = buildMonthBuckets(months)

  const submissionsByStage = Array.from(countBy(S, (r) => STAGE_LABELS[r.stage] || r.stage), ([name, value]) => ({ name, value }))
  const submissionsByType = Array.from(countBy(S, (r) => (r.type === 'event_application' ? 'Event Application' : 'Report')), ([name, value]) => ({ name, value }))
  const submissionsTrend = seriesFromBuckets(buckets, S, 'submitted_at')
  const eventsTrend = seriesFromBuckets(buckets, E.filter((e) => e.booking_status !== 'cancelled'), 'event_date')
  const venueUsage = Array.from(countBy(E.filter((e) => e.booking_status !== 'cancelled'), (r) => r.venues?.name || 'Unspecified'), ([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
  const totalBudget = S.filter((s) => s.type === 'event_application').reduce((sum, s) => sum + (Number(s.projected_budget) || 0), 0)

  return {
    kpis: {
      totalSubmissions: S.length,
      totalEvents: E.filter((e) => e.booking_status !== 'cancelled').length,
      openClearances: C.filter((c) => c.status !== 'cleared').length,
      totalProjectedBudget: totalBudget,
    },
    submissionsByStage,
    submissionsByType,
    submissionsTrend,
    eventsTrend,
    venueUsage,
    rawSubmissions: S,
    rawEvents: E,
    rawClearances: C,
  }
}

// ---------- FMO: facility/venue utilization only ----------
export async function fetchFacilityAnalytics({ startDate = null, endDate = null, venueId = null, months = 6 } = {}) {
  let evQ = supabase
    .from('events')
    .select('id, event_date, start_time, end_time, booking_status, venue_id, organizations ( acronym ), venues ( id, name, capacity )')
    .neq('booking_status', 'cancelled')

  if (venueId) evQ = evQ.eq('venue_id', venueId)
  if (startDate) evQ = evQ.gte('event_date', startDate)
  if (endDate) evQ = evQ.lte('event_date', endDate)

  const [{ data: events }, { data: venues }] = await Promise.all([
    evQ,
    supabase.from('venues').select('id, name, location, capacity, is_active').order('name'),
  ])

  const E = events || [], V = venues || []
  const buckets = buildMonthBuckets(months)

  const bookingsByVenue = Array.from(countBy(E, (r) => r.venues?.name || 'Unspecified'), ([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
  const bookingsTrend = seriesFromBuckets(buckets, E, 'event_date')
  const bookingsByStatus = Array.from(countBy(E, (r) => BOOKING_STATUS_LABELS[r.booking_status] || r.booking_status), ([name, value]) => ({ name, value }))

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const byWeekday = countBy(E, (r) => r.event_date ? WEEKDAYS[new Date(`${r.event_date}T00:00:00`).getDay()] : 'Unknown')
  const bookingsByWeekday = WEEKDAYS.map((d) => ({ name: d, value: byWeekday.get(d) || 0 }))

  const requestingOrgs = Array.from(countBy(E, (r) => r.organizations?.acronym || 'Unknown'), ([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value).slice(0, 10)

  const activeVenueCount = V.filter((v) => v.is_active).length
  const utilizationRate = activeVenueCount ? Math.round((bookingsByVenue.length / activeVenueCount) * 100) : 0

  return {
    kpis: {
      totalBookings: E.length,
      activeVenues: activeVenueCount,
      venuesInUse: bookingsByVenue.length,
      utilizationRate,
    },
    bookingsByVenue,
    bookingsTrend,
    bookingsByStatus,
    bookingsByWeekday,
    requestingOrgs,
    venues: V,
    rawEvents: E,
  }
}

export function formatCurrency(n) {
  return `₱${(Number(n) || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 })}`
}

export function defaultDateRange(months = 6) {
  const end = new Date()
  const start = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1)
  return { startDate: toISODate(start), endDate: toISODate(end) }
}
