import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

export const CHART_COLORS = [
  '#0f3d7a', '#c9a227', '#2f7a4f', '#a13d3d', '#4f6d8a',
  '#8a5fa1', '#c96a2f', '#3d7a76', '#7a3d5f', '#5f7a3d',
]

export function ChartCard({ title, subtitle, action, empty, children }) {
  return (
    <div className="an-card">
      <div className="an-card__head">
        <div>
          <span className="an-card__title">{title}</span>
          {subtitle && <span className="an-card__subtitle">{subtitle}</span>}
        </div>
        {action}
      </div>
      {empty ? <p className="an-empty">No data for the selected filters.</p> : children}
    </div>
  )
}

export function BarChartCard({ title, subtitle, data, dataKey = 'value', horizontal = false, action }) {
  const empty = !data || data.length === 0 || data.every((d) => d.value === 0)
  return (
    <ChartCard title={title} subtitle={subtitle} action={action} empty={empty}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 12, left: 0, bottom: horizontal ? 4 : 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--an-grid)" />
          {horizontal ? (
            <>
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
            </>
          ) : (
            <>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-25} textAnchor="end" interval={0} height={50} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            </>
          )}
          <Tooltip />
          <Bar dataKey={dataKey} fill="#0f3d7a" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function LineChartCard({ title, subtitle, data, action }) {
  const empty = !data || data.length === 0
  return (
    <ChartCard title={title} subtitle={subtitle} action={action} empty={empty}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--an-grid)" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="#c9a227" strokeWidth={2.5} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function PieChartCard({ title, subtitle, data, action }) {
  const empty = !data || data.length === 0 || data.every((d) => d.value === 0)
  return (
    <ChartCard title={title} subtitle={subtitle} action={action} empty={empty}>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(d) => `${d.name} (${d.value})`}>
            {data?.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function KpiRow({ items }) {
  return (
    <div className="an-kpis">
      {items.map((k) => (
        <div className="an-kpi" key={k.label}>
          <span className="an-kpi__value">{k.value}</span>
          <span className="an-kpi__label">{k.label}</span>
        </div>
      ))}
    </div>
  )
}
