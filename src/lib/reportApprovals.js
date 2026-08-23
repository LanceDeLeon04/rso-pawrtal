import { supabase } from './supabaseClient'

// Order matters — this is the sign-off order enforced server-side in
// migration 082 (submit_report_decision). Auditor is gated on
// Treasurer; Secretary is independent (Narrative Report is her own
// document); Adviser needs all three officers done; Dean needs Adviser.
export const REPORT_APPROVAL_CHAIN = ['treasurer', 'auditor', 'secretary', 'adviser', 'dean']

// Roles that never require a security PIN — same as migration 082's
// gating. Adviser/Dean reuse the optional PIN roster from the
// event-application chain (external_approvers, migration 072).
export const REPORT_NO_PIN_ROLES = ['treasurer', 'auditor', 'secretary']

export const REPORT_ROLE_LABELS = {
  treasurer: 'Treasurer / Finance',
  auditor: 'Auditor',
  secretary: 'Secretary',
  adviser: 'Adviser',
  dean: 'Dean',
}

export function reportApprovalLinkUrl(token) {
  return `${window.location.origin}/report-sign/${token}`
}

// Issues (or reissues) a 7-day link for a report signer. Reuses the
// same generate_approval_link RPC the event-application chain uses —
// it's already generic over submission_id + role, so no new RPC is
// needed for issuing links, only for reading/deciding them (see
// get_report_approval / submit_report_decision below).
export async function generateReportApprovalLink(submissionId, role, personName, personEmail) {
  const { data, error } = await supabase.rpc('generate_approval_link', {
    p_submission_id: submissionId,
    p_role: role,
    p_person_name: personName,
    p_person_email: personEmail || null,
  })
  return { data, error }
}

export async function fetchReportApprovalLinks(submissionId) {
  const { data, error } = await supabase
    .from('approval_links')
    .select('id, role, token, person_name, person_email, status, comment, expires_at, decided_at, created_at, signature_data')
    .eq('submission_id', submissionId)
    .in('role', REPORT_APPROVAL_CHAIN)
  return { data: data || [], error }
}

// Issues all five links the moment a report is submitted: Treasurer/
// Auditor/Secretary from the org's current officer roster
// (org_memberships), and Adviser/Dean reused from the same people who
// signed the original event application for this event (they're
// already on file — no need to ask the org to type the names again).
// Issuing every link upfront (rather than only revealing the next one
// once its turn arrives) matches how the rest of the app's external
// chains work: the review page itself shows a locked state until
// `unlocked` comes back true from get_report_approval, so an Adviser
// who clicks their link early just sees "waiting on the officers"
// instead of a dead link.
export async function issueReportSignatureChain(submissionId, orgId, eventId) {
  const { data: memberships } = await supabase
    .from('org_memberships')
    .select('position, profile_id, profiles ( full_name, email )')
    .eq('org_id', orgId)
    .in('position', ['Treasurer', 'Auditor', 'Secretary'])

  const { data: originalLinks } = eventId
    ? await supabase
        .from('approval_links')
        .select('role, person_name, person_email, submission_id, submissions!inner ( event_id, type )')
        .eq('submissions.event_id', eventId)
        .eq('submissions.type', 'event_application')
        .in('role', ['adviser', 'dean'])
    : { data: [] }

  const results = []
  for (const role of ['treasurer', 'auditor', 'secretary']) {
    const position = role === 'treasurer' ? 'Treasurer' : role === 'auditor' ? 'Auditor' : 'Secretary'
    const membership = memberships?.find((m) => m.position === position)
    if (!membership) continue
    const { data, error } = await generateReportApprovalLink(
      submissionId, role, membership.profiles?.full_name || position, membership.profiles?.email,
    )
    results.push({ role, data, error })
  }
  for (const role of ['adviser', 'dean']) {
    const original = originalLinks?.find((l) => l.role === role)
    if (!original) continue
    const { data, error } = await generateReportApprovalLink(
      submissionId, role, original.person_name, original.person_email,
    )
    results.push({ role, data, error })
  }
  return results
}

// Resolves chain progress for display in Submission Bin (locked/done
// steps), same shape convention as externalApprovalState() in
// approvalLinks.js.
export function reportApprovalState(links) {
  const byRole = Object.fromEntries(REPORT_APPROVAL_CHAIN.map((role) => [role, links.find((l) => l.role === role) || null]))
  const officersComplete = ['treasurer', 'auditor', 'secretary'].every((r) => byRole[r]?.status === 'approved')
  const adviserComplete = byRole.adviser?.status === 'approved'
  const complete = byRole.dean?.status === 'approved'
  const anyRejected = REPORT_APPROVAL_CHAIN.some((r) => byRole[r]?.status === 'rejected')
  return { byRole, officersComplete, adviserComplete, complete, anyRejected }
}

export async function getReportApproval(token) {
  const { data, error } = await supabase.rpc('get_report_approval', { p_token: token })
  return { data, error }
}

export async function submitReportDecision(token, decision, comment, signature, pin) {
  const { data, error } = await supabase.rpc('submit_report_decision', {
    p_token: token,
    p_decision: decision,
    p_comment: comment || null,
    p_signature: signature || null,
    p_pin: pin || null,
  })
  return { data, error }
}
