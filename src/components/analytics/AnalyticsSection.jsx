import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Download, FileSpreadsheet, FileText, Filter, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth, isAdminTier, isFMO, isSHSReviewer } from '../../context/AuthContext'
import {
  fetchAdminAnalytics, fetchOrgAnalytics, fetchFacilityAnalytics,
  formatCurrency, defaultDateRange,
} from '../../lib/analyticsData'
import { exportAnalyticsToExcel, exportAnalyticsToPDF } from '../../lib/analyticsExport'
import { BarChartCard, LineChartCard, PieChartCard, KpiRow } from './ChartCards'
import './AnalyticsSection.css'

export default function AnalyticsSection() {
  const { profile } = useAuth()
  // SDAO-SHS/SHS Principal get the same "admin analytics" shape,
  // RLS-scoped (migration 052) to department = 'shs' rows only.
  const admin = isAdminTier(profile?.role) || isSHSReviewer(profile?.role)
  const shsOnly = isSHSReviewer(profile?.role)
  const fmo = isFMO(profile?.role)
  const myOrgId = profile?.org_memberships?.[0]?.org_id
  const myOrgAcronym = profile?.org_memberships?.[0]?.organizations?.acronym

  const { startDate: defStart, endDate: defEnd } = defaultDateRange(6)
  const [startDate, setStartDate] = useState(defStart)
  const [endDate, setEndDate] = useState(defEnd)
  const [orgFilter, setOrgFilter] = useState('')
  const [venueFilter, setVenueFilter] = useState('')
  const [orgOptions, setOrgOptions] = useState([])
  const [venueOptions, setVenueOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  useEffect(() => {
    if (admin) {
      let q = supabase.from('organizations').select('id, acronym').eq('is_active', true).order('acronym')
      if (shsOnly) q = q.eq('department', 'shs') // organizations select has no RLS restriction, so filter explicitly
      q.then(({ data: o }) => setOrgOptions(o || []))
    }
    if (fmo) {
      supabase.from('venues').select('id, name').eq('is_active', true).order('name')
        .then(({ data: v }) => setVenueOptions(v || []))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, fmo, shsOnly])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, startDate, endDate, orgFilter, venueFilter])

  async function load() {
    if (!profile) return
    setLoading(true)
    let result = null
    if (admin) {
      result = await fetchAdminAnalytics({ orgId: orgFilter || null, startDate, endDate, shsOnly })
    } else if (fmo) {
      result = await fetchFacilityAnalytics({ venueId: venueFilter || null, startDate, endDate })
    } else if (myOrgId) {
      result = await fetchOrgAnalytics({ orgId: myOrgId, startDate, endDate })
    }
    setData(result)
    setLoading(false)
  }

  const scopeLabel = admin
    ? (orgFilter ? orgOptions.find((o) => o.id === orgFilter)?.acronym || 'Selected org' : 'All organizations')
    : fmo
      ? (venueFilter ? venueOptions.find((v) => v.id === venueFilter)?.name || 'Selected venue' : 'All facilities')
      : (myOrgAcronym || 'Your organization')

  const exportPayload = useMemo(() => buildExportPayload({ admin, fmo, data }), [admin, fmo, data])

  function handleExportExcel() {
    if (!exportPayload) return
    exportAnalyticsToExcel({
      filename: `pawrtal-analytics-${new Date().toISOString().slice(0, 10)}`,
      title: exportPayload.title,
      generatedFor: `${scopeLabel} · ${startDate} to ${endDate}`,
      sections: exportPayload.sections,
    })
  }

  function handleExportPDF() {
    if (!exportPayload) return
    exportAnalyticsToPDF({
      filename: `pawrtal-analytics-${new Date().toISOString().slice(0, 10)}`,
      title: exportPayload.title,
      generatedFor: `${scopeLabel} · ${startDate} to ${endDate}`,
      kpis: exportPayload.kpis,
      sections: exportPayload.sections,
    })
  }

  return (
    <div className="an-section">
      <div className="an-section__head">
        <div className="an-section__title">
          <BarChart3 size={18} color="var(--nu-blue-700)" />
          <div>
            <h3>Data Analytics</h3>
            <span className="an-section__sub">
              {admin ? (shsOnly ? 'SHS organization analytics' : 'Organization-wide analytics') : fmo ? 'Facility utilization analytics' : 'Your organization\'s analytics'}
            </span>
          </div>
        </div>
        {loading && <Loader2 size={16} className="an-spin" />}
      </div>

      <div className="an-filters">
        <div className="an-filter">
          <Filter size={13} />
          <label>From</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="an-filter">
          <label>To</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>

        {admin && (
          <div className="an-filter">
            <label>Organization</label>
            <select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
              <option value="">All organizations</option>
              {orgOptions.map((o) => <option key={o.id} value={o.id}>{o.acronym}</option>)}
            </select>
          </div>
        )}

        {fmo && (
          <div className="an-filter">
            <label>Venue</label>
            <select value={venueFilter} onChange={(e) => setVenueFilter(e.target.value)}>
              <option value="">All facilities</option>
              {venueOptions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        )}

        {(admin || fmo) && (
          <div className="an-export-btns">
            <button type="button" className="an-btn" onClick={handleExportExcel} disabled={!exportPayload}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button type="button" className="an-btn" onClick={handleExportPDF} disabled={!exportPayload}>
              <FileText size={14} /> PDF
            </button>
          </div>
        )}
      </div>

      {!data ? (
        <p className="an-empty">{loading ? 'Loading analytics…' : 'No data available.'}</p>
      ) : admin ? (
        <AdminCharts data={data} />
      ) : fmo ? (
        <FacilityCharts data={data} />
      ) : (
        <OrgCharts data={data} />
      )}
    </div>
  )
}

function AdminCharts({ data }) {
  return (
    <>
      <KpiRow items={[
        { label: 'Total submissions', value: data.kpis.totalSubmissions },
        { label: 'Active events/bookings', value: data.kpis.totalEvents },
        { label: 'Active organizations', value: data.kpis.activeOrgs },
        { label: 'Open clearances', value: data.kpis.openClearances },
        { label: 'Total projected budget', value: formatCurrency(data.kpis.totalProjectedBudget) },
      ]} />
      <div className="an-grid">
        <LineChartCard title="Submissions Trend" subtitle="Last 6 months" data={data.submissionsTrend} />
        <LineChartCard title="Events / Bookings Trend" subtitle="Last 6 months" data={data.eventsTrend} />
        <PieChartCard title="Submissions by Stage" data={data.submissionsByStage} />
        <PieChartCard title="Submissions by Type" data={data.submissionsByType} />
        <PieChartCard title="Events by Booking Status" data={data.eventsByStatus} />
        <PieChartCard title="Clearance Status" data={data.clearanceByStatus} />
        <PieChartCard title="Organizations by Category" data={data.orgsByCategory} />
        <BarChartCard title="Top Organizations — Submissions" horizontal data={data.submissionsPerOrg} />
        <BarChartCard title="Top Organizations — Events" horizontal data={data.eventsPerOrg} />
      </div>
    </>
  )
}

function OrgCharts({ data }) {
  return (
    <>
      <KpiRow items={[
        { label: 'Total submissions', value: data.kpis.totalSubmissions },
        { label: 'Events/bookings', value: data.kpis.totalEvents },
        { label: 'Open clearances', value: data.kpis.openClearances },
        { label: 'Total projected budget', value: formatCurrency(data.kpis.totalProjectedBudget) },
      ]} />
      <div className="an-grid">
        <LineChartCard title="Submissions Trend" subtitle="Last 6 months" data={data.submissionsTrend} />
        <LineChartCard title="Events / Bookings Trend" subtitle="Last 6 months" data={data.eventsTrend} />
        <PieChartCard title="Submissions by Stage" data={data.submissionsByStage} />
        <PieChartCard title="Submissions by Type" data={data.submissionsByType} />
        <BarChartCard title="Venue Usage" horizontal data={data.venueUsage} />
      </div>
    </>
  )
}

function FacilityCharts({ data }) {
  return (
    <>
      <KpiRow items={[
        { label: 'Total bookings', value: data.kpis.totalBookings },
        { label: 'Active facilities', value: data.kpis.activeVenues },
        { label: 'Facilities in use', value: data.kpis.venuesInUse },
        { label: 'Utilization rate', value: `${data.kpis.utilizationRate}%` },
      ]} />
      <div className="an-grid">
        <LineChartCard title="Bookings Trend" subtitle="Last 6 months" data={data.bookingsTrend} />
        <BarChartCard title="Bookings per Facility" horizontal data={data.bookingsByVenue} />
        <PieChartCard title="Bookings by Status" data={data.bookingsByStatus} />
        <BarChartCard title="Bookings by Day of Week" data={data.bookingsByWeekday} />
        <BarChartCard title="Top Requesting Organizations" horizontal data={data.requestingOrgs} />
      </div>
    </>
  )
}

function buildExportPayload({ admin, fmo, data }) {
  if (!data) return null
  if (admin) {
    return {
      title: 'PAWrtal Analytics Report',
      kpis: [
        { label: 'Total submissions', value: data.kpis.totalSubmissions },
        { label: 'Active events/bookings', value: data.kpis.totalEvents },
        { label: 'Active organizations', value: data.kpis.activeOrgs },
        { label: 'Open clearances', value: data.kpis.openClearances },
        { label: 'Total projected budget', value: formatCurrency(data.kpis.totalProjectedBudget) },
      ],
      sections: [
        { title: 'Submissions by Stage', rows: data.submissionsByStage },
        { title: 'Submissions by Type', rows: data.submissionsByType },
        { title: 'Events by Status', rows: data.eventsByStatus },
        { title: 'Clearance Status', rows: data.clearanceByStatus },
        { title: 'Organizations by Category', rows: data.orgsByCategory },
        { title: 'Top Orgs - Submissions', rows: data.submissionsPerOrg },
        { title: 'Top Orgs - Events', rows: data.eventsPerOrg },
      ],
    }
  }
  if (fmo) {
    return {
      title: 'PAWrtal Facility Utilization Report',
      kpis: [
        { label: 'Total bookings', value: data.kpis.totalBookings },
        { label: 'Active facilities', value: data.kpis.activeVenues },
        { label: 'Facilities in use', value: data.kpis.venuesInUse },
        { label: 'Utilization rate', value: `${data.kpis.utilizationRate}%` },
      ],
      sections: [
        { title: 'Bookings per Facility', rows: data.bookingsByVenue },
        { title: 'Bookings by Status', rows: data.bookingsByStatus },
        { title: 'Bookings by Day of Week', rows: data.bookingsByWeekday },
        { title: 'Top Requesting Orgs', rows: data.requestingOrgs },
      ],
    }
  }
  return null
}
