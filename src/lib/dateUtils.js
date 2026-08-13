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

// Adds (or subtracts, with a negative n) whole days to an ISO date
// string and returns a new ISO date string. Used for computing term
// breaks (the day after one term ends, the day before the next begins).
export function addDaysISO(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00`)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

// Given a restricted_periods row (kind: 'exam_period'), returns the ISO
// [start, end] of the week immediately before its stored start_date —
// 7 calendar days, auto-detected, never itself stored in the database.
// Admins/QMO/FMO/SDAO-SHS only ever schedule the exam week itself on
// the Calendar; both the Calendar (lighter shade) and Submission Bin
// (soft advisory, never a hard block) derive this range from that one
// stored start_date so the two stay in sync automatically.
export function examPreWeekRange(period) {
  return [addDaysISO(period.start_date, -7), addDaysISO(period.start_date, -1)]
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

// Formats an array of ISO date strings ('YYYY-MM-DD') for display on
// generated forms (e.g. the ACP Form's Date field).
//
// Rules:
//  - Single date                       -> "August 9, 2026"
//  - Continuous run, same month        -> "August 9-12, 2026"
//  - Continuous run, crosses month(s)  -> "August 31 - September 2, 2026"
//    (crosses year too)                -> "December 30, 2026 - January 2, 2027"
//  - Staggered (non-continuous), same month
//                                       -> "August 9, 11, 15, 2026"
//  - Staggered, crosses month(s)       -> "August 9, September 1, 2026"
//    (crosses year too)                -> "December 30, 2026, January 2, 2027"
export function formatEventDates(isoDates) {
  const dates = [...new Set((isoDates || []).filter(Boolean))].sort()
  if (dates.length === 0) return ''
  if (dates.length === 1) return formatSingleDate(dates[0])

  const parsed = dates.map(parseISO)
  const isContinuous = parsed.every((d, i) => {
    if (i === 0) return true
    return isSameDay(addDays(parsed[i - 1], 1), d)
  })

  return isContinuous
    ? formatContinuousRange(parsed)
    : formatStaggeredList(parsed)
}

function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function formatSingleDate(iso) {
  const d = parseISO(iso)
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function formatContinuousRange(parsed) {
  const first = parsed[0]
  const last = parsed[parsed.length - 1]
  const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()

  if (sameMonth) {
    // August 9-12, 2026
    return `${MONTH_NAMES[first.getMonth()]} ${first.getDate()}-${last.getDate()}, ${first.getFullYear()}`
  }

  const sameYear = first.getFullYear() === last.getFullYear()
  const startLabel = `${MONTH_NAMES[first.getMonth()]} ${first.getDate()}`
  const endLabel = sameYear
    ? `${MONTH_NAMES[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}`
    : `${MONTH_NAMES[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}`

  // August 31 - September 2, 2026
  // December 30, 2026 - January 2, 2027 (include year on the start when years differ)
  return sameYear
    ? `${startLabel} - ${endLabel}`
    : `${startLabel}, ${first.getFullYear()} - ${endLabel}`
}

function formatStaggeredList(parsed) {
  const allSameMonth = parsed.every(
    (d) => d.getMonth() === parsed[0].getMonth() && d.getFullYear() === parsed[0].getFullYear()
  )
  const year = parsed[parsed.length - 1].getFullYear()

  if (allSameMonth) {
    // August 9, 11, 15, 2026
    const days = parsed.map((d) => d.getDate()).join(', ')
    return `${MONTH_NAMES[parsed[0].getMonth()]} ${days}, ${year}`
  }

  // August 9, September 1, 2026 (each date shows its month; year appended once,
  // unless dates span multiple years, in which case each date carries its own year)
  const spansYears = parsed[0].getFullYear() !== parsed[parsed.length - 1].getFullYear()
  if (spansYears) {
    return parsed.map((d) => `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`).join(', ')
  }
  return `${parsed.map((d) => `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`).join(', ')}, ${year}`
}

export function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return `${hour12}:${m} ${suffix}`
}
