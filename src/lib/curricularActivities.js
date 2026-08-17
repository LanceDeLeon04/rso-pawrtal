import { supabase } from './supabaseClient'

export const CURRICULAR_STATUS_LABELS = {
  dean_review: 'Dean & SDG Representative Review',
  sdg_review: 'Dean & SDG Representative Review',
  director_review: 'Academic Director Approval',
  approved: 'Approved',
  returned: 'Returned for Revision',
  rejected: 'Rejected',
}

// Ordered chain used to render step-progress UI (track page + admin page).
// Dean and SDG Representative review IN PARALLEL, so they share one step —
// the activity only advances once BOTH have approved.
export const CURRICULAR_CHAIN = [
  { key: 'dean_review', label: 'Dean & SDG Rep' },
  { key: 'director_review', label: 'Academic Director' },
  { key: 'approved', label: 'Approved' },
]

// ---------- Client-side attachment helpers ----------
export const MAX_ATTACHMENT_MB = 5
export const MAX_ATTACHMENTS = 8

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

// Inverse-ish of fileToBase64, for content generated in-memory (e.g. the
// auto-generated ACP PDF) rather than picked from disk. Chunked to avoid
// blowing the call stack on large PDFs.
export function bytesToBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function downloadBase64File(base64, fileName, fileType) {
  const byteChars = atob(base64)
  const byteNumbers = new Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i)
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: fileType || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName || 'attachment'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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

export async function fetchCurricularAttachments(activityId) {
  const { data, error } = await supabase.rpc('fetch_curricular_attachments', { p_activity_id: activityId })
  return { data: data || [], error }
}

export async function getCurricularApprovalAttachment(token, attachmentId) {
  const { data, error } = await supabase.rpc('get_curricular_attachment', { p_token: token, p_attachment_id: attachmentId })
  return { data, error }
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
