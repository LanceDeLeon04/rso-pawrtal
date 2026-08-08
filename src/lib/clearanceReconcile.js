import { supabase } from './supabaseClient'
import { toISODate } from './dateUtils'

// A non-event assignment (a task with no linked event — e.g. "Submit
// Officer List") is supposed to block new Event Applications once
// it's overdue, same as an unresolved activity report. There's no
// server cron, so this has to self-heal on the client. It used to
// only run when an admin opened the Assignments page — meaning an
// org's block could go unregistered for as long as no admin happened
// to visit that page after the deadline. This runs it from the
// affected org's own session instead (see migration 034 for the RLS
// change that makes this safe to self-serve).
//
// Call this for the signed-in user's own org(s) — it only ever
// creates a clearance row for an org the caller actually belongs to,
// reflecting a real overdue assignment that targets that org.
export async function reconcileOwnOverdueAssignments(profile) {
  if (!profile?.org_memberships?.length) return

  const today = toISODate(new Date())

  const { data: assignments, error } = await supabase
    .from('assignments')
    .select('id, title, assigned_to, assigned_tag, assigned_org_id, due_date, status, event_id')
    .is('event_id', null)
    .lt('due_date', today)
    .in('status', ['pending', 'returned', 'conditional_approved'])

  if (error || !assignments?.length) return

  for (const membership of profile.org_memberships) {
    const orgId = membership.org_id
    const targeting = assignments.filter(
      (a) =>
        a.assigned_org_id === orgId ||
        a.assigned_to === profile.id ||
        (membership.position && a.assigned_tag === membership.position)
    )
    if (targeting.length === 0) continue

    const { data: existing } = await supabase
      .from('clearances')
      .select('assignment_id')
      .eq('org_id', orgId)
      .not('assignment_id', 'is', null)

    const existingIds = new Set((existing || []).map((c) => c.assignment_id))
    const toCreate = targeting.filter((a) => !existingIds.has(a.id))
    if (toCreate.length === 0) continue

    await Promise.all(
      toCreate.map((a) =>
        supabase.from('clearances').insert({
          org_id: orgId,
          assignment_id: a.id,
          status: 'overdue',
          deadline: a.due_date,
          reason: `Overdue task: ${a.title || 'assignment'}`,
        })
      )
    )
  }
}
