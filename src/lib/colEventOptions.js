// Council of Leaders (COL) flagship events — tagged on an event
// application's `col_event_tags` by the Programs Head or Operations
// Head (see migration 041, col_event_tags_guard). 'Others' isn't
// stored as a literal value — the free-typed value the user enters
// is what actually goes in the array.
export const COL_EVENT_OPTIONS = [
  'Paskonalian',
  'PiNUsuan',
  'Open Day',
  'Intramurals',
  'University Week',
  'OWeek',
]

export const COL_EVENT_TAGGER_POSITIONS = ['Programs Head', 'Operations Head']
