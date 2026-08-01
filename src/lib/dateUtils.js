// Lightweight date helpers — no external date library needed.

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function toISODate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function startOfMonth(year, month) {
  return new Date(year, month, 1)
}

export function endOfMonth(year, month) {
  return new Date(year, month + 1, 0)
}

export function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// Returns a flat array of 42 cells (6 weeks) for a month grid.
// Each cell is { date, inMonth } where date is a real Date object,
// including the leading/trailing days from adjacent months.
export function buildMonthGrid(year, month) {
  const first = startOfMonth(year, month)
  const startOffset = first.getDay() // 0 = Sunday
  const gridStart = new Date(year, month, 1 - startOffset)

  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    cells.push({ date: d, inMonth: d.getMonth() === month })
  }
  return cells
}

export const MEDIUM_LABELS = {
  f2f: 'Face-to-Face',
  online: 'Online',
  off_campus: 'Off-Campus',
}

export function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return `${hour12}:${m} ${suffix}`
}
