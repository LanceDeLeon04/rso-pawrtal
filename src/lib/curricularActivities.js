import { supabase } from './supabaseClient'

export const CURRICULAR_STATUS_LABELS = {
  dean_review: 'Dean Review',
  sdg_review: 'SDG Representative Review',
  director_review: 'Academic Director Approval',
  approved: 'Approved',
  returned: 'Returned for Revision',
  rejected: 'Rejected',
}

// Ordered chain used to render step-progress UI (track page + admin page).
export const CURRICULAR_CHAIN = [
  { key: 'dean_review', label: 'Dean' },
  { key: 'sdg_review', label: 'SDG Representative' },
  { key: 'director_review', label: 'Academic Director' },
  { key: 'approved', label: 'Approved' },
]

export function curricularApplyUrl(token) {
  return `${window.location.origin}/curricular/apply/${token}`
}

export function curricularApproveUrl(token) {
  return `${window.location.origin}/curricular/approve/${token}`
}

// ---------- Admin: apply links ----------
export async function generateCurricularApplyLink(label) {
  const { data, error } = await supabase.rpc('generate_curricular_apply_link', { p_label: label || null })
  return { data, error }
}

export async function setCurricularApplyLinkActive(id, active) {
  const { data, error } = await supabase.rpc('set_curricular_apply_link_active', { p_id: id, p_active: active })
  return { data, error }
}

export async function fetchCurricularApplyLinks() {
  const { data, error } = await supabase
    .from('curricular_apply_links')
    .select('id, token, label, is_active, created_at')
    .order('created_at', { ascending: false })
  return { data: data || [], error }
}

// ---------- Admin: submissions ----------
export async function fetchCurricularActivities() {
  const { data, error } = await supabase
    .from('curricular_activities')
    .select('*')
    .order('created_at', { ascending: false })
  return { data: data || [], error }
}

export async function fetchCurricularApprovals(activityId) {
  const { data, error } = await supabase
    .from('curricular_approvals')
    .select('id, role, token, person_name, person_email, status, comment, expires_at, decided_at, created_at')
    .eq('activity_id', activityId)
  return { data: data || [], error }
}

export async function fetchCurricularHistory(activityId) {
  const { data, error } = await supabase
    .from('curricular_history')
    .select('id, step, action, actor_name, comment, created_at')
    .eq('activity_id', activityId)
    .order('created_at', { ascending: true })
  return { data: data || [], error }
}

export async function generateCurricularApproval(activityId, role, personName, personEmail) {
  const { data, error } = await supabase.rpc('generate_curricular_approval', {
    p_activity_id: activityId, p_role: role, p_person_name: personName, p_person_email: personEmail || null,
  })
  return { data, error }
}

export async function decideCurricularActivity(activityId, decision, comment) {
  const { data, error } = await supabase.rpc('decide_curricular_activity', {
    p_activity_id: activityId, p_decision: decision, p_comment: comment || null,
  })
  return { data, error }
}

// ---------- Public: apply / track / external approve ----------
export async function getCurricularApplyLink(token) {
  const { data, error } = await supabase.rpc('get_curricular_apply_link', { p_token: token })
  return { data, error }
}

export async function submitCurricularActivity(token, payload) {
  const { data, error } = await supabase.rpc('submit_curricular_activity', { p_token: token, p_payload: payload })
  return { data, error }
}

export async function trackCurricularActivity(eventCode) {
  const { data, error } = await supabase.rpc('track_curricular_activity', { p_event_code: eventCode })
  return { data, error }
}

export async function getCurricularApproval(token) {
  const { data, error } = await supabase.rpc('get_curricular_approval', { p_token: token })
  return { data, error }
}

export async function submitCurricularDecision(token, decision, comment, signature) {
  const { data, error } = await supabase.rpc('submit_curricular_decision', {
    p_token: token, p_decision: decision, p_comment: comment || null, p_signature: signature || null,
  })
  return { data, error }
}
