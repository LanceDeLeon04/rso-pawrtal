import { supabase } from './supabaseClient'

// Categories of submitting org that require a Dean sign-off in addition
// to the Adviser. Everything else (e.g. Special Interest) only needs
// the Adviser link. Keep in sync with the DB function of the same name
// in migration 019.
const DEAN_REQUIRED_CATEGORIES = ['School Council', 'Academic']

export function orgNeedsDean(category) {
  return DEAN_REQUIRED_CATEGORIES.includes(category)
}

// Council of Leaders orgs (category = 'COL') have no Adviser and no
// Dean — SDAO works with them directly, so their external chain is
// just the last role (SDG Representative / Marketing).
export function isCOL(category) {
  return category === 'COL'
}

// Full external sign-off chain, in order. For RSO orgs, the last role
// always comes after the Adviser (and Dean, if the org's category
// requires one): for event applications that's the SDG Representative
// (who marks the SDGs); for merchandise proposals it's Marketing (who
// reviews the design/quotation attachments). For COL orgs, the last
// role is the only link in the chain — no Adviser, no Dean.
export function externalApprovalChain(category, type = 'event_application') {
  const lastRole = type === 'merchandise' ? 'marketing_rep' : 'sdg_rep'
  if (isCOL(category)) return [lastRole]
  return orgNeedsDean(category) ? ['adviser', 'dean', lastRole] : ['adviser', lastRole]
}

export function approvalLinkUrl(token) {
  return `${window.location.origin}/approve/${token}`
}

// Generate (or reissue) a 7-day link for a role on a submission.
// Returns { data, error }.
export async function generateApprovalLink(submissionId, role, personName, personEmail) {
  const { data, error } = await supabase.rpc('generate_approval_link', {
    p_submission_id: submissionId,
    p_role: role,
    p_person_name: personName,
    p_person_email: personEmail || null,
  })
  return { data, error }
}

// All approval links (adviser/dean/sdg_rep) tied to a submission, for
// showing status/links inside Submission Bin.
export async function fetchApprovalLinks(submissionId) {
  const { data, error } = await supabase
    .from('approval_links')
    .select('id, role, token, person_name, person_email, status, comment, expires_at, decided_at, created_at, signature_data, sdg_selections')
    // note: the same select shape covers marketing_rep links too —
    // they just never populate sdg_selections
    .eq('submission_id', submissionId)
  return { data: data || [], error }
}

// Resolves the state of the whole Adviser -> Dean -> SDG Rep chain
// for a submission, mirroring the ordering/gating enforced server-side
// in migration 021. `complete` only becomes true once every required
// link (including the SDG Rep, who must have actually marked SDGs) is
// approved.
export function externalApprovalState(links, category, type = 'event_application') {
  const chain = externalApprovalChain(category, type)
  const byRole = Object.fromEntries(chain.map((role) => [role, links.find((l) => l.role === role) || null]))
  let complete = true
  let unlockedUpTo = 0
  for (let i = 0; i < chain.length; i++) {
    const link = byRole[chain[i]]
    if (link?.status === 'approved') {
      unlockedUpTo = i + 1
    } else {
      complete = false
      break
    }
  }
  return {
    chain,
    byRole,
    adviser: byRole.adviser || null,
    dean: byRole.dean || null,
    sdgRep: byRole.sdg_rep || null,
    marketingRep: byRole.marketing_rep || null,
    needsDean: chain.includes('dean'),
    complete,
    unlockedUpTo, // number of chain steps fully approved so far
  }
}

// Post an internal (SDAO/org-side) message onto an existing link's
// thread — visible to the external reviewer next time they open it.
export async function postApprovalLinkMessage(approvalLinkId, body) {
  const { data, error } = await supabase
    .from('approval_link_messages')
    .insert({ approval_link_id: approvalLinkId, author: 'sdao', body })
    .select()
    .single()
  return { data, error }
}

export async function fetchApprovalLinkMessages(approvalLinkId) {
  const { data, error } = await supabase
    .from('approval_link_messages')
    .select('id, author, body, created_at')
    .eq('approval_link_id', approvalLinkId)
    .order('created_at', { ascending: true })
  return { data: data || [], error }
}
