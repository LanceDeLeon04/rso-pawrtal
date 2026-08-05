import { supabase } from './supabaseClient'

// Categories of submitting org that require a Dean sign-off in addition
// to the Adviser. Everything else (e.g. Special Interest) only needs
// the Adviser link. Keep in sync with the DB function of the same name
// in migration 019.
const DEAN_REQUIRED_CATEGORIES = ['School Council', 'Academic']

export function orgNeedsDean(category) {
  return DEAN_REQUIRED_CATEGORIES.includes(category)
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

// All approval links (adviser/dean) tied to a submission, for showing
// status/links inside Submission Bin.
export async function fetchApprovalLinks(submissionId) {
  const { data, error } = await supabase
    .from('approval_links')
    .select('id, role, token, person_name, person_email, status, comment, expires_at, decided_at, created_at, signature_data')
    .eq('submission_id', submissionId)
  return { data: data || [], error }
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
